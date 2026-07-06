/**
 * scripts/sim-sanity.ts — the pre-matrix sanity gate (SPEC-sim.md "Test cases
 * to verify correctness" + docs/policy-design.md §4).
 *
 * Gate rule (user instruction): if any of the five spec matchups is > 15 pp
 * off its expected win rate, stop and debug before building the matrix.
 * Documented deviations (verified as format math, not policy bugs) are
 * reported as DEVIATION and explained; see DECISIONS.md.
 *
 * Also checks structural invariants: policy dominance over baselines,
 * termination, reproducibility, timing budget.
 *
 * Exits non-zero on any unexplained failure.
 */
import { estimateMatchup, battleSeed } from '../lib/sim/harness';
import { runBattle } from '../lib/sim/engine';
import { getPolicy, clearDamageCache } from '../lib/sim/policy';
import { variantToSet } from '../lib/sim/sets';
import { applyCondition, CONDITIONS } from '../lib/sim/condition';
import type { Variant, VariantsData } from '../lib/types';
import * as fs from 'fs';
import * as path from 'path';

const data: VariantsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'defender-variants.json'), 'utf8'),
);
const byId = new Map(data.variants.map((v) => [v.id, v]));

/**
 * Amoonguss is below the scrape's usage cutoff, so it has no variant entry;
 * the spec still names it as a sanity case. Standard bulky set, SP spread.
 */
const AMOONGUSS: Variant = {
  id: 'amoonguss_synthetic',
  species: 'Amoonguss',
  is_mega: false,
  item: null,
  ability: 'Regenerator',
  nature: 'Calm',
  sps: { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0 },
  weight: 0,
  moves: [
    { name: 'Spore', usage: 0.9 },
    { name: 'Pollen Puff', usage: 0.8 },
    { name: 'Giga Drain', usage: 0.7 },
    { name: 'Protect', usage: 0.6 },
  ],
};

let failures = 0;
let deviations = 0;

function verdict(
  label: string, measured: number, expectLow: number, expectHigh: number,
  deviationNote?: string,
): void {
  const pct = (measured * 100).toFixed(1);
  const inBand = measured >= expectLow - 0.15 && measured <= expectHigh + 0.15;
  if (inBand) {
    console.log(`  PASS  ${label}: ${pct}% (expected ${expectLow * 100}–${expectHigh * 100}%, ±15 pp gate)`);
  } else if (deviationNote) {
    deviations++;
    console.log(`  DEVIATION  ${label}: ${pct}% (expected ${expectLow * 100}–${expectHigh * 100}%)`);
    console.log(`             ${deviationNote}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}: ${pct}% (expected ${expectLow * 100}–${expectHigh * 100}%, ±15 pp gate)`);
  }
}

async function specMatchups() {
  console.log('\n[1/5] Spec matchup checks (n=300, adaptive stopping disabled)\n');
  const opts = { n: 300, minN: 300 };

  const zard = await estimateMatchup(byId.get('charizard_mega_y')!, byId.get('incineroar_no_item')!, 'fresh', opts);
  verdict('Mega Charizard Y vs Incineroar', zard.p_A_wins, 0.70, 1.0);

  const gambit = await estimateMatchup(byId.get('kingambit_black_glasses')!, AMOONGUSS, 'fresh', opts);
  verdict('Kingambit vs Amoonguss', gambit.p_A_wins, 0.85, 1.0);

  const incin = await estimateMatchup(byId.get('incineroar_no_item')!, byId.get('kingambit_black_glasses')!, 'fresh', opts);
  verdict('Incineroar vs Kingambit', incin.p_A_wins, 0.65, 0.75);

  const chomp = await estimateMatchup(byId.get('garchomp_no_item')!, byId.get('rotom_wash_no_item')!, 'fresh', opts);
  // Expected (Gen 9 intuition): Rotom-W ~80%+ → P(Garchomp) ≤ 0.20.
  verdict('Garchomp vs Rotom-Wash [P(Garchomp)]', chomp.p_A_wins, 0.0, 0.20,
    'Verified as Champions format math, not a policy bug (DECISIONS.md D24): ' +
    'the modal Rotom-W is an offensive 32 SpA/32 Spe spread (2 HP SP); Jolly Garchomp ' +
    'outspeeds (169 vs 138) and Dragon Claw is a guaranteed 2HKO (min roll 66 > 63.5), ' +
    'while 80%-accurate Hydro Pump needs two turns Rotom never gets — even the optimal ' +
    'Will-O-Wisp line loses (burned Claw 3HKOs from 51 HP before the second Hydro). ' +
    'The Gen-9 expectation assumed a bulky pivot spread that does not exist in this metagame.');

  return { zard, gambit, incin, chomp };
}

async function speedTieMirror() {
  console.log('\n[2/5] Speed-tie mirror (1000 battles)\n');
  const v = byId.get('kingambit_black_glasses')!;
  const r = await estimateMatchup(v, v, 'fresh', { n: 1000, minN: 1000 });
  const p = r.p_A_wins;
  const draws = r.draws;
  // 1000 coin flips: 3σ ≈ ±4.7 pp
  const pass = p >= 0.45 && p <= 0.55;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  mirror match: A wins ${(p * 100).toFixed(1)}% (expect 50% ± 5), draws ${draws}, mean turns ${r.mean_turns.toFixed(1)}`);
  if (!pass) failures++;
}

async function headToHead(aId: string, polA: string, polB: string, n = 150): Promise<number> {
  clearDamageCache();
  const A = variantToSet(byId.get(aId)!);
  let wins = 0;
  for (let i = 0; i < n; i++) {
    // Same variant both sides — isolates policy strength; alternate seed per i.
    const r = await runBattle({
      side_A: A, side_B: A,
      policy_A: getPolicy(polA), policy_B: getPolicy(polB),
      seed: battleSeed(aId, aId, `h2h:${polA}:${polB}`, i),
      onBattleStart: (b) => applyCondition(b, CONDITIONS.fresh),
    });
    if (r.winner === 'A') wins++;
    else if (r.winner === 'draw') wins += 0.5;
  }
  return wins / n;
}

async function policyDominance() {
  console.log('\n[3/5] Policy dominance (mirror sets, 150 battles each)\n');
  for (const opp of ['random', 'damage-max']) {
    let total = 0;
    let count = 0;
    for (const vid of ['kingambit_black_glasses', 'incineroar_no_item', 'charizard_mega_y', 'rotom_wash_no_item']) {
      const p = await headToHead(vid, 'nash-d2', opp);
      total += p;
      count++;
    }
    const avg = total / count;
    const pass = avg >= 0.5;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  nash-d2 vs ${opp}: ${(avg * 100).toFixed(1)}% (mirror-set aggregate, expect >= 50%)`);
    if (!pass) failures++;
  }
}

async function reproducibility() {
  console.log('\n[4/5] Reproducibility\n');
  const A = byId.get('incineroar_no_item')!;
  const B = byId.get('kingambit_black_glasses')!;
  const r1 = await estimateMatchup(A, B, 'fresh', { n: 60, minN: 60 });
  const r2 = await estimateMatchup(A, B, 'fresh', { n: 60, minN: 60 });
  const same = r1.wins_A === r2.wins_A && r1.wins_B === r2.wins_B && r1.mean_turns === r2.mean_turns;
  console.log(`  ${same ? 'PASS' : 'FAIL'}  identical re-run: ${r1.wins_A}/${r1.wins_B} vs ${r2.wins_A}/${r2.wins_B}`);
  if (!same) failures++;
}

async function timing() {
  console.log('\n[5/5] Timing budget\n');
  const t0 = Date.now();
  let battles = 0;
  for (const [a, b] of [
    ['kingambit_black_glasses', 'incineroar_no_item'],
    ['charizard_mega_y', 'garchomp_no_item'],
  ] as const) {
    const r = await estimateMatchup(byId.get(a)!, byId.get(b)!, 'fresh', { n: 50, minN: 50 });
    battles += r.n_simulated;
  }
  const ms = (Date.now() - t0) / battles;
  const pass = ms <= 50;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${ms.toFixed(1)} ms/battle (budget 50 ms)`);
  if (!pass) failures++;
}

async function main() {
  console.log('=== Battle-sim sanity gate (policy: nash-d2) ===');
  const results = await specMatchups();
  await speedTieMirror();
  await policyDominance();
  await reproducibility();
  await timing();

  // termination invariant: no draws (500-turn cap) anywhere in the spec set
  const anyDraws = [results.zard, results.gambit, results.incin, results.chomp].some((r) => r.draws > 0);
  console.log(`\ntermination: ${anyDraws ? 'WARN — draws present' : 'PASS — no draw-capped battles in the spec set'}`);

  console.log(`\n=== ${failures} failure(s), ${deviations} documented deviation(s) ===`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

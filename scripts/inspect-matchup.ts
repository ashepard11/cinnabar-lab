/**
 * scripts/inspect-matchup.ts — run one matchup with full logging.
 *
 *   npm run inspect-matchup -- --A charizard_mega_y --B incineroar_no_item \
 *     --condition fresh [--n 50] [--policy nash-d2] [--verbose] [--battle 0]
 *
 * Without --verbose: prints the estimate summary.
 * With --verbose: additionally prints the full battle log of one battle
 * (--battle selects which iteration, default 0).
 */
import { estimateMatchup } from '../lib/sim/harness';
import { CONDITIONS, type ConditionId } from '../lib/sim/condition';
import type { Variant, VariantsData } from '../lib/types';
import * as fs from 'fs';
import * as path from 'path';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const data: VariantsData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'defender-variants.json'), 'utf8'),
  );
  const byId = new Map(data.variants.map((v) => [v.id, v]));

  const aId = arg('A');
  const bId = arg('B');
  const conditionId = (arg('condition', 'fresh')!) as ConditionId;
  const n = Number(arg('n', '100'));
  const policyId = arg('policy', undefined);

  if (!aId || !bId) {
    console.error('usage: npm run inspect-matchup -- --A <variant_id> --B <variant_id> [--condition fresh] [--n 100] [--policy nash-d2] [--verbose] [--battle 0]');
    console.error(`known variants: ${data.variants.map((v) => v.id).join(', ')}`);
    process.exit(1);
  }
  const A = byId.get(aId) as Variant | undefined;
  const B = byId.get(bId) as Variant | undefined;
  if (!A || !B) {
    console.error(`unknown variant: ${!A ? aId : bId}`);
    process.exit(1);
  }
  if (!(conditionId in CONDITIONS)) {
    console.error(`unknown condition: ${conditionId} (known: ${Object.keys(CONDITIONS).join(', ')})`);
    process.exit(1);
  }

  const t0 = Date.now();
  const r = await estimateMatchup(A, B, conditionId, {
    n,
    policyId,
    collectLogs: flag('verbose'),
  });
  const elapsed = Date.now() - t0;

  console.log(`\n${A.id} vs ${B.id} — condition: ${conditionId}${policyId ? ` — policy: ${policyId}` : ''}`);
  console.log(`  P(A wins) = ${(r.p_A_wins * 100).toFixed(1)}%  (95% CI ${(r.ci_low * 100).toFixed(1)}–${(r.ci_high * 100).toFixed(1)})`);
  console.log(`  n=${r.n_simulated}  A ${r.wins_A} / B ${r.wins_B} / draws ${r.draws}  mean turns ${r.mean_turns.toFixed(1)}`);
  console.log(`  ${elapsed} ms total, ${(elapsed / r.n_simulated).toFixed(0)} ms/battle`);

  if (flag('verbose') && r.battles) {
    const idx = Math.min(Number(arg('battle', '0')), r.battles.length - 1);
    const b = r.battles[idx];
    console.log(`\n--- battle #${idx} (winner ${b.winner}, ${b.turns} turns) ---`);
    for (const line of b.log ?? []) {
      if (/^\|(move|switch|-damage|-heal|-status|-boost|-unboost|-weather|-fieldstart|-fieldend|-sidestart|-sideend|-immune|-miss|-crit|-supereffective|-resisted|-fail|faint|turn|win|tie|error)/.test(line)) {
        console.log(line);
      }
    }
    if (b.hp_timeline) {
      console.log('\nHP timeline:');
      for (const t of b.hp_timeline) {
        console.log(`  turn ${t.turn}: A ${(t.hp_A * 100).toFixed(0)}%  B ${(t.hp_B * 100).toFixed(0)}%`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

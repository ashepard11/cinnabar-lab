/**
 * scripts/verify-matchups.ts — post-build integrity checks on
 * data/matchups.sqlite. Read-only; run after build-matchups completes.
 *
 * Checks:
 *  1. completeness — every ordered pair (A≠B) × condition has a row
 *  2. mirror consistency — row(A,B,c) and row(B,A,mirror(c)) agree exactly
 *  3. sanity anchors — key cells agree with the sim-sanity gate results
 *  4. distribution stats — draws, CI widths, n, mean turns (reported)
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { CONDITION_IDS, mirrorCondition, type ConditionId } from '../lib/sim/condition';
import type { VariantsData } from '../lib/types';

const ROOT = path.join(__dirname, '..');
const db = new DatabaseSync(path.join(ROOT, 'data', 'matchups.sqlite'), { readOnly: true });
const data: VariantsData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'defender-variants.json'), 'utf8'));
const ids = data.variants.map((v) => v.id);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. completeness
const expected = ids.length * (ids.length - 1) * CONDITION_IDS.length;
const count = (db.prepare('SELECT COUNT(*) c FROM matchups').get() as any).c as number;
check('row count', count === expected, `${count} rows (expected ${expected})`);

const nullCheck = (db.prepare(
  'SELECT COUNT(*) c FROM matchups WHERE n_simulated <= 0 OR p_A_wins < 0 OR p_A_wins > 1',
).get() as any).c as number;
check('no invalid rows', nullCheck === 0, `${nullCheck} invalid`);

// 2. mirror consistency (sampled: every 37th row to keep it fast)
const rows = db.prepare('SELECT * FROM matchups').all() as any[];
const byKey = new Map<string, any>(rows.map((r) => [`${r.variant_A}|${r.variant_B}|${r.condition}`, r]));
let mirrorBad = 0;
let sampled = 0;
for (let i = 0; i < rows.length; i += 37) {
  const r = rows[i];
  const m = byKey.get(`${r.variant_B}|${r.variant_A}|${mirrorCondition(r.condition as ConditionId)}`);
  sampled++;
  if (!m || m.wins_A !== r.wins_B || m.wins_B !== r.wins_A || m.draws !== r.draws || m.n_simulated !== r.n_simulated) {
    mirrorBad++;
  }
}
check('mirror consistency', mirrorBad === 0, `${sampled} sampled, ${mirrorBad} mismatches`);

// 3. sanity anchors — same seeds as the gate, so values match up to sample size
const anchor = (A: string, B: string, lo: number, hi: number) => {
  const r = byKey.get(`${A}|${B}|fresh`);
  if (!r) return check(`anchor ${A} vs ${B}`, false, 'missing row');
  check(`anchor ${A} vs ${B}`, r.p_A_wins >= lo && r.p_A_wins <= hi,
    `${(r.p_A_wins * 100).toFixed(1)}% (gate band ${lo * 100}–${hi * 100}%)`);
};
anchor('charizard_mega_y', 'incineroar_no_item', 0.55, 1.0);
anchor('incineroar_no_item', 'kingambit_black_glasses', 0.50, 0.90);
anchor('garchomp_no_item', 'rotom_wash_no_item', 0.85, 1.0); // documented deviation D24

// 4. stats
const stats = db.prepare(`
  SELECT COUNT(*) n,
         AVG(n_simulated) avg_n,
         AVG(ci_high - ci_low) avg_ci,
         SUM(draws) draws,
         AVG(mean_turns) turns,
         SUM(CASE WHEN ci_high - ci_low > 0.15 THEN 1 ELSE 0 END) wide_ci
  FROM matchups
`).get() as any;
console.log(`\n  stats: avg n=${stats.avg_n.toFixed(1)} battles/cell, avg CI width ${stats.avg_ci.toFixed(3)}, ` +
  `${stats.wide_ci} cells with CI > 0.15 (${((stats.wide_ci / stats.n) * 100).toFixed(1)}%), ` +
  `${stats.draws} total draws, mean ${stats.turns.toFixed(1)} turns`);

const battles = (db.prepare('SELECT SUM(n_simulated) s FROM matchups').get() as any).s / 2; // rows double-count via mirrors
console.log(`  total battles simulated: ${Math.round(battles).toLocaleString()}`);

db.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`}`);
process.exit(failures > 0 ? 1 : 0);

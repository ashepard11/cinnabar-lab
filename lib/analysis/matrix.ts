/**
 * lib/analysis/matrix.ts — Node-side query API over data/matchups.sqlite
 * (SPEC-sim.md Phase 5). The frontend does not use this module; it loads the
 * sqlite file with sql.js (see src/lib/matchupDb.ts).
 */
import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';
import type { MatchupResult } from '../sim/harness';
import type { ConditionId } from '../sim/condition';

export type VariantId = string;

const DEFAULT_DB = path.join(__dirname, '..', '..', 'data', 'matchups.sqlite');

let db: DatabaseSync | null = null;
let dbPath = DEFAULT_DB;

/** Point the module at a different sqlite file (tests). Closes any open db. */
export function setDbPath(p: string): void {
  if (db) {
    db.close();
    db = null;
  }
  dbPath = p;
}

function getDb(): DatabaseSync {
  if (!db) db = new DatabaseSync(dbPath, { readOnly: true });
  return db;
}

function rowToResult(row: any): MatchupResult {
  return {
    variant_A_id: row.variant_A,
    variant_B_id: row.variant_B,
    condition: row.condition,
    n_simulated: row.n_simulated,
    wins_A: row.wins_A,
    wins_B: row.wins_B,
    draws: row.draws,
    p_A_wins: row.p_A_wins,
    ci_low: row.ci_low,
    ci_high: row.ci_high,
    mean_turns: row.mean_turns,
  };
}

export function getMatchup(A: VariantId, B: VariantId, condition: ConditionId): MatchupResult | null {
  const row = getDb()
    .prepare('SELECT * FROM matchups_current WHERE variant_A = ? AND variant_B = ? AND condition = ?')
    .get(A, B, condition);
  return row ? rowToResult(row) : null;
}

/** A's easiest wins under a condition, best first. */
export function bestMatchupsFor(A: VariantId, condition: ConditionId, n: number): MatchupResult[] {
  return (getDb()
    .prepare('SELECT * FROM matchups_current WHERE variant_A = ? AND condition = ? ORDER BY p_A_wins DESC LIMIT ?')
    .all(A, condition, n) as any[]).map(rowToResult);
}

/** A's hardest losses under a condition, worst first. */
export function worstMatchupsFor(A: VariantId, condition: ConditionId, n: number): MatchupResult[] {
  return (getDb()
    .prepare('SELECT * FROM matchups_current WHERE variant_A = ? AND condition = ? ORDER BY p_A_wins ASC LIMIT ?')
    .all(A, condition, n) as any[]).map(rowToResult);
}

/** All rows for one attacker under a condition, keyed by opponent. */
export function matchupsFor(A: VariantId, condition: ConditionId): Map<VariantId, MatchupResult> {
  const out = new Map<VariantId, MatchupResult>();
  for (const row of getDb()
    .prepare('SELECT * FROM matchups_current WHERE variant_A = ? AND condition = ?')
    .all(A, condition) as any[]) {
    out.set(row.variant_B, rowToResult(row));
  }
  return out;
}

/**
 * Coverage delta of pairing A with B (spec formula): for each opponent V,
 *   P(A∪B beats V) − max(P(A beats V), P(B beats V))
 * where P(A∪B) = 1 − (1−pA)(1−pB) — "at least one of the two threatens V".
 * Positive values = V is better covered by the pair than by either alone.
 */
export function coverageDelta(A: VariantId, B: VariantId, condition: ConditionId): Map<VariantId, number> {
  const rowsA = matchupsFor(A, condition);
  const rowsB = matchupsFor(B, condition);
  const out = new Map<VariantId, number>();
  for (const [V, ra] of rowsA) {
    if (V === B) continue;
    const rb = rowsB.get(V);
    if (!rb) continue;
    const pA = ra.p_A_wins;
    const pB = rb.p_A_wins;
    const union = 1 - (1 - pA) * (1 - pB);
    out.set(V, union - Math.max(pA, pB));
  }
  return out;
}

/** Distinct variant ids present in the matrix. */
export function variantIds(): VariantId[] {
  return (getDb().prepare('SELECT DISTINCT variant_A AS id FROM matchups_current ORDER BY id').all() as any[])
    .map((r) => r.id);
}

/** Matrix metadata (policy/calc versions etc.). */
export function metadata(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of getDb().prepare('SELECT key, value FROM metadata').all() as any[]) {
    out[row.key] = row.value;
  }
  return out;
}

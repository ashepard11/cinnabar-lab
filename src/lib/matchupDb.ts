/**
 * Client-side access to data/matchups.sqlite via sql.js (WASM SQLite).
 * The file is ~10 MB and served statically alongside the JSON viz data
 * (SPEC-sim.md Phase 6: "if the sqlite file is < 20 MB, sql.js is simpler").
 */
import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface MatchupRow {
  variant_A: string;
  variant_B: string;
  condition: string;
  n_simulated: number;
  wins_A: number;
  wins_B: number;
  draws: number;
  p_A_wins: number;
  ci_low: number;
  ci_high: number;
  mean_turns: number;
}

export const CONDITION_IDS = [
  'fresh', 'tailwind_A', 'tailwind_B', 'trick_room', 'sun', 'rain',
  'A_boosted_atk', 'A_boosted_spa', 'B_boosted_atk', 'B_boosted_spa',
] as const;
export type ConditionId = (typeof CONDITION_IDS)[number];

let dbPromise: Promise<Database> | null = null;

export function loadMatchupDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const resp = await fetch(import.meta.env.BASE_URL + 'matchups.sqlite');
      if (!resp.ok) throw new Error(`fetch matchups.sqlite: HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      return new SQL.Database(new Uint8Array(buf));
    })();
  }
  return dbPromise;
}

function rows(db: Database, sql: string, params: any[] = []): MatchupRow[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out: MatchupRow[] = [];
  while (stmt.step()) out.push(stmt.getAsObject() as unknown as MatchupRow);
  stmt.free();
  return out;
}

export function allVariantIds(db: Database): string[] {
  return rows(db, 'SELECT DISTINCT variant_A AS variant_A FROM matchups ORDER BY variant_A')
    .map((r) => r.variant_A);
}

/** Full row set for one condition (used to paint the grid). */
export function conditionRows(db: Database, condition: ConditionId): MatchupRow[] {
  return rows(db, 'SELECT * FROM matchups WHERE condition = ?', [condition]);
}

export function getMatchup(db: Database, A: string, B: string, condition: string): MatchupRow | null {
  const r = rows(db, 'SELECT * FROM matchups WHERE variant_A = ? AND variant_B = ? AND condition = ?', [A, B, condition]);
  return r[0] ?? null;
}

export function allConditionsFor(db: Database, A: string, B: string): MatchupRow[] {
  return rows(db, 'SELECT * FROM matchups WHERE variant_A = ? AND variant_B = ?', [A, B]);
}

export function matchupsFor(db: Database, A: string, condition: ConditionId): Map<string, MatchupRow> {
  const out = new Map<string, MatchupRow>();
  for (const r of rows(db, 'SELECT * FROM matchups WHERE variant_A = ? AND condition = ?', [A, condition])) {
    out.set(r.variant_B, r);
  }
  return out;
}

export function metadata(db: Database): Record<string, string> {
  const stmt = db.prepare('SELECT key, value FROM metadata');
  const out: Record<string, string> = {};
  while (stmt.step()) {
    const row = stmt.getAsObject() as any;
    out[row.key] = row.value;
  }
  stmt.free();
  return out;
}

// ---------------------------------------------------------------------------
// Team-builder scoring (client-side mirror of lib/analysis/team.ts)
// ---------------------------------------------------------------------------

export interface PartnerSuggestion {
  variant: string;
  coverage_score: number;
  top_improvements: Array<{ opponent: string; before: number; after: number }>;
}

export function urgency(p0: number): number {
  return 1.5 - p0;
}

/**
 * Per-opponent win rates of each core member, plus the core's best answer.
 * Shared foundation of suggestPartners and weakestMatchups so both rank
 * with the same weighting.
 */
export function computeTeamBest(
  db: Database,
  core: string[],
  condition: ConditionId,
): Map<string, { best: number; per_member: Array<{ member: string; p: number }> }> {
  const all = allVariantIds(db);
  const coreSet = new Set(core);
  const coreRows = core.map((c) => ({ member: c, rows: matchupsFor(db, c, condition) }));
  const out = new Map<string, { best: number; per_member: Array<{ member: string; p: number }> }>();
  for (const V of all) {
    if (coreSet.has(V)) continue;
    const per_member: Array<{ member: string; p: number }> = [];
    let best = -1;
    for (const { member, rows } of coreRows) {
      const row = rows.get(V);
      if (!row) continue;
      per_member.push({ member, p: row.p_A_wins });
      if (row.p_A_wins > best) best = row.p_A_wins;
    }
    if (best >= 0) out.set(V, { best, per_member });
  }
  return out;
}

export interface WeakMatchup {
  opponent: string;
  /** Highest win rate any core member has against V. */
  team_best: number;
  /** Second-highest win rate among core members against V (0 if <2 members). */
  team_second_best: number;
  per_member: Array<{ member: string; p: number }>;
  best_member: string;
  weight: number;
  /** weight × team_best — how well the field-weighted best answer holds up. */
  primary_key: number;
  /** weight × team_second_best — how thin the field-weighted backup answer is. */
  secondary_key: number;
}

/**
 * The core's worst matchups, ranked lexicographically to surface gaps in
 * *redundant* coverage:
 *   primary   = weight(V) × team_best(core, V)        (ascending, worst first)
 *   secondary = weight(V) × team_second_best(core, V) (ascending, worst first)
 * When the field is broadly covered and primary keys sit close, the secondary
 * key exposes the opponents with no redundant answer. Client mirror of
 * lib/analysis/team.ts. (Diverges from suggestPartners — see DECISIONS.md.)
 */
type TeamBestEntry = { best: number; per_member: Array<{ member: string; p: number }> };

/** Build one WeakMatchup from a computeTeamBest entry (shared by the list and the probe). */
function toWeakMatchup(opponent: string, entry: TeamBestEntry, weight: number): WeakMatchup {
  const byRate = [...entry.per_member].sort((a, b) => b.p - a.p);
  const second = byRate[1]?.p ?? 0;
  return {
    opponent,
    team_best: entry.best,
    team_second_best: second,
    per_member: entry.per_member,
    best_member: byRate[0].member,
    weight,
    primary_key: weight * entry.best,
    secondary_key: weight * second,
  };
}

export function weakestMatchups(
  db: Database,
  core: string[],
  condition: ConditionId,
  weights: Map<string, number>,
): WeakMatchup[] {
  const teamBest = computeTeamBest(db, core, condition);
  const out: WeakMatchup[] = [];
  for (const [V, entry] of teamBest) out.push(toWeakMatchup(V, entry, weights.get(V) ?? 0));
  out.sort((a, b) => a.primary_key - b.primary_key || a.secondary_key - b.secondary_key);
  return out;
}

/**
 * The core-vs-one-opponent card for an arbitrary opponent (the team builder's
 * "check specific matchup" probe). Same per-member computation as the weakest
 * list; null if the opponent has no matchup data or is a core member.
 */
export function weakMatchupFor(
  db: Database,
  core: string[],
  condition: ConditionId,
  weights: Map<string, number>,
  opponent: string,
): WeakMatchup | null {
  const entry = computeTeamBest(db, core, condition).get(opponent);
  return entry ? toWeakMatchup(opponent, entry, weights.get(opponent) ?? 0) : null;
}

export type RankSort = 'weighted' | 'raw';

export interface RankedOpponent {
  opponent: string;
  p: number;       // P(selected beats opponent)
  weight: number;  // opponent's metagame weight
  score: number;   // value the list was ranked by
}

/**
 * One variant's best and worst matchups against the metagame (the Pokémon
 * detail page). Best = every opponent it beats with p > thresholds.best,
 * worst = every opponent it loses to with p < thresholds.worst; each list is
 * ordered by the chosen sort. 'weighted' mirrors the team-builder weighting
 * philosophy (best = weight × p, worst = weight × (1 − p)); 'raw' orders by
 * p alone. The win-rate filter is on p, independent of the sort.
 */
export function rankOpponents(
  db: Database,
  variant: string,
  condition: ConditionId,
  weights: Map<string, number>,
  sort: RankSort,
  thresholds: { best: number; worst: number },
): { best: RankedOpponent[]; worst: RankedOpponent[] } {
  const entries: Array<{ opponent: string; p: number; weight: number }> = [];
  for (const [opponent, row] of matchupsFor(db, variant, condition)) {
    entries.push({ opponent, p: row.p_A_wins, weight: weights.get(opponent) ?? 0 });
  }
  const scored = (mode: 'best' | 'worst'): RankedOpponent[] =>
    entries
      .filter((e) => (mode === 'best' ? e.p > thresholds.best : e.p < thresholds.worst))
      .map((e) => ({
        ...e,
        score: sort === 'weighted'
          ? e.weight * (mode === 'best' ? e.p : 1 - e.p)
          : (mode === 'best' ? e.p : 1 - e.p),
      }))
      .sort((a, b) => b.score - a.score);
  return { best: scored('best'), worst: scored('worst') };
}

export function suggestPartners(
  db: Database,
  core: string[],
  condition: ConditionId,
  weights: Map<string, number>,
): PartnerSuggestion[] {
  const all = allVariantIds(db);
  const coreSet = new Set(core);
  const teamBestFull = computeTeamBest(db, core, condition);
  const teamBest = new Map<string, number>();
  for (const [V, { best }] of teamBestFull) teamBest.set(V, best);

  const out: PartnerSuggestion[] = [];
  for (const candidate of all) {
    if (coreSet.has(candidate)) continue;
    const candRows = matchupsFor(db, candidate, condition);
    let score = 0;
    const improvements: Array<{ opponent: string; before: number; after: number }> = [];
    for (const [V, before] of teamBest) {
      if (V === candidate) continue;
      const row = candRows.get(V);
      if (!row) continue;
      const after = Math.max(before, row.p_A_wins);
      if (after <= before) continue;
      score += (weights.get(V) ?? 0) * (after - before) * urgency(before);
      improvements.push({ opponent: V, before, after });
    }
    improvements.sort((a, b) => (b.after - b.before) - (a.after - a.before));
    out.push({ variant: candidate, coverage_score: score, top_improvements: improvements.slice(0, 5) });
  }
  out.sort((a, b) => b.coverage_score - a.coverage_score);
  return out;
}

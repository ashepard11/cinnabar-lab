/**
 * lib/analysis/refresh.ts — incremental matrix refresh (BACKLOG item 03).
 *
 * The matrix costs hours to build. Almost nothing that invalidates it
 * invalidates all of it: a weekly rescrape moves a handful of variants, a
 * moveset edit changes one, and a regulation rollover leaves most of the
 * roster standing. This module works out which cells a given change actually
 * costs, so the build can pay for the difference instead of the whole thing.
 *
 * It leans entirely on the content ids from item 02. A cid is a hash of a
 * variant's resolved battle set, so "did this variant change" is an identity
 * comparison rather than a heuristic, and a matchup row stays valid exactly as
 * long as both of its cids and its run key are unchanged. Usage-weight drift,
 * move-usage reordering inside the same top four, tier reassignment and slug
 * renames all leave the cid alone and therefore cost nothing.
 *
 * Planning is read-only. Nothing here writes to the database; the caller
 * decides whether to act on a plan, which is what makes `--dry-run` honest.
 */
import { DatabaseSync } from 'node:sqlite';
import { variantCid } from '../variant-cid';
import { cellCost } from './cell-cost';
import type { RunVersions } from './schema';
import type { Variant } from '../types';

/** A variant as the plan refers to it: content id plus its display slug. */
export interface VariantRef {
  cid: string;
  slug: string;
  weight?: number;
}

/**
 * What moved between the database's variant set and the incoming one.
 *
 * The categories are cid-based and mutually exclusive. `respecified` is the
 * interesting one: a slug whose battle set changed keeps its name but gets a
 * new cid, so it appears as an add and a retirement that happen to share a
 * slug. Naming that case separately is what lets the report say "Garchomp's
 * moveset changed" rather than "one variant appeared and one vanished".
 */
export interface VariantDelta {
  /** Cids present in the incoming set with no rows in the database. */
  added: VariantRef[];
  /** Cids the database knows that the incoming set no longer contains. */
  retired: VariantRef[];
  /** Cids in both — every row between two of these is reusable. */
  unchanged: VariantRef[];
  /** Same cid, different slug. Free: rows key on the cid. */
  renamed: Array<{ cid: string; from: string; to: string }>;
  /** Same slug, different cid — the set behind the name changed. */
  respecified: Array<{ slug: string; from_cid: string; to_cid: string }>;
}

export interface RefreshPlan {
  /** The run key this refresh would write under, and whether it already exists. */
  run: {
    versions: RunVersions;
    run_id: number | null;
    rows_present: number;
  };
  delta: VariantDelta;
  cells: {
    /** Cells a build from empty would simulate: pairs × conditions. */
    full: number;
    /** Cells already recorded under this run key and still usable. */
    reusable: number;
    /** Cells this refresh must simulate. */
    to_simulate: number;
  };
  /** Rows in the table that no longer belong to any live variant pair. */
  orphan_rows: number;
  /** Rows recorded under run keys other than this one. */
  stale_run_rows: Array<{ run_id: number; rows: number; label: string }>;
  /**
   * True when the run key is new, so nothing can be reused and this is a full
   * build wearing a refresh's clothes. Callers should make the user say so.
   */
  full_rebuild: boolean;
  /** Why this plan costs what it costs, in one line. */
  reason: string;
}

/** A work unit: one unordered pair under one condition. */
export interface PairUnit {
  aCid: string;
  bCid: string;
  aSlug: string;
  bSlug: string;
  condition: string;
}

function label(v: RunVersions): string {
  return `${v.regulation} · ${v.policy_id}@${v.policy_version} · calc ${v.calc_version} · engine ${v.engine_version}`;
}

/**
 * Every run in the file, normalized to the v3 shape.
 *
 * Planning has to work on a v2 file too. `--dry-run` opens the database
 * read-only on purpose — a plan that migrated the schema would be a write, and
 * then "planning" and "acting" would no longer be separable — so the planner
 * cannot rely on `ensureSchema` having run. A v2 `sim_runs` has no
 * `regulation` column, and rows under it are M-B by construction, since that is
 * the only regulation the pipeline has ever produced; the file's own metadata
 * stamp is preferred where it exists. `sim_runs` holds one row per distinct
 * version tuple, so reading it whole costs nothing.
 */
export function readRuns(db: DatabaseSync): Array<RunVersions & { run_id: number }> {
  const cols = db.prepare('PRAGMA table_info(sim_runs)').all() as Array<{ name: string }>;
  const hasRegulation = cols.some((c) => c.name === 'regulation');
  const pinned = db
    .prepare('SELECT value FROM metadata WHERE key = ?')
    .get('regulation') as { value: string } | undefined;
  const fallback = pinned?.value ?? 'M-B';
  return (db.prepare('SELECT * FROM sim_runs').all() as Array<Record<string, any>>).map((r) => ({
    run_id: r.run_id,
    regulation: hasRegulation ? r.regulation : fallback,
    policy_id: r.policy_id,
    policy_version: r.policy_version,
    calc_version: r.calc_version,
    engine_version: r.engine_version,
  }));
}

function sameRun(a: RunVersions, b: RunVersions): boolean {
  return (
    a.regulation === b.regulation &&
    a.policy_id === b.policy_id &&
    a.policy_version === b.policy_version &&
    a.calc_version === b.calc_version &&
    a.engine_version === b.engine_version
  );
}

/** Read the database's view of every variant it holds rows or records for. */
function dbVariants(db: DatabaseSync): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of db.prepare('SELECT cid, slug FROM variants').all() as Array<{
    cid: string;
    slug: string;
  }>) {
    out.set(r.cid, r.slug);
  }
  return out;
}

/**
 * Diff the database's variant set against an incoming one.
 *
 * `known` is every cid the database has a record for, not just the ones
 * currently flagged. That is deliberate: a variant that left the metagame and
 * came back — a Pokémon dropping under the usage threshold for a week — still
 * has its rows, and they are still correct, because the cid proves the set is
 * identical. Retired rows are cache, not garbage.
 */
export function diffVariants(
  known: Map<string, string>,
  incoming: Variant[]
): VariantDelta {
  const incomingByCid = new Map<string, VariantRef>();
  for (const v of incoming) {
    const cid = v.cid ?? variantCid(v);
    incomingByCid.set(cid, { cid, slug: v.id, weight: v.weight });
  }

  const added: VariantRef[] = [];
  const unchanged: VariantRef[] = [];
  const renamed: VariantDelta['renamed'] = [];
  for (const [cid, ref] of incomingByCid) {
    const knownSlug = known.get(cid);
    if (knownSlug === undefined) {
      added.push(ref);
    } else {
      unchanged.push(ref);
      if (knownSlug !== ref.slug) renamed.push({ cid, from: knownSlug, to: ref.slug });
    }
  }

  const retired: VariantRef[] = [];
  for (const [cid, slug] of known) {
    if (!incomingByCid.has(cid)) retired.push({ cid, slug });
  }

  // A slug appearing on both sides of the add/retire split kept its name but
  // changed its battle set. Match on slug rather than on anything fuzzier: the
  // slug is derived from species and item bucket, so a collision here really
  // does mean "the same set, respecified".
  const retiredBySlug = new Map(retired.map((r) => [r.slug, r]));
  const respecified: VariantDelta['respecified'] = [];
  for (const a of added) {
    const old = retiredBySlug.get(a.slug);
    if (old) respecified.push({ slug: a.slug, from_cid: old.cid, to_cid: a.cid });
  }

  const bySlug = (x: VariantRef, y: VariantRef) => x.slug.localeCompare(y.slug);
  added.sort(bySlug);
  retired.sort(bySlug);
  unchanged.sort(bySlug);
  respecified.sort((x, y) => x.slug.localeCompare(y.slug));
  return { added, retired, unchanged, renamed, respecified };
}

/**
 * Work out what refreshing the matrix to `incoming` would cost.
 *
 * Read-only. `conditions` is passed in rather than imported so the planner
 * stays free of the simulator's module graph — it is arithmetic over a
 * database, and tests should be able to drive it without loading Showdown.
 */
export function planRefresh(
  db: DatabaseSync,
  incoming: Variant[],
  versions: RunVersions,
  conditions: readonly string[]
): RefreshPlan {
  const runs = readRuns(db);
  const runId = runs.find((r) => sameRun(r, versions))?.run_id ?? null;

  const delta = diffVariants(dbVariants(db), incoming);

  const liveCids = new Set(incoming.map((v) => v.cid ?? variantCid(v)));
  const n = liveCids.size;

  // Reusable cells: rows under this run key whose *both* cids are still live.
  // Counting in SQL keeps this O(1) in JS regardless of matrix size.
  let rowsPresent = 0;
  let reusableRows = 0;
  let orphanRows = 0;
  if (runId !== null) {
    rowsPresent = (
      db.prepare('SELECT COUNT(*) c FROM matchups WHERE run_id = ?').get(runId) as { c: number }
    ).c;
    for (const r of db
      .prepare(
        'SELECT variant_A_cid a, variant_B_cid b, COUNT(*) c FROM matchups WHERE run_id = ? GROUP BY a, b'
      )
      .all(runId) as Array<{ a: string; b: string; c: number }>) {
      if (liveCids.has(r.a) && liveCids.has(r.b)) reusableRows += r.c;
      else orphanRows += r.c;
    }
  }
  const { full, reusable, to_simulate: toSimulate } = cellCost(
    n, conditions.length, reusableRows,
  );

  const rowsByRun = new Map<number, number>();
  for (const r of db
    .prepare('SELECT run_id rid, COUNT(*) c FROM matchups GROUP BY run_id')
    .all() as Array<{ rid: number; c: number }>) {
    rowsByRun.set(r.rid, r.c);
  }
  const staleRuns: RefreshPlan['stale_run_rows'] = [];
  for (const r of runs) {
    const rows = rowsByRun.get(r.run_id) ?? 0;
    if (r.run_id === runId || rows === 0) continue;
    staleRuns.push({ run_id: r.run_id, rows, label: label(r) });
  }

  const fullRebuild = runId === null || reusable === 0;
  let reason: string;
  if (runId === null) {
    reason =
      `no rows exist for ${label(versions)} — the run key is new, so every cell ` +
      `must be simulated. A policy, calc, engine or regulation change does this by design.`;
  } else if (toSimulate === 0) {
    reason = 'every cell for the current variant set is already recorded under this run';
  } else {
    const parts: string[] = [];
    if (delta.added.length) parts.push(`${delta.added.length} new variant(s)`);
    if (delta.retired.length) parts.push(`${delta.retired.length} retired`);
    reason =
      `${parts.join(', ') || 'an incomplete previous build'} — ` +
      `${toSimulate} of ${full} cells (${((toSimulate / full) * 100).toFixed(1)}%) need simulating`;
  }

  return {
    run: { versions, run_id: runId, rows_present: rowsPresent },
    delta,
    cells: { full, reusable, to_simulate: toSimulate },
    orphan_rows: orphanRows,
    stale_run_rows: staleRuns,
    full_rebuild: fullRebuild,
    reason,
  };
}

/**
 * The work units a plan implies: every unordered live pair × condition whose
 * row is not already present under the run.
 *
 * Enumerating pairs rather than deriving them from the delta is deliberate.
 * "Pairs involving a new variant" is the right answer only when the previous
 * build finished; asking the database which rows exist is right either way,
 * and makes a crashed build resume for free.
 */
export function pendingUnits(
  db: DatabaseSync,
  incoming: Variant[],
  runId: number | null,
  conditions: readonly string[]
): PairUnit[] {
  const refs = incoming
    .map((v) => ({ cid: v.cid ?? variantCid(v), slug: v.id }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const present = new Set<string>();
  if (runId !== null) {
    for (const r of db
      .prepare('SELECT variant_A_cid a, variant_B_cid b, condition c FROM matchups WHERE run_id = ?')
      .all(runId) as Array<{ a: string; b: string; c: string }>) {
      present.add(`${r.a}|${r.b}|${r.c}`);
    }
  }

  const units: PairUnit[] = [];
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      for (const condition of conditions) {
        if (present.has(`${refs[i].cid}|${refs[j].cid}|${condition}`)) continue;
        units.push({
          aCid: refs[i].cid,
          bCid: refs[j].cid,
          aSlug: refs[i].slug,
          bSlug: refs[j].slug,
          condition,
        });
      }
    }
  }
  return units;
}

/**
 * Delete rows that no live pair can reach, and runs nothing points at.
 *
 * Not part of a refresh by default. Retired rows are a cache: a variant that
 * drops under the usage threshold one week and returns the next is byte-identical
 * by cid, and keeping its rows makes that round trip free. The reason to prune
 * anyway is that the file ships to browsers, so this is a size decision, and it
 * should be a deliberate one.
 */
export function prune(
  db: DatabaseSync,
  liveCids: Set<string>,
  opts: { staleRuns: boolean } = { staleRuns: false }
): { rows_deleted: number; runs_deleted: number } {
  const live = [...liveCids];
  const placeholders = live.map(() => '?').join(',');
  db.exec('BEGIN');
  let rows = 0;
  let runs = 0;
  try {
    const before = (db.prepare('SELECT COUNT(*) c FROM matchups').get() as { c: number }).c;
    if (live.length > 0) {
      db.prepare(
        `DELETE FROM matchups
          WHERE variant_A_cid NOT IN (${placeholders})
             OR variant_B_cid NOT IN (${placeholders})`
      ).run(...live, ...live);
    }
    if (opts.staleRuns) {
      const pinned = db
        .prepare('SELECT value FROM metadata WHERE key = ?')
        .get('current_run_id') as { value: string } | undefined;
      const keep = pinned ? Number(pinned.value) : -1;
      db.prepare('DELETE FROM matchups WHERE run_id != ?').run(keep);
    }
    rows = before - (db.prepare('SELECT COUNT(*) c FROM matchups').get() as { c: number }).c;
    // Variant records for cids no longer referenced anywhere are dead weight.
    if (live.length > 0) {
      db.prepare(
        `DELETE FROM variants
          WHERE cid NOT IN (${placeholders})
            AND cid NOT IN (SELECT variant_A_cid FROM matchups)`
      ).run(...live);
    }
    const runsBefore = (db.prepare('SELECT COUNT(*) c FROM sim_runs').get() as { c: number }).c;
    db.exec('DELETE FROM sim_runs WHERE run_id NOT IN (SELECT DISTINCT run_id FROM matchups)');
    runs = runsBefore - (db.prepare('SELECT COUNT(*) c FROM sim_runs').get() as { c: number }).c;
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { rows_deleted: rows, runs_deleted: runs };
}

/** Render a plan as the report the refresh script prints. */
export function formatPlan(plan: RefreshPlan): string {
  const { delta, cells } = plan;
  const lines: string[] = [];
  const pct = (x: number, of: number) => (of === 0 ? '0.0' : ((x / of) * 100).toFixed(1));

  lines.push(`run key   ${label(plan.run.versions)}`);
  lines.push(
    plan.run.run_id === null
      ? 'run       new — no existing rows share this key'
      : `run       #${plan.run.run_id}, ${plan.run.rows_present.toLocaleString()} rows recorded`
  );
  lines.push('');
  lines.push(
    `variants  ${delta.unchanged.length} unchanged, ${delta.added.length} added, ` +
      `${delta.retired.length} retired` +
      (delta.respecified.length ? `, ${delta.respecified.length} respecified` : '') +
      (delta.renamed.length ? `, ${delta.renamed.length} renamed` : '')
  );

  const show = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`  ${title}`);
    for (const s of items.slice(0, 12)) lines.push(`    ${s}`);
    if (items.length > 12) lines.push(`    … and ${items.length - 12} more`);
  };
  show(
    'added',
    delta.added.map(
      (v) => `${v.slug}  ${v.cid}${v.weight !== undefined ? `  ${(v.weight * 100).toFixed(2)}%` : ''}`
    )
  );
  show('retired', delta.retired.map((v) => `${v.slug}  ${v.cid}`));
  show(
    'respecified (same name, new battle set)',
    delta.respecified.map((r) => `${r.slug}  ${r.from_cid} -> ${r.to_cid}`)
  );
  show('renamed (free — rows key on the cid)', delta.renamed.map((r) => `${r.from} -> ${r.to}`));

  lines.push('');
  lines.push(
    `cells     ${cells.to_simulate.toLocaleString()} to simulate, ` +
      `${cells.reusable.toLocaleString()} reused, ${cells.full.toLocaleString()} in a full build ` +
      `(${pct(cells.to_simulate, cells.full)}% of a rebuild)`
  );
  if (plan.orphan_rows > 0) {
    lines.push(
      `orphans   ${plan.orphan_rows.toLocaleString()} rows under this run belong to retired ` +
        `variants — kept as cache; --prune removes them`
    );
  }
  for (const s of plan.stale_run_rows) {
    lines.push(`stale     run #${s.run_id}: ${s.rows.toLocaleString()} rows — ${s.label}`);
  }
  lines.push('');
  lines.push(plan.reason);
  return lines.join('\n');
}

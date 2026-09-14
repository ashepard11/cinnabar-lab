/**
 * lib/analysis/schema.ts — matchups.sqlite schema v3 (BACKLOG items 02, 03).
 *
 * The schema keys matchup rows on content-addressed variant ids plus the full
 * simulation provenance (regulation, policy id/version, calc version, engine
 * version):
 *
 *  - `variants`  — cid ↔ human slug, plus the canonical battle spec JSON and a
 *    `current` flag marking the variants of the live metagame snapshot.
 *  - `sim_runs`  — one row per distinct (regulation, policy_id,
 *    policy_version, calc_version, engine_version) tuple; matchup rows carry
 *    `run_id` instead of repeating five version strings 78k times (the file
 *    ships to browsers). A matchup row is therefore keyed on
 *    (variant_A_cid, variant_B_cid, condition, run_id) — exactly the backlog's
 *    (variant ids, condition, policy/calc/engine versions), normalized.
 *  - `matchups_current` — view exposing the legacy column shape (slugs, one
 *    row set) filtered to `current` variants and the metadata-pinned
 *    `current_run_id`, so readers (sql.js frontend, lib/analysis/matrix.ts)
 *    keep their slug-based API. Rows from older runs/variants stay in the
 *    table as reusable cache for incremental refresh (BACKLOG item 03).
 *
 * v3 (item 03) adds `regulation` to the run key. v2 left it out and pinned it
 * in `metadata` instead, which forced a guard refusing to extend a matrix built
 * under a different regulation — rows from two regulations would otherwise land
 * under one run_id and become indistinguishable. With the regulation in the key
 * they are distinguishable, so one file can hold a regulation rollover and the
 * incremental refresh can reuse every row whose variant survived it. That is
 * what SPEC-teambuilder.md Phase 5 means by "a regulation rollover ... does not
 * invalidate the whole table".
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { variantCid, canonicalSpec } from '../variant-cid';
import type { Variant } from '../types';

export const SCHEMA_VERSION = '3';

/** Schema versions this module can open without a separate migration script. */
export const SUPPORTED_SCHEMA_VERSIONS = ['2', '3'];

export interface RunVersions {
  regulation: string;
  policy_id: string;
  policy_version: string;
  calc_version: string;
  engine_version: string;
}

/** The vendored @smogon/calc version string recorded in provenance. */
export function calcVersion(root: string): string {
  const v = JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules', '@smogon', 'calc', 'package.json'), 'utf8'),
  ).version as string;
  return `${v} (champions master, vendored)`;
}

/** True when the db still has the v1 layout (slug-keyed matchups table). */
export function isLegacySchema(db: DatabaseSync): boolean {
  const cols = db.prepare('PRAGMA table_info(matchups)').all() as Array<{ name: string }>;
  return cols.length > 0 && !cols.some((c) => c.name === 'variant_A_cid');
}

export function ensureSchema(db: DatabaseSync): void {
  if (isLegacySchema(db)) {
    throw new Error(
      'data/matchups.sqlite has the v1 (slug-keyed) schema — run: npm run migrate-matchups',
    );
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS variants (
      cid TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      spec TEXT NOT NULL,
      current INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_variants_slug ON variants(slug);
    CREATE TABLE IF NOT EXISTS sim_runs (
      run_id INTEGER PRIMARY KEY AUTOINCREMENT,
      regulation TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      calc_version TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      UNIQUE (regulation, policy_id, policy_version, calc_version, engine_version)
    );
    CREATE TABLE IF NOT EXISTS matchups (
      variant_A_cid TEXT NOT NULL,
      variant_B_cid TEXT NOT NULL,
      condition TEXT NOT NULL,
      run_id INTEGER NOT NULL REFERENCES sim_runs(run_id),
      n_simulated INTEGER NOT NULL,
      wins_A INTEGER NOT NULL,
      wins_B INTEGER NOT NULL,
      draws INTEGER NOT NULL,
      p_A_wins REAL NOT NULL,
      ci_low REAL NOT NULL,
      ci_high REAL NOT NULL,
      mean_turns REAL NOT NULL,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (variant_A_cid, variant_B_cid, condition, run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_A ON matchups(variant_A_cid);
    CREATE INDEX IF NOT EXISTS idx_B ON matchups(variant_B_cid);
    CREATE INDEX IF NOT EXISTS idx_condition ON matchups(condition);
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE VIEW IF NOT EXISTS matchups_current AS
      SELECT va.slug AS variant_A, vb.slug AS variant_B,
             m.condition, m.n_simulated, m.wins_A, m.wins_B, m.draws,
             m.p_A_wins, m.ci_low, m.ci_high, m.mean_turns,
             m.variant_A_cid, m.variant_B_cid
      FROM matchups m
      JOIN variants va ON va.cid = m.variant_A_cid
      JOIN variants vb ON vb.cid = m.variant_B_cid
      WHERE va.current = 1 AND vb.current = 1
        AND m.run_id = (SELECT CAST(value AS INTEGER) FROM metadata WHERE key = 'current_run_id');
  `);
  upgradeRunsToV3(db);
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
    .run('schema_version', SCHEMA_VERSION);
}

/**
 * Add `regulation` to an existing v2 `sim_runs` table (BACKLOG item 03).
 *
 * SQLite cannot widen a UNIQUE constraint in place, so this rebuilds the table.
 * Existing rows take the regulation the file already pinned in `metadata`; a
 * file predating even that stamp is M-B by construction, since M-B is the only
 * regulation the pipeline has ever been able to produce. `run_id` values are
 * copied verbatim, so the millions of matchup rows referencing them — and the
 * `current_run_id` the view pins on — stay correct without being touched.
 *
 * Idempotent: a table that already has the column is left alone.
 */
function upgradeRunsToV3(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(sim_runs)').all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === 'regulation')) return;

  const pinned = db
    .prepare('SELECT value FROM metadata WHERE key = ?')
    .get('regulation') as { value: string } | undefined;
  const regulation = pinned?.value ?? 'M-B';

  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE sim_runs_v3 (
        run_id INTEGER PRIMARY KEY AUTOINCREMENT,
        regulation TEXT NOT NULL,
        policy_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        calc_version TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        UNIQUE (regulation, policy_id, policy_version, calc_version, engine_version)
      );
    `);
    db.prepare(`
      INSERT INTO sim_runs_v3
        (run_id, regulation, policy_id, policy_version, calc_version, engine_version)
      SELECT run_id, ?, policy_id, policy_version, calc_version, engine_version FROM sim_runs
    `).run(regulation);
    db.exec('DROP TABLE sim_runs');
    db.exec('ALTER TABLE sim_runs_v3 RENAME TO sim_runs');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Insert-or-find the run row for a version tuple; returns its run_id. */
export function upsertRun(db: DatabaseSync, v: RunVersions): number {
  db.prepare(`
    INSERT OR IGNORE INTO sim_runs
      (regulation, policy_id, policy_version, calc_version, engine_version)
    VALUES (?, ?, ?, ?, ?)
  `).run(v.regulation, v.policy_id, v.policy_version, v.calc_version, v.engine_version);
  const row = db.prepare(`
    SELECT run_id FROM sim_runs
    WHERE regulation = ? AND policy_id = ? AND policy_version = ?
      AND calc_version = ? AND engine_version = ?
  `).get(
    v.regulation, v.policy_id, v.policy_version, v.calc_version, v.engine_version,
  ) as { run_id: number };
  return row.run_id;
}

/**
 * Upsert the given variants and mark exactly them as `current`. Slugs may be
 * reused across refreshes with changed contents — the cid keeps identities
 * apart; retired cids stay as cache rows with current = 0.
 */
export function syncVariants(db: DatabaseSync, variants: Variant[]): Map<string, string> {
  const slugToCid = new Map<string, string>();
  db.exec('UPDATE variants SET current = 0');
  const stmt = db.prepare(`
    INSERT INTO variants (cid, slug, spec, current) VALUES (?, ?, ?, 1)
    ON CONFLICT(cid) DO UPDATE SET slug = excluded.slug, spec = excluded.spec, current = 1
  `);
  for (const v of variants) {
    const cid = v.cid ?? variantCid(v);
    stmt.run(cid, v.id, JSON.stringify(canonicalSpec(v)));
    slugToCid.set(v.id, cid);
  }
  return slugToCid;
}

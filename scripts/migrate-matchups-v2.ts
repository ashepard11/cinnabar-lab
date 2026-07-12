/**
 * scripts/migrate-matchups-v2.ts — one-time migration of data/matchups.sqlite
 * from the v1 slug-keyed schema to schema v2 (content-addressed cids +
 * provenance run keys; BACKLOG item 02, DECISIONS.md D34).
 *
 * Re-keys existing rows without re-simulating anything: results are
 * deterministic and the seeding scheme is unchanged, so the v1 rows remain
 * valid — they were produced by the version tuple already recorded in the v1
 * metadata table (engine_version initialized to the current constant, which
 * matches: the engine has not changed since the matrix was built).
 *
 * Idempotent: exits cleanly if the db is already v2.
 *
 *   npm run migrate-matchups
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { ensureSchemaV2, isLegacySchema, syncVariants, upsertRun, SCHEMA_VERSION } from '../lib/analysis/schema';
import { SIM_ENGINE_VERSION } from '../lib/sim/engine';
import type { VariantsData } from '../lib/types';

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'matchups.sqlite');

function main() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 10000;');

  if (!isLegacySchema(db)) {
    console.log('matchups.sqlite is already schema v2 — nothing to do');
    db.close();
    return;
  }

  const meta: Record<string, string> = {};
  for (const row of db.prepare('SELECT key, value FROM metadata').all() as any[]) {
    meta[row.key] = row.value;
  }
  for (const k of ['policy_id', 'policy_version', 'calc_version']) {
    if (!meta[k]) throw new Error(`v1 metadata is missing ${k} — cannot attribute existing rows`);
  }

  const data: VariantsData = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data', 'defender-variants.json'), 'utf8'),
  );

  const oldCount = (db.prepare('SELECT COUNT(*) c FROM matchups').get() as any).c as number;
  const slugs = (db.prepare('SELECT DISTINCT variant_A s FROM matchups').all() as any[]).map((r) => r.s);
  console.log(`v1 db: ${oldCount} rows, ${slugs.length} distinct variants`);

  db.exec('BEGIN');
  db.exec('ALTER TABLE matchups RENAME TO matchups_v1');
  ensureSchemaV2(db);

  const slugToCid = syncVariants(db, data.variants);
  const unknown = slugs.filter((s) => !slugToCid.has(s));
  if (unknown.length) {
    throw new Error(
      `matchup rows reference ${unknown.length} variant(s) not in defender-variants.json ` +
      `(${unknown.slice(0, 5).join(', ')}…) — the json and sqlite are out of sync; aborting`,
    );
  }

  const runId = upsertRun(db, {
    policy_id: meta.policy_id,
    policy_version: meta.policy_version,
    calc_version: meta.calc_version,
    engine_version: SIM_ENGINE_VERSION,
  });

  db.prepare(`
    INSERT INTO matchups
      (variant_A_cid, variant_B_cid, condition, run_id, n_simulated, wins_A, wins_B,
       draws, p_A_wins, ci_low, ci_high, mean_turns, generated_at)
    SELECT va.cid, vb.cid, o.condition, ?, o.n_simulated, o.wins_A, o.wins_B,
           o.draws, o.p_A_wins, o.ci_low, o.ci_high, o.mean_turns, o.generated_at
    FROM matchups_v1 o
    JOIN variants va ON va.slug = o.variant_A
    JOIN variants vb ON vb.slug = o.variant_B
  `).run(runId);

  const newCount = (db.prepare('SELECT COUNT(*) c FROM matchups').get() as any).c as number;
  if (newCount !== oldCount) {
    throw new Error(`row count mismatch after re-key: ${newCount} != ${oldCount}; aborting`);
  }

  // Spot-check equivalence via the view before dropping the old table.
  const metaStmt = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  metaStmt.run('schema_version', SCHEMA_VERSION);
  metaStmt.run('current_run_id', String(runId));
  metaStmt.run('engine_version', SIM_ENGINE_VERSION);
  metaStmt.run('migrated_at', new Date().toISOString());

  let checked = 0;
  const sample = db.prepare('SELECT * FROM matchups_v1 WHERE (rowid % 97) = 0').all() as any[];
  const probe = db.prepare(
    'SELECT * FROM matchups_current WHERE variant_A = ? AND variant_B = ? AND condition = ?',
  );
  for (const o of sample) {
    const n = probe.get(o.variant_A, o.variant_B, o.condition) as any;
    if (!n || n.wins_A !== o.wins_A || n.wins_B !== o.wins_B || n.n_simulated !== o.n_simulated
      || n.p_A_wins !== o.p_A_wins || n.mean_turns !== o.mean_turns) {
      throw new Error(`view mismatch for ${o.variant_A} vs ${o.variant_B} [${o.condition}]; aborting`);
    }
    checked++;
  }
  console.log(`re-keyed ${newCount} rows as run ${runId}; view spot-check: ${checked} rows equal`);

  db.exec('DROP TABLE matchups_v1');
  db.exec('COMMIT');
  db.exec('VACUUM');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();
  console.log('migration complete (schema v2)');
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}

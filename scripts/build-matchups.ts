/**
 * scripts/build-matchups.ts — build the full matchup matrix (Phase 4).
 *
 *   npm run build-matchups [-- --workers 8] [--maxN 200] [--limit 100]
 *
 * For every unordered variant pair {A, B} (A != B) × each of the 10 starting
 * conditions, runs estimateMatchup(A, B, condition) in a worker pool and
 * writes TWO rows per simulation into data/matchups.sqlite: the simulated
 * (A, B, condition) row and its exact mirror (B, A, mirror(condition)) —
 * a battle's outcome is symmetric under relabeling, and the deterministic
 * seeds make this equivalent to (and cheaper than) simulating both orders
 * (SPEC-sim.md Phase 4 notes the redundancy).
 *
 * Incremental: already-present rows are skipped on restart, so a crash loses
 * at most the in-flight cells — and, since rows key on content ids, a rescrape
 * that moved a few variants costs only the pairs involving them. The cell
 * selection, worker pool and row writing are shared with
 * scripts/refresh-matchups.ts (BACKLOG item 03), which wraps the same work in
 * a cost report and a guard against unintentionally paying for a rebuild.
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { CONDITION_IDS, mirrorCondition, type ConditionId } from '../lib/sim/condition';
import { mirrorResult, type MatchupResult } from '../lib/sim/harness';
import { getPolicy, DEFAULT_POLICY_ID } from '../lib/sim/policy';
import { SIM_ENGINE_VERSION, SIM_FORMAT, SIM_REGULATION, SHOWDOWN_COMMIT } from '../lib/sim/engine';
import {
  SCHEMA_VERSION, calcVersion, ensureSchema, syncVariants, upsertRun,
} from '../lib/analysis/schema';
import { runPool, defaultWorkerCount } from '../lib/analysis/pool';
import { pendingUnits } from '../lib/analysis/refresh';
import type { VariantsData } from '../lib/types';

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'matchups.sqlite');
const VARIANTS_PATH = path.join(ROOT, 'data', 'defender-variants.json');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function openDb(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 10000;'); // survive transient reader locks
  ensureSchema(db);
  return db;
}

/** Record provenance and pin the view to this build's run. Returns run_id. */
function writeMetadata(db: DatabaseSync, policyId: string): number {
  const policy = getPolicy(policyId);
  const runId = upsertRun(db, {
    regulation: SIM_REGULATION.regulation_id,
    policy_id: policy.id,
    policy_version: policy.version,
    calc_version: calcVersion(ROOT),
    engine_version: SIM_ENGINE_VERSION,
  });
  const stmt = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  const meta: Record<string, string> = {
    schema_version: SCHEMA_VERSION,
    current_run_id: String(runId),
    policy_id: policy.id,
    policy_version: policy.version,
    calc_version: calcVersion(ROOT),
    engine_version: SIM_ENGINE_VERSION,
    showdown_commit: SHOWDOWN_COMMIT,
    seeding_scheme: 'sha256(matchup::A:B:condition:iteration) -> sodium',
    regulation: SIM_REGULATION.regulation_id,
    format: `${SIM_FORMAT} (1v1; see DECISIONS.md D21)`,
    built_at: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(meta)) stmt.run(k, v);
  return runId;
}

async function main() {
  const workers = Number(arg('workers', String(defaultWorkerCount())));
  const maxN = Number(arg('maxN', '200'));
  const limit = Number(arg('limit', '0')); // 0 = no limit (debug aid)
  const policyId = arg('policy', DEFAULT_POLICY_ID);

  const data: VariantsData = JSON.parse(fs.readFileSync(VARIANTS_PATH, 'utf8'));
  console.log(
    `${data.variants.length} variants, ${CONDITION_IDS.length} conditions, policy ${policyId}`,
  );

  const db = openDb();
  const runId = writeMetadata(db, policyId);
  const slugToCid = syncVariants(db, data.variants);
  const cidOf = (slug: string): string => {
    const cid = slugToCid.get(slug);
    if (!cid) throw new Error(`no cid for variant ${slug}`);
    return cid;
  };

  // Resume support and incremental behaviour both come from the same place
  // (BACKLOG item 03): ask the database which cells are already recorded under
  // this run and simulate the rest. A crash therefore loses at most the
  // in-flight cells, and a rescrape that moved a few variants costs only the
  // pairs involving them — without this script needing to know which case it
  // is in. `npm run refresh-matchups` is the same machinery with a report and
  // a guard against unintentionally paying for a full rebuild.
  let units = pendingUnits(db, data.variants, runId, CONDITION_IDS).map((u) => ({
    aSlug: u.aSlug,
    bSlug: u.bSlug,
    condition: u.condition,
  }));
  if (limit > 0) units = units.slice(0, limit);
  const total = units.length;
  const present = (
    db.prepare('SELECT COUNT(*) c FROM matchups WHERE run_id = ?').get(runId) as { c: number }
  ).c;
  console.log(`${total} cells to simulate (${present} rows already present), ${workers} workers`);
  if (total === 0) {
    console.log('nothing to do');
    db.close();
    return;
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO matchups
    (variant_A_cid, variant_B_cid, condition, run_id, n_simulated, wins_A, wins_B, draws,
     p_A_wins, ci_low, ci_high, mean_turns, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const writeRow = (r: MatchupResult) => {
    insert.run(
      cidOf(r.variant_A_id), cidOf(r.variant_B_id), r.condition, runId, r.n_simulated,
      r.wins_A, r.wins_B, r.draws, r.p_A_wins, r.ci_low, r.ci_high, r.mean_turns,
      new Date().toISOString(),
    );
  };

  const t0 = Date.now();
  const summary = await runPool({
    units,
    variantsPath: VARIANTS_PATH,
    policyId,
    maxN,
    workers,
    onResult: (result, unit) => {
      writeRow(result);
      writeRow(mirrorResult(result, mirrorCondition(unit.condition as ConditionId)));
    },
    onError: (error, unit) =>
      console.error(`ERROR ${unit.aSlug} vs ${unit.bSlug} [${unit.condition}]: ${error}`),
    onProgress: (p) =>
      console.log(
        `${p.done}/${p.total} (${((p.done / p.total) * 100).toFixed(1)}%) — ` +
        `${p.rate.toFixed(1)} cells/s (window) — ETA ${(p.etaSeconds / 60).toFixed(1)} min`,
      ),
  });
  const done = summary.done;
  const errors = summary.errors;

  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const count = (db.prepare('SELECT COUNT(*) AS c FROM matchups WHERE run_id = ?').get(runId) as any).c;
  db.close();
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\ndone: ${done} cells simulated, ${errors} errors, ${count} rows total, ${mins} min`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

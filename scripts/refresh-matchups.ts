/**
 * scripts/refresh-matchups.ts — incremental matrix refresh (BACKLOG item 03).
 *
 *   npm run refresh-matchups -- --dry-run      # plan only, touches nothing
 *   npm run refresh-matchups                   # simulate the difference
 *   npm run refresh-matchups -- --prune        # ...and drop unreachable rows
 *   npm run refresh-matchups -- --full         # allow a full rebuild
 *
 * The full build (`npm run build-matchups`) still exists and still does the
 * same thing. The difference is that this one says what a change costs before
 * paying for it, and refuses to silently spend hours: if the run key is new —
 * a policy, calc, engine or regulation change — nothing is reusable, and that
 * is a rebuild, so it stops unless `--full` says otherwise.
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
import { planRefresh, pendingUnits, prune, formatPlan } from '../lib/analysis/refresh';
import { runPool, defaultWorkerCount } from '../lib/analysis/pool';
import { variantCid } from '../lib/variant-cid';
import type { VariantsData } from '../lib/types';

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'matchups.sqlite');
const VARIANTS_PATH = path.join(ROOT, 'data', 'defender-variants.json');

const has = (name: string) => process.argv.includes(`--${name}`);
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const dryRun = has('dry-run');
  const doPrune = has('prune');
  const allowFull = has('full');
  const asJson = has('json');
  const policyId = arg('policy', DEFAULT_POLICY_ID);
  const workers = Number(arg('workers', String(defaultWorkerCount())));
  const maxN = Number(arg('maxN', '200'));

  const data: VariantsData = JSON.parse(fs.readFileSync(VARIANTS_PATH, 'utf8'));

  // A dry run must not create the file or migrate it, or "planning" would be a
  // write. Anything else opens read-write, which is also what upgrades a v2
  // file's sim_runs table to v3.
  if (dryRun && !fs.existsSync(DB_PATH)) {
    console.error(`${DB_PATH} does not exist — nothing to refresh.`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH, dryRun ? { readOnly: true } : {});
  if (!dryRun) {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 10000;');
    ensureSchema(db);
  }

  const policy = getPolicy(policyId);
  const versions = {
    regulation: SIM_REGULATION.regulation_id,
    policy_id: policy.id,
    policy_version: policy.version,
    calc_version: calcVersion(ROOT),
    engine_version: SIM_ENGINE_VERSION,
  };

  const plan = planRefresh(db, data.variants, versions, CONDITION_IDS);

  if (asJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`${data.variants.length} variants, ${CONDITION_IDS.length} conditions\n`);
    console.log(formatPlan(plan));
    console.log('');
  }

  if (dryRun) {
    db.close();
    return;
  }

  if (plan.full_rebuild && !allowFull) {
    console.error(
      `\nRefusing to run: this is a full rebuild, not a refresh — ${plan.cells.to_simulate.toLocaleString()} ` +
        `cells with nothing reusable.\nRe-run with --full if that is what you want, or use ` +
        `npm run build-matchups.`
    );
    db.close();
    process.exit(2);
  }

  if (plan.cells.to_simulate === 0 && !doPrune) {
    console.log('nothing to simulate');
    db.close();
    return;
  }

  // Only now does the variant set become "current" — a plan that was never
  // acted on must not move the flag the matchups_current view reads.
  const runId = upsertRun(db, versions);
  const slugToCid = syncVariants(db, data.variants);
  const cidOf = (slug: string): string => {
    const cid = slugToCid.get(slug);
    if (!cid) throw new Error(`no cid for variant ${slug}`);
    return cid;
  };

  const metaStmt = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  const writeMeta = (extra: Record<string, string>) => {
    for (const [k, v] of Object.entries(extra)) metaStmt.run(k, v);
  };
  writeMeta({
    schema_version: SCHEMA_VERSION,
    current_run_id: String(runId),
    policy_id: policy.id,
    policy_version: policy.version,
    calc_version: versions.calc_version,
    engine_version: SIM_ENGINE_VERSION,
    showdown_commit: SHOWDOWN_COMMIT,
    seeding_scheme: 'sha256(matchup::A:B:condition:iteration) -> sodium',
    regulation: versions.regulation,
    format: `${SIM_FORMAT} (1v1; see DECISIONS.md D21)`,
  });

  const units = pendingUnits(db, data.variants, runId, CONDITION_IDS);
  if (units.length > 0) {
    console.log(`simulating ${units.length.toLocaleString()} cells on ${workers} workers\n`);

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
        new Date().toISOString()
      );
    };

    const summary = await runPool({
      units,
      variantsPath: VARIANTS_PATH,
      policyId,
      maxN,
      workers,
      onResult: (result, unit) => {
        writeRow(result);
        // A battle's outcome is symmetric under relabeling and the seeds are
        // deterministic, so the mirror row is derived rather than simulated.
        writeRow(mirrorResult(result, mirrorCondition(unit.condition as ConditionId)));
      },
      onError: (error, unit) =>
        console.error(`ERROR ${unit.aSlug} vs ${unit.bSlug} [${unit.condition}]: ${error}`),
      onProgress: (p) =>
        console.log(
          `${p.done}/${p.total} (${((p.done / p.total) * 100).toFixed(1)}%) — ` +
            `${p.rate.toFixed(1)} cells/s — ETA ${(p.etaSeconds / 60).toFixed(1)} min`
        ),
    });

    writeMeta({ built_at: new Date().toISOString() });
    console.log(
      `\nsimulated ${summary.done} cells, ${summary.errors} errors, ` +
        `${(summary.elapsedMs / 60000).toFixed(1)} min`
    );
    if (summary.errors > 0) {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      db.close();
      process.exit(1);
    }
  }

  if (doPrune) {
    const liveCids = new Set(data.variants.map((v) => v.cid ?? variantCid(v)));
    const before = fs.statSync(DB_PATH).size;
    const result = prune(db, liveCids, { staleRuns: has('prune-runs') });
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec('VACUUM;');
    const after = fs.statSync(DB_PATH).size;
    console.log(
      `pruned ${result.rows_deleted.toLocaleString()} rows and ${result.runs_deleted} run(s); ` +
        `file ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`
    );
  }

  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const rows = (
    db.prepare('SELECT COUNT(*) c FROM matchups WHERE run_id = ?').get(runId) as { c: number }
  ).c;
  db.close();
  console.log(`run #${runId} now holds ${rows.toLocaleString()} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

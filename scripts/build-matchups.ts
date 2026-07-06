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
 * Incremental: already-present rows are skipped on restart, so a crash
 * loses at most the in-flight cells.
 */
import { Worker } from 'worker_threads';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CONDITION_IDS, mirrorCondition, type ConditionId } from '../lib/sim/condition';
import { mirrorResult, type MatchupResult } from '../lib/sim/harness';
import { getPolicy, DEFAULT_POLICY_ID } from '../lib/sim/policy';
import type { VariantsData } from '../lib/types';

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'matchups.sqlite');
const VARIANTS_PATH = path.join(ROOT, 'data', 'defender-variants.json');
const SHOWDOWN_COMMIT = 'e440c4a18385274f10c405d0b158b6a962ce6d94';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

interface WorkUnit {
  aId: string;
  bId: string;
  conditionId: ConditionId;
}

function openDb(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 10000;'); // survive transient reader locks
  db.exec(`
    CREATE TABLE IF NOT EXISTS matchups (
      variant_A TEXT NOT NULL,
      variant_B TEXT NOT NULL,
      condition TEXT NOT NULL,
      n_simulated INTEGER NOT NULL,
      wins_A INTEGER NOT NULL,
      wins_B INTEGER NOT NULL,
      draws INTEGER NOT NULL,
      p_A_wins REAL NOT NULL,
      ci_low REAL NOT NULL,
      ci_high REAL NOT NULL,
      mean_turns REAL NOT NULL,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (variant_A, variant_B, condition)
    );
    CREATE INDEX IF NOT EXISTS idx_A ON matchups(variant_A);
    CREATE INDEX IF NOT EXISTS idx_B ON matchups(variant_B);
    CREATE INDEX IF NOT EXISTS idx_condition ON matchups(condition);
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

function writeMetadata(db: DatabaseSync, policyId: string): void {
  const policy = getPolicy(policyId);
  const calcVersion = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'node_modules', '@smogon', 'calc', 'package.json'), 'utf8'),
  ).version as string;
  const stmt = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  const meta: Record<string, string> = {
    policy_id: policy.id,
    policy_version: policy.version,
    calc_version: `${calcVersion} (champions master, vendored)`,
    showdown_commit: SHOWDOWN_COMMIT,
    seeding_scheme: 'sha256(matchup::A:B:condition:iteration) -> sodium',
    format: 'gen9championsbssregmb (1v1; see DECISIONS.md D21)',
    built_at: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(meta)) stmt.run(k, v);
}

async function main() {
  const workers = Number(arg('workers', String(Math.max(1, os.availableParallelism() - 1))));
  const maxN = Number(arg('maxN', '200'));
  const limit = Number(arg('limit', '0')); // 0 = no limit (debug aid)
  const policyId = arg('policy', DEFAULT_POLICY_ID);

  const data: VariantsData = JSON.parse(fs.readFileSync(VARIANTS_PATH, 'utf8'));
  const ids = data.variants.map((v) => v.id).sort();
  console.log(`${ids.length} variants, ${CONDITION_IDS.length} conditions, policy ${policyId}`);

  const db = openDb();
  writeMetadata(db, policyId);

  // Resume support: skip units whose primary row already exists.
  const existing = new Set<string>();
  for (const row of db.prepare('SELECT variant_A, variant_B, condition FROM matchups').all() as any[]) {
    existing.add(`${row.variant_A}|${row.variant_B}|${row.condition}`);
  }

  // Work units: unordered pairs × all conditions (mirror rows are derived).
  let units: WorkUnit[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (const conditionId of CONDITION_IDS) {
        if (existing.has(`${ids[i]}|${ids[j]}|${conditionId}`)) continue;
        units.push({ aId: ids[i], bId: ids[j], conditionId });
      }
    }
  }
  if (limit > 0) units = units.slice(0, limit);
  const total = units.length;
  console.log(`${total} cells to simulate (${existing.size} rows already present), ${workers} workers`);
  if (total === 0) {
    console.log('nothing to do');
    db.close();
    return;
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO matchups
    (variant_A, variant_B, condition, n_simulated, wins_A, wins_B, draws,
     p_A_wins, ci_low, ci_high, mean_turns, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const writeRow = (r: MatchupResult) => {
    insert.run(
      r.variant_A_id, r.variant_B_id, r.condition, r.n_simulated, r.wins_A,
      r.wins_B, r.draws, r.p_A_wins, r.ci_low, r.ci_high, r.mean_turns,
      new Date().toISOString(),
    );
  };

  let next = 0;
  let done = 0;
  let errors = 0;
  const t0 = Date.now();
  const logEvery = Math.max(1, Math.floor(total / 100));
  let lastLogAt = t0;
  let lastLogDone = 0;
  // Recycle workers periodically: dex/calc caches grow slowly per worker
  // (saturating, but recycling keeps GC pressure flat over multi-hour runs).
  const RECYCLE_AFTER = 400;

  await new Promise<void>((resolve, reject) => {
    const spawnWorker = () => {
      const worker = new Worker(
        `require('tsx/cjs'); require(${JSON.stringify(path.join(__dirname, 'matchup-worker.ts'))});`,
        { eval: true, workerData: { variantsPath: VARIANTS_PATH, policyId, maxN } },
      );
      let completed = 0;
      const dispatch = () => {
        if (next < units.length) {
          if (completed >= RECYCLE_AFTER) {
            worker.postMessage({ type: 'exit' });
            spawnWorker();
            return;
          }
          worker.postMessage({ type: 'work', unit: units[next++] });
        } else {
          worker.postMessage({ type: 'exit' });
        }
      };
      worker.on('message', (msg: any) => {
        if (msg.type === 'ready') {
          dispatch();
        } else if (msg.type === 'result') {
          const r: MatchupResult = msg.result;
          writeRow(r);
          writeRow(mirrorResult(r, mirrorCondition(msg.unit.conditionId)));
          done++;
          completed++;
          if (done % logEvery === 0 || done === total) {
            const now = Date.now();
            const windowRate = (done - lastLogDone) / ((now - lastLogAt) / 1000);
            lastLogAt = now;
            lastLogDone = done;
            const eta = (total - done) / windowRate;
            console.log(
              `${done}/${total} (${((done / total) * 100).toFixed(1)}%) — ` +
              `${windowRate.toFixed(1)} cells/s (window) — ETA ${(eta / 60).toFixed(1)} min`,
            );
          }
          dispatch();
        } else if (msg.type === 'error') {
          errors++;
          console.error(`ERROR ${msg.unit.aId} vs ${msg.unit.bId} [${msg.unit.conditionId}]: ${msg.error}`);
          dispatch();
        }
      });
      worker.on('error', (e) => {
        console.error('worker crashed:', e);
        reject(e);
      });
    };

    for (let w = 0; w < workers; w++) spawnWorker();

    const poll = setInterval(() => {
      if (done + errors >= total) {
        clearInterval(poll);
        resolve();
      }
    }, 1000);
  });

  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const count = (db.prepare('SELECT COUNT(*) AS c FROM matchups').get() as any).c;
  db.close();
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\ndone: ${done} cells simulated, ${errors} errors, ${count} rows total, ${mins} min`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

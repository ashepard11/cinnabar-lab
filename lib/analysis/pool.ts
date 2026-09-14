/**
 * lib/analysis/pool.ts — the worker pool that drives matchup simulation.
 *
 * Lifted out of scripts/build-matchups.ts when the incremental refresh
 * (BACKLOG item 03) became a second caller. The two entry points differ only
 * in which cells they ask for — a full build asks for all of them, a refresh
 * asks for the ones the planner found missing — so the dispatch, recycling and
 * progress accounting live here and neither script owns a private copy that
 * could drift from the other.
 */
import { Worker } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';
import type { MatchupResult } from '../sim/harness';

/** One cell: an unordered pair, named by slug because the worker loads by slug. */
export interface PoolUnit {
  aSlug: string;
  bSlug: string;
  condition: string;
}

export interface PoolOptions {
  units: PoolUnit[];
  variantsPath: string;
  policyId: string;
  maxN: number;
  workers?: number;
  /**
   * Recycle a worker after this many cells. The dex and calc caches each
   * worker owns grow slowly and saturate, but recycling keeps GC pressure flat
   * across a multi-hour run.
   */
  recycleAfter?: number;
  /** Called for each completed cell, in completion order. Writes happen here. */
  onResult: (result: MatchupResult, unit: PoolUnit) => void;
  onError?: (error: string, unit: PoolUnit) => void;
  onProgress?: (p: PoolProgress) => void;
}

export interface PoolProgress {
  done: number;
  total: number;
  errors: number;
  /** Cells per second over the last progress window, not since the start. */
  rate: number;
  etaSeconds: number;
}

export interface PoolSummary {
  done: number;
  errors: number;
  elapsedMs: number;
}

export function defaultWorkerCount(): number {
  return Math.max(1, os.availableParallelism() - 1);
}

/**
 * Run every unit through a pool of workers, resolving once all have been
 * dispatched and answered. Rejects only if a worker thread itself crashes —
 * a cell that throws is reported through `onError` and the run continues, so
 * one bad pair cannot cost an overnight build.
 */
export async function runPool(opts: PoolOptions): Promise<PoolSummary> {
  const {
    units,
    variantsPath,
    policyId,
    maxN,
    workers = defaultWorkerCount(),
    recycleAfter = 400,
    onResult,
    onError,
    onProgress,
  } = opts;

  const total = units.length;
  const t0 = Date.now();
  if (total === 0) return { done: 0, errors: 0, elapsedMs: 0 };

  const workerPath = path.join(__dirname, '..', '..', 'scripts', 'matchup-worker.ts');
  let next = 0;
  let done = 0;
  let errors = 0;
  const logEvery = Math.max(1, Math.floor(total / 100));
  let lastLogAt = t0;
  let lastLogDone = 0;

  await new Promise<void>((resolve, reject) => {
    const spawnWorker = () => {
      const worker = new Worker(
        `require('tsx/cjs'); require(${JSON.stringify(workerPath)});`,
        { eval: true, workerData: { variantsPath, policyId, maxN } }
      );
      let completed = 0;
      const dispatch = () => {
        if (next < units.length) {
          if (completed >= recycleAfter) {
            worker.postMessage({ type: 'exit' });
            spawnWorker();
            return;
          }
          const u = units[next++];
          worker.postMessage({
            type: 'work',
            unit: { aId: u.aSlug, bId: u.bSlug, conditionId: u.condition },
          });
        } else {
          worker.postMessage({ type: 'exit' });
        }
      };
      worker.on('message', (msg: any) => {
        if (msg.type === 'ready') {
          dispatch();
          return;
        }
        const unit: PoolUnit = {
          aSlug: msg.unit.aId,
          bSlug: msg.unit.bId,
          condition: msg.unit.conditionId,
        };
        if (msg.type === 'result') {
          onResult(msg.result as MatchupResult, unit);
          done++;
          completed++;
          if (onProgress && (done % logEvery === 0 || done === total)) {
            const now = Date.now();
            const rate = (done - lastLogDone) / Math.max(1e-3, (now - lastLogAt) / 1000);
            lastLogAt = now;
            lastLogDone = done;
            onProgress({ done, total, errors, rate, etaSeconds: (total - done) / rate });
          }
        } else if (msg.type === 'error') {
          errors++;
          onError?.(msg.error, unit);
        }
        dispatch();
      });
      worker.on('error', reject);
    };

    for (let w = 0; w < workers; w++) spawnWorker();

    const poll = setInterval(() => {
      if (done + errors >= total) {
        clearInterval(poll);
        resolve();
      }
    }, 1000);
  });

  return { done, errors, elapsedMs: Date.now() - t0 };
}

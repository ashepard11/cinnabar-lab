/**
 * scripts/matchup-worker.ts — worker_threads worker for the matrix build.
 *
 * Receives work units { aId, bId, conditionId } from the parent, runs
 * estimateMatchup, posts back the result. Each worker owns its own Showdown
 * dex + calc instances (no shared globals, per spec).
 */
import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import { estimateMatchup } from '../lib/sim/harness';
import type { ConditionId } from '../lib/sim/condition';
import type { Variant, VariantsData } from '../lib/types';

interface WorkUnit {
  aId: string;
  bId: string;
  conditionId: ConditionId;
}

const { variantsPath, policyId, maxN } = workerData as {
  variantsPath: string;
  policyId: string;
  maxN: number;
};

const data: VariantsData = JSON.parse(fs.readFileSync(variantsPath, 'utf8'));
const byId = new Map<string, Variant>(data.variants.map((v) => [v.id, v]));

if (!parentPort) throw new Error('must run as a worker thread');
const port = parentPort;

port.on('message', (msg: { type: 'work'; unit: WorkUnit } | { type: 'exit' }) => {
  if (msg.type === 'exit') {
    process.exit(0);
  }
  const { aId, bId, conditionId } = msg.unit;
  const A = byId.get(aId);
  const B = byId.get(bId);
  if (!A || !B) {
    port.postMessage({ type: 'error', unit: msg.unit, error: `unknown variant ${!A ? aId : bId}` });
    return;
  }
  estimateMatchup(A, B, conditionId, { n: maxN, policyId })
    .then((result) => {
      // strip logs field if any; keep the message light
      const { battles: _battles, ...row } = result;
      port.postMessage({ type: 'result', unit: msg.unit, result: row });
    })
    .catch((e) => {
      port.postMessage({ type: 'error', unit: msg.unit, error: String(e?.stack ?? e) });
    });
});

port.postMessage({ type: 'ready' });

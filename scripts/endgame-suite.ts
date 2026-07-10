/**
 * scripts/endgame-suite.ts — the endgame test suite (BACKLOG item 01).
 *
 * Runs the current policy over known-hard 1v1 endgames (scripts/endgame-cases.ts)
 * and reports, per case, the measured P(A wins) against the consensus floor —
 * the delta quantifies how far the policy is from correct play.
 *
 * CI gate: results are compared to a recorded baseline
 * (data/endgame-baseline.json). Consensus misses do NOT fail the build — the
 * suite exists to measure them (fixing the policy is BACKLOG item 07). What
 * fails the build is a REGRESSION: any case whose win rate drops more than
 * REGRESSION_EPS below its recorded baseline. Battles are deterministically
 * seeded, so unchanged code reproduces the baseline exactly.
 *
 * Usage:
 *   npm run endgame-suite                      # run + gate against baseline
 *   npm run endgame-suite -- --update-baseline # re-record the baseline
 *   npm run endgame-suite -- --case <id> [--verbose]  # debug one case
 */
import { estimateMatchup } from '../lib/sim/harness';
import { getPolicy, DEFAULT_POLICY_ID, clearDamageCache } from '../lib/sim/policy';
import { ENDGAME_CASES } from './endgame-cases';
import * as fs from 'fs';
import * as path from 'path';

const BASELINE_PATH = path.join(__dirname, '..', 'data', 'endgame-baseline.json');

/** Max battles per case / min before adaptive early stop. */
const N = 120;
const MIN_N = 40;

/**
 * Battles are deterministically seeded, so a code-identical run reproduces the
 * baseline exactly; the epsilon only absorbs hypothetical cross-platform float
 * drift. Any drop beyond it is a real behavior change.
 */
const REGRESSION_EPS = 0.02;

interface BaselineFile {
  policy_id: string;
  policy_version: string;
  n: number;
  min_n: number;
  recorded_at: string;
  results: Record<string, {
    p_A_wins: number;
    wins_A: number;
    wins_B: number;
    draws: number;
    n_simulated: number;
    mean_turns: number;
    consensus_met: boolean;
  }>;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const caseIdx = args.indexOf('--case');
  return {
    updateBaseline: args.includes('--update-baseline'),
    caseId: caseIdx >= 0 ? args[caseIdx + 1] : undefined,
    verbose: args.includes('--verbose'),
  };
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

async function main() {
  const { updateBaseline, caseId, verbose } = parseArgs();
  const policy = getPolicy(DEFAULT_POLICY_ID);
  const cases = caseId ? ENDGAME_CASES.filter((c) => c.id === caseId) : ENDGAME_CASES;
  if (cases.length === 0) {
    console.error(`no case with id "${caseId}" — known ids:\n  ${ENDGAME_CASES.map((c) => c.id).join('\n  ')}`);
    process.exit(1);
  }
  if (updateBaseline && caseId) {
    console.error('--update-baseline records all cases; do not combine with --case');
    process.exit(1);
  }

  let baseline: BaselineFile | undefined;
  if (!updateBaseline && !caseId) {
    // --case is a report-only debug mode: no baseline gate.
    if (!fs.existsSync(BASELINE_PATH)) {
      console.error(`no baseline at ${BASELINE_PATH} — run: npm run endgame-suite -- --update-baseline`);
      process.exit(1);
    }
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    if (baseline!.policy_id !== policy.id || baseline!.policy_version !== policy.version) {
      console.error(
        `baseline was recorded for policy ${baseline!.policy_id}@${baseline!.policy_version} ` +
        `but current is ${policy.id}@${policy.version}.\n` +
        'Review the new deltas, then re-record: npm run endgame-suite -- --update-baseline',
      );
      process.exit(1);
    }
  }

  console.log(`=== Endgame suite: ${cases.length} case(s), policy ${policy.id}@${policy.version}, n<=${N} (min ${MIN_N}) ===\n`);

  const results: BaselineFile['results'] = {};
  let regressions = 0;
  let missingBaselines = 0;
  let improvements = 0;
  let consensusMet = 0;
  let totalShortfall = 0;
  const t0 = Date.now();

  for (const c of cases) {
    clearDamageCache();
    const caseT0 = Date.now();
    const r = await estimateMatchup(c.side_A, c.side_B, 'fresh', {
      n: N, minN: MIN_N, seedNamespace: 'endgame', collectLogs: verbose,
    });
    const secs = ((Date.now() - caseT0) / 1000).toFixed(0);

    const met = r.p_A_wins >= c.expected_p_min;
    const shortfall = met ? 0 : c.expected_p_min - r.p_A_wins;
    if (met) consensusMet++;
    totalShortfall += shortfall;
    results[c.id] = {
      p_A_wins: r.p_A_wins, wins_A: r.wins_A, wins_B: r.wins_B, draws: r.draws,
      n_simulated: r.n_simulated, mean_turns: r.mean_turns, consensus_met: met,
    };

    const consensus = met
      ? `MEETS consensus (floor ${pct(c.expected_p_min)})`
      : `MISSES consensus by ${pct(shortfall)} (floor ${pct(c.expected_p_min)})`;

    let gate = '';
    if (baseline) {
      const b = baseline.results[c.id];
      if (!b) {
        missingBaselines++;
        gate = '  NEW CASE — not in baseline, re-record';
      } else if (r.p_A_wins < b.p_A_wins - REGRESSION_EPS) {
        regressions++;
        gate = `  REGRESSION vs baseline ${pct(b.p_A_wins)}`;
      } else if (r.p_A_wins > b.p_A_wins + REGRESSION_EPS) {
        improvements++;
        gate = `  improved vs baseline ${pct(b.p_A_wins)} (consider re-recording)`;
      }
    }

    console.log(`${met ? ' ok ' : 'MISS'} ${c.label}`);
    console.log(
      `      P(A)=${pct(r.p_A_wins)} [${pct(r.ci_low)}, ${pct(r.ci_high)}]  ` +
      `${r.wins_A}-${r.wins_B}-${r.draws} of ${r.n_simulated}, mean ${r.mean_turns.toFixed(1)} turns, ${secs}s  — ${consensus}${gate}`,
    );
    if (verbose && r.battles?.[0]?.log) {
      console.log('\n----- first battle log -----');
      console.log(r.battles[0].log.join('\n'));
      console.log('----- end log -----\n');
    }
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n=== consensus: ${consensusMet}/${cases.length} met, total shortfall ${pct(totalShortfall)} — ${mins} min ===`);

  if (updateBaseline) {
    const file: BaselineFile = {
      policy_id: policy.id, policy_version: policy.version,
      n: N, min_n: MIN_N, recorded_at: new Date().toISOString(), results,
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(file, null, 2) + '\n');
    console.log(`baseline written to ${BASELINE_PATH}`);
    return;
  }

  if (baseline && !caseId) {
    const stale = Object.keys(baseline.results).filter((id) => !ENDGAME_CASES.some((c) => c.id === id));
    if (stale.length) {
      console.error(`baseline has ${stale.length} case(s) no longer in the suite (${stale.join(', ')}) — re-record`);
      process.exit(1);
    }
  }
  if (regressions > 0 || missingBaselines > 0) {
    console.error(`\n${regressions} regression(s), ${missingBaselines} case(s) missing from baseline — FAIL`);
    process.exit(1);
  }
  if (improvements > 0) {
    console.log(`\n${improvements} case(s) improved beyond baseline — consider re-recording to lock in the gains`);
  }
  if (baseline) console.log('gate: PASS (no regressions vs baseline)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * lib/sim/harness.ts — battle harness (SPEC-sim.md Phase 3).
 *
 * estimateMatchup(A, B, condition, n) runs seeded 1v1 battles and returns
 * P(A wins) with a Wilson 95% CI.
 *
 * Reproducibility: every battle's seed derives deterministically from
 * (variant_A, variant_B, condition_id, iteration) — re-running the harness
 * on the same inputs gives identical results, across runs and workers.
 *
 * Adaptive sampling: batches of 20 up to `n`, stopping early when
 *  - the matchup is clearly one-sided (p̂ outside [0.05, 0.95] after ≥20), or
 *  - the CI is tight (width ≤ 0.10 after ≥40).
 */
import type { Variant } from '../types';
import { runBattle, type BattleResult } from './engine';
import { variantToSet } from './sets';
import { applyCondition, CONDITIONS, type ConditionId, type StartingCondition } from './condition';
import { getPolicy, clearDamageCache, DEFAULT_POLICY_ID } from './policy';

export interface MatchupResult {
  variant_A_id: string;
  variant_B_id: string;
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

export interface EstimateOptions {
  /** Max battles (default 200). */
  n?: number;
  /** Min battles before any early stop (default 20). */
  minN?: number;
  /** Policy id for both sides (default DEFAULT_POLICY_ID). */
  policyId?: string;
  /** Extra seed namespace so different runs can't collide (default ''). */
  seedNamespace?: string;
  /** Collect logs of every battle (inspect-matchup); heavy, default false. */
  collectLogs?: boolean;
}

export interface EstimateOutput extends MatchupResult {
  /** Present only when collectLogs was set. */
  battles?: BattleResult[];
}

/** Wilson score interval (95%) for a binomial proportion. */
export function wilson(successes: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.959963984540054;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export function battleSeed(
  aId: string, bId: string, conditionId: string, iteration: number, namespace = '',
): string {
  return `matchup:${namespace}:${aId}:${bId}:${conditionId}:${iteration}`;
}

export async function estimateMatchup(
  variant_A: Variant,
  variant_B: Variant,
  conditionId: ConditionId,
  options: EstimateOptions = {},
): Promise<EstimateOutput> {
  const n = options.n ?? 200;
  const minN = options.minN ?? 20;
  const policyId = options.policyId ?? DEFAULT_POLICY_ID;
  const condition: StartingCondition = CONDITIONS[conditionId];

  const setA = variantToSet(variant_A);
  const setB = variantToSet(variant_B);

  // Fresh calc memo per matchup cell (bounds memory; the cache is only hot
  // within a cell anyway).
  clearDamageCache();

  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let turnsTotal = 0;
  let simulated = 0;
  const battles: BattleResult[] = [];

  const batch = 20;
  while (simulated < n) {
    const target = Math.min(n, simulated + batch);
    for (; simulated < target; simulated++) {
      const result = await runBattle({
        side_A: setA,
        side_B: setB,
        policy_A: getPolicy(policyId),
        policy_B: getPolicy(policyId),
        seed: battleSeed(variant_A.id, variant_B.id, conditionId, simulated, options.seedNamespace),
        collectLog: options.collectLogs,
        onBattleStart: (battle) => applyCondition(battle, condition),
      });
      if (result.winner === 'A') winsA++;
      else if (result.winner === 'B') winsB++;
      else draws++;
      turnsTotal += result.turns;
      if (options.collectLogs) battles.push(result);
    }

    if (simulated >= minN) {
      const p = winsA / simulated;
      if (p >= 0.95 || p <= 0.05) break;                 // clearly one-sided
      const ci = wilson(winsA, simulated);
      if (simulated >= 2 * minN && ci.high - ci.low <= 0.10) break; // converged
    }
  }

  const ci = wilson(winsA, simulated);
  const out: EstimateOutput = {
    variant_A_id: variant_A.id,
    variant_B_id: variant_B.id,
    condition: conditionId,
    n_simulated: simulated,
    wins_A: winsA,
    wins_B: winsB,
    draws,
    p_A_wins: winsA / simulated,
    ci_low: ci.low,
    ci_high: ci.high,
    mean_turns: turnsTotal / simulated,
  };
  if (options.collectLogs) out.battles = battles;
  return out;
}

/** Exact mirror of a result under side swap — used for symmetric-condition
 * rows and mirrored asymmetric conditions in the matrix build. */
export function mirrorResult(r: MatchupResult, mirroredConditionId: string): MatchupResult {
  const ci = wilson(r.wins_B, r.n_simulated);
  return {
    variant_A_id: r.variant_B_id,
    variant_B_id: r.variant_A_id,
    condition: mirroredConditionId,
    n_simulated: r.n_simulated,
    wins_A: r.wins_B,
    wins_B: r.wins_A,
    draws: r.draws,
    p_A_wins: r.wins_B / r.n_simulated,
    ci_low: ci.low,
    ci_high: ci.high,
    mean_turns: r.mean_turns,
  };
}

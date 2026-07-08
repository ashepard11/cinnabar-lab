/**
 * lib/analysis/team.ts — team-building coverage analysis (SPEC-sim.md Phase 5).
 *
 * Given a "team core" of 1–4 variants, rank other variants by how much they
 * improve the core's worst matchups, weighted by opponent usage.
 */
import { matchupsFor, variantIds, type VariantId } from './matrix';
import type { ConditionId } from '../sim/condition';

export interface PartnerSuggestion {
  variant: VariantId;
  coverage_score: number;
  /** Top opponent improvements, for display. */
  details: string;
  top_improvements: Array<{ opponent: VariantId; before: number; after: number }>;
}

/**
 * Urgency weighting (spec refinement): improvements against opponents the
 * core already beats comfortably matter less than improvements against
 * uncertain or losing matchups. Linear in the core's current best win rate:
 *   urgency(p0) = 1.5 − p0   (0.5 at p0=1, 1.0 at p0=0.5, 1.5 at p0=0)
 * Chosen for monotonicity and transparency; the improvement term itself
 * already scales with how much room the matchup has.
 */
export function urgency(p0: number): number {
  return 1.5 - p0;
}

/**
 * Weight of backup-coverage improvements relative to best-answer improvements
 * in the partner score. Mirrors the weakest-matchups ranking, which values a
 * thin *backup* answer (its secondary key) below a thin *best* answer (primary).
 * A partner that only deepens redundancy against a threat the core already
 * answers should score below one that fixes a matchup outright, so backup gains
 * are discounted by half. (DECISIONS.md D29.)
 */
export const BACKUP_WEIGHT = 0.5;

/**
 * Per-opponent win rates of each core member, plus the core's best answer.
 * Shared foundation of suggestPartners and weakestMatchups so both rank
 * with the same weighting. (Mirrored client-side in src/lib/matchupDb.ts.)
 */
export function computeTeamBest(
  core: VariantId[],
  condition: ConditionId,
): Map<VariantId, { best: number; per_member: Array<{ member: VariantId; p: number }> }> {
  const all = variantIds();
  const coreSet = new Set(core);
  const coreRows = core.map((c) => ({ member: c, rows: matchupsFor(c, condition) }));
  const out = new Map<VariantId, { best: number; per_member: Array<{ member: VariantId; p: number }> }>();
  for (const V of all) {
    if (coreSet.has(V)) continue;
    const per_member: Array<{ member: VariantId; p: number }> = [];
    let best = -1;
    for (const { member, rows } of coreRows) {
      const r = rows.get(V);
      if (!r) continue;
      per_member.push({ member, p: r.p_A_wins });
      if (r.p_A_wins > best) best = r.p_A_wins;
    }
    if (best >= 0) out.set(V, { best, per_member });
  }
  return out;
}

export interface WeakMatchup {
  opponent: VariantId;
  /** Highest win rate any core member has against V. */
  team_best: number;
  /** Second-highest win rate among core members against V (0 if <2 members). */
  team_second_best: number;
  per_member: Array<{ member: VariantId; p: number }>;
  best_member: VariantId;
  weight: number;
  /** weight × (1 − team_best) — field-weighted weakness of the best answer. */
  primary_key: number;
  /** weight × (1 − team_second_best) — field-weighted weakness of the backup answer. */
  secondary_key: number;
}

/**
 * The core's worst matchups, ranked lexicographically (both keys descending,
 * worst first) to surface gaps in *redundant* coverage:
 *   primary   = weight(V) × (1 − team_best(core, V))
 *   secondary = weight(V) × (1 − team_second_best(core, V))
 * The primary key ranks common opponents the core's best answer loses to.
 * When the field is broadly covered and primary keys sit close, the secondary
 * key exposes the opponents whose *backup* answer is thin (no redundant
 * answer). Using the (1 − p) complement (not p) keeps low-usage opponents the
 * core already beats from flooding the top of the list. Diverges from
 * suggestPartners, which keeps its coverage-improvement score (DECISIONS.md).
 */
export function weakestMatchups(
  core: VariantId[],
  condition: ConditionId,
  metagame_weights: Map<VariantId, number>,
): WeakMatchup[] {
  if (core.length === 0) throw new Error('core must contain at least one variant');
  const out: WeakMatchup[] = [];
  for (const [V, { best, per_member }] of computeTeamBest(core, condition)) {
    const byRate = [...per_member].sort((a, b) => b.p - a.p);
    const second = byRate[1]?.p ?? 0;
    const w = metagame_weights.get(V) ?? 0;
    out.push({
      opponent: V,
      team_best: best,
      team_second_best: second,
      per_member,
      best_member: byRate[0].member,
      weight: w,
      primary_key: w * (1 - best),
      secondary_key: w * (1 - second),
    });
  }
  out.sort((a, b) => b.primary_key - a.primary_key || b.secondary_key - a.secondary_key);
  return out;
}

/**
 * Rank candidate partners by how much they improve the core's coverage,
 * matching the weakest-matchups ranking (D29): a partner is scored on how much
 * it lifts *both* the core's best answer and its backup (second-best) answer
 * against each opponent, usage-weighted and urgency-weighted. Adding a strong
 * candidate demotes the old best answer to backup, so it also deepens
 * redundancy — that gain is credited via the secondary term (discounted by
 * BACKUP_WEIGHT). Diverges from weakestMatchups only in framing (a candidate's
 * marginal improvement vs. an opponent's residual weakness), not in what it
 * values. The displayed "biggest fixes" stay best-answer upgrades for
 * legibility; the backup term influences the score, not which fixes are shown.
 */
export function suggestPartners(
  core: VariantId[],
  condition: ConditionId,
  metagame_weights: Map<VariantId, number>,
): PartnerSuggestion[] {
  if (core.length === 0) throw new Error('core must contain at least one variant');
  const all = variantIds();
  const coreSet = new Set(core);

  // The core's current best and backup answer to each opponent (mirrors weakestMatchups).
  const teamCover = new Map<VariantId, { best: number; second: number }>();
  for (const [V, { per_member }] of computeTeamBest(core, condition)) {
    const byRate = [...per_member].sort((a, b) => b.p - a.p);
    teamCover.set(V, { best: byRate[0].p, second: byRate[1]?.p ?? 0 });
  }

  const suggestions: PartnerSuggestion[] = [];
  for (const candidate of all) {
    if (coreSet.has(candidate)) continue;
    const candRows = matchupsFor(candidate, condition);
    let score = 0;
    const improvements: Array<{ opponent: VariantId; before: number; after: number; gain: number }> = [];
    for (const [V, { best, second }] of teamCover) {
      if (V === candidate) continue;
      const r = candRows.get(V);
      if (!r) continue;
      const p = r.p_A_wins;
      // With the candidate added, recompute the core's top-two answers to V.
      const bestAfter = Math.max(best, p);
      const secondAfter = p >= best ? best : Math.max(second, p);
      const bestGain = bestAfter - best;
      const secondGain = secondAfter - second;
      if (bestGain <= 0 && secondGain <= 0) continue;
      const w = metagame_weights.get(V) ?? 0;
      const gain = w * (bestGain * urgency(best) + BACKUP_WEIGHT * secondGain * urgency(second));
      score += gain;
      if (bestGain > 0) improvements.push({ opponent: V, before: best, after: bestAfter, gain });
    }
    improvements.sort((a, b) => b.gain - a.gain);
    const top = improvements.slice(0, 5).map(({ opponent, before, after }) => ({ opponent, before, after }));
    suggestions.push({
      variant: candidate,
      coverage_score: score,
      top_improvements: top,
      details: top
        .map((i) => `${i.opponent}: ${(i.before * 100).toFixed(0)}%→${(i.after * 100).toFixed(0)}%`)
        .join(', '),
    });
  }

  suggestions.sort((a, b) => b.coverage_score - a.coverage_score);
  return suggestions;
}

/** Convenience: metagame weights from defender-variants.json content. */
export function weightsFromVariants(variants: Array<{ id: string; weight: number }>): Map<VariantId, number> {
  return new Map(variants.map((v) => [v.id, v.weight]));
}

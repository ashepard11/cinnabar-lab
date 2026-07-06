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
  team_best: number;
  per_member: Array<{ member: VariantId; p: number }>;
  best_member: VariantId;
  weight: number;
  weakness_score: number;
}

/**
 * The core's worst matchups, ranked by the same weighting suggestPartners
 * uses to value fixing them: usage weight × how badly the core loses ×
 * urgency (losing matchups over close ones).
 */
export function weakestMatchups(
  core: VariantId[],
  condition: ConditionId,
  metagame_weights: Map<VariantId, number>,
): WeakMatchup[] {
  if (core.length === 0) throw new Error('core must contain at least one variant');
  const out: WeakMatchup[] = [];
  for (const [V, { best, per_member }] of computeTeamBest(core, condition)) {
    const bestEntry = per_member.reduce((a, b) => (b.p > a.p ? b : a), per_member[0]);
    const w = metagame_weights.get(V) ?? 0;
    out.push({
      opponent: V,
      team_best: best,
      per_member,
      best_member: bestEntry.member,
      weight: w,
      weakness_score: w * (1 - best) * urgency(best),
    });
  }
  out.sort((a, b) => b.weakness_score - a.weakness_score);
  return out;
}

export function suggestPartners(
  core: VariantId[],
  condition: ConditionId,
  metagame_weights: Map<VariantId, number>,
): PartnerSuggestion[] {
  if (core.length === 0) throw new Error('core must contain at least one variant');
  const all = variantIds();
  const coreSet = new Set(core);

  const teamBest = new Map<VariantId, number>();
  for (const [V, { best }] of computeTeamBest(core, condition)) teamBest.set(V, best);

  const suggestions: PartnerSuggestion[] = [];
  for (const candidate of all) {
    if (coreSet.has(candidate)) continue;
    const candRows = matchupsFor(candidate, condition);
    let score = 0;
    const improvements: Array<{ opponent: VariantId; before: number; after: number }> = [];
    for (const [V, before] of teamBest) {
      if (V === candidate) continue;
      const r = candRows.get(V);
      if (!r) continue;
      const after = Math.max(before, r.p_A_wins);
      const improvement = after - before;
      if (improvement <= 0) continue;
      const w = metagame_weights.get(V) ?? 0;
      score += w * improvement * urgency(before);
      improvements.push({ opponent: V, before, after });
    }
    improvements.sort((a, b) => (b.after - b.before) - (a.after - a.before));
    const top = improvements.slice(0, 5);
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

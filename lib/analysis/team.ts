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

export function suggestPartners(
  core: VariantId[],
  condition: ConditionId,
  metagame_weights: Map<VariantId, number>,
): PartnerSuggestion[] {
  if (core.length === 0) throw new Error('core must contain at least one variant');
  const all = variantIds();
  const coreSet = new Set(core);

  // team_best(core, V) for every opponent V
  const coreRows = core.map((c) => matchupsFor(c, condition));
  const teamBest = new Map<VariantId, number>();
  for (const V of all) {
    if (coreSet.has(V)) continue;
    let best = -1;
    for (const rows of coreRows) {
      const r = rows.get(V);
      if (r && r.p_A_wins > best) best = r.p_A_wins;
    }
    if (best >= 0) teamBest.set(V, best);
  }

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

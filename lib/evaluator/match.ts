/**
 * lib/evaluator/match.ts — map a pasted set to its nearest known variant
 * (SPEC-team-evaluator.md Phase 7). Best-effort until BACKLOG item 05 brings
 * exact-set simulation; the upgrade path is a future
 * `resolveOrSimulate(set): Promise<MatchupSource>` with the same shape.
 *
 * Matching rules: species (mega-forme aware) → exact item → the species'
 * aggregate/no-item variant (defensive items land here until item 04) →
 * unmatched. Exactness compares the parsed set against the variant's
 * *resolved battle set* (same field set canonicalSpec hashes: ability,
 * nature, SP spread, and the pickMoves top-4 moveset) so the "approximated
 * as …" badge is driven by battle-identity, not display identity.
 */
import {pickMoves} from '../sim/sets';
import {toID} from './dex';
import type {ParsedSet} from './parse';
import type {StatID, Variant} from '../types';

export interface VariantMatch {
  set: ParsedSet;
  /** null = no variant for this species at all (needs item 05). */
  variantId: string | null;
  /** True when the variant's resolved battle set equals the pasted set. */
  exact: boolean;
  /** Human-readable differences driving the "approximated as …" badge. */
  differences: string[];
}

const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function diffSet(set: ParsedSet, variant: Variant): string[] {
  const diffs: string[] = [];
  if (toID(variant.item ?? '') !== toID(set.item ?? '')) {
    diffs.push(`item: ${set.item ?? 'none'} → ${variant.item ?? 'none'}`);
  }
  if (toID(variant.ability) !== toID(set.ability)) {
    diffs.push(`ability: ${set.ability} → ${variant.ability}`);
  }
  if (toID(variant.nature) !== toID(set.nature)) {
    diffs.push(`nature: ${set.nature} → ${variant.nature}`);
  }
  if (STAT_IDS.some((s) => (variant.sps[s] ?? 0) !== set.sps[s])) {
    diffs.push('SP spread differs');
  }
  const variantMoves = [...pickMoves(variant)].map(toID).sort();
  const setMoves = [...set.moves].map(toID).sort();
  if (variantMoves.length !== setMoves.length || variantMoves.some((m, i) => m !== setMoves[i])) {
    diffs.push(`moves: simulated as ${pickMoves(variant).join(' / ')}`);
  }
  return diffs;
}

/** Match one parsed set against the variant list. */
export function matchVariant(set: ParsedSet, variants: Variant[]): VariantMatch {
  // Megas are keyed by mega species in the variant file; battleSpecies covers both.
  const speciesId = toID(set.battleSpecies);
  const candidates = variants.filter((v) => toID(v.species) === speciesId);
  if (candidates.length === 0) {
    return {set, variantId: null, exact: false, differences: []};
  }
  const exactItem = candidates.find((v) => toID(v.item ?? '') === toID(set.item ?? ''));
  const aggregate = candidates.find((v) => v.item === null);
  const chosen = exactItem ?? aggregate ?? candidates[0];
  const differences = diffSet(set, chosen);
  return {set, variantId: chosen.id, exact: differences.length === 0, differences};
}

export function matchTeam(sets: ParsedSet[], variants: Variant[]): VariantMatch[] {
  return sets.map((set) => matchVariant(set, variants));
}

/**
 * lib/variant-schema.ts — schema v3 for data/defender-variants.json
 * (BACKLOG item 09, SPEC-teambuilder.md Phase 0).
 *
 * v3 adds the fields the teambuilder needs and nothing else:
 *   - top level `regulation`, so a variant file states which format it
 *     describes instead of leaving callers to assume;
 *   - `national_dex`, because the species clause keys on it and deriving it
 *     from a name string at search time is error-prone for alternate formes;
 *   - `set_label` and `moves_source`, placeholders that become load-bearing
 *     when Phase 2 emits multiple sets per item bucket and the Movesets screen
 *     starts writing overrides;
 *   - `tier`, the core/extended split from Phase 2.
 *
 * A note on the version number. SPEC-teambuilder.md calls its schema "version
 * 2", but `schema_version: 2` already shipped with a different shape (BACKLOG
 * item 02's content ids), so this is 3. The spec's shape is not adopted
 * wholesale either: it makes `id` a sha256 and moves the slug to `human_id`,
 * whereas this repo already has a content id in `cid` and uses the slug `id`
 * in matchup rows and URLs. Renaming both would churn every reader and every
 * permalink to express something the file already expresses. See DECISIONS.md.
 *
 * Browser-safe: no Node imports.
 */
import {validateSpSpread, describeSpErrors, type RegulationConfig} from './format-rules';
import type {Variant, VariantsData, VariantTier} from './types';

export const VARIANT_SCHEMA_VERSION = 3;

/**
 * Tournament length the core-tier threshold is calibrated against: a full
 * regional is nine Swiss rounds on day one, six on day two, then top cut.
 */
export const TOURNAMENT_ROUNDS = 17;

/**
 * Minimum usage weight for the core tier.
 *
 * **This gates nothing.** `scripts/build-matchups.ts` simulates every pair
 * regardless of tier, and candidate ranking does not filter on it either. The
 * tier is a triage label: it sets the default filter on the Movesets screen
 * ("which sets are worth reviewing"), a count on the data status screen, and a
 * badge on the variant page. SPEC-teambuilder.md Phase 5 describes it as a
 * compute gate — simulate core-against-core and core-against-extended, skip
 * extended-against-extended — but that build does not exist yet, so treat the
 * spec's description as intent rather than as what the code does.
 *
 * The number is derived rather than chosen. `weight` is the chance a given
 * opposing team carries the variant, so across `TOURNAMENT_ROUNDS` opponents
 * the chance of meeting it at least once is `1 - (1 - weight) ** rounds`. The
 * core tier is the set you are more likely than not to actually face, which
 * puts the threshold where that expression crosses one half:
 *
 *   weight >= 1 - 0.5 ** (1 / 17) = 0.03995
 *
 * This replaces a flat "top seventy or so" count (DECISIONS.md D41), which was
 * provisional and never justified. A threshold states a property of the
 * metagame, tracks it as usage moves rather than holding a fixed count while
 * the distribution changes shape, and needs no tie-break: equal weights land
 * in the same tier by construction, so a rescrape cannot flip one across a
 * rank cutoff.
 *
 * Two approximations, both mild and both in the same direction. Opposing teams
 * are not independent draws — archetypes travel together (BACKLOG item 15) —
 * and Swiss pairs on record, which over-represents popular picks late. Both
 * put the true crossing slightly below 4%, so this is a little conservative.
 *
 * **When to revisit.** Promoting this to a real compute gate is only worth it
 * when the variant universe is big enough for the saving to matter. At 84
 * variants, skipping extended-against-extended saves 990 pairs of 3,486 — 28%
 * of one overnight build, which does not justify a permanent gate or the
 * "why is this Pokémon missing" failure mode it creates. BACKLOG item 04
 * (defensive item variants) is the trigger: pairs are quadratic, so 84 -> 200
 * variants is 19,900 pairs, and a gate starts paying for itself.
 */
export const CORE_TIER_MIN_WEIGHT = coreTierMinWeight(TOURNAMENT_ROUNDS);

/** The usage weight at which `p` chance of at least one encounter is reached. */
export function coreTierMinWeight(rounds = TOURNAMENT_ROUNDS, p = 0.5): number {
  return 1 - Math.pow(1 - p, 1 / rounds);
}

export function assignTiers(
  variants: Variant[],
  minWeight = CORE_TIER_MIN_WEIGHT
): Variant[] {
  return variants.map((v) => ({
    ...v,
    tier: (v.weight >= minWeight ? 'core' : 'extended') as VariantTier,
  }));
}

/**
 * The label distinguishing sets within a species. Today that is just the item
 * bucket, since one set is produced per bucket; Phase 2's multi-set generation
 * is what makes this do real work.
 */
export function defaultSetLabel(variant: Variant): string {
  if (variant.is_mega) return 'Mega';
  return variant.item ?? 'No item';
}

export interface VariantValidationError {
  variant_id: string;
  message: string;
}

/**
 * Validate a loaded variant file against the regulation.
 *
 * Rejects rather than repairs. A spread breaking the SP budget or a species
 * outside the legal pool means the scrape or the build is wrong, and a file
 * that loads with quietly-corrected values produces plausible numbers that
 * cannot be traced back to the fault.
 *
 * `legalSpecies` is optional so callers that only have the declarative config
 * — the set editor validating a draft before any resolved JSON is fetched —
 * can still run the budget and shape checks.
 */
export function validateVariantsData(
  data: VariantsData,
  rules: RegulationConfig,
  legalSpecies?: Set<string>
): VariantValidationError[] {
  const errors: VariantValidationError[] = [];
  const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (data.schema_version === VARIANT_SCHEMA_VERSION && data.regulation !== rules.regulation_id) {
    errors.push({
      variant_id: '(file)',
      message: `file is for regulation ${data.regulation ?? '(unset)'} but rules are ${rules.regulation_id}`,
    });
  }

  for (const v of data.variants) {
    const spErrors = validateSpSpread(v.sps, rules);
    if (spErrors.length > 0) {
      errors.push({variant_id: v.id, message: `illegal SP spread: ${describeSpErrors(spErrors)}`});
    }
    // Champions has no EVs, no IVs, and every Pokémon is Level 50, so these
    // fields should never have survived into a variant record.
    for (const field of ['evs', 'ivs'] as const) {
      if (field in v) errors.push({variant_id: v.id, message: `carries a ${field} field`});
    }
    const level = (v as {level?: number}).level;
    if (level !== undefined && level !== rules.level) {
      errors.push({variant_id: v.id, message: `level ${level} is not ${rules.level}`});
    }
    if (data.schema_version === VARIANT_SCHEMA_VERSION) {
      if (v.national_dex === undefined) {
        errors.push({variant_id: v.id, message: 'missing national_dex'});
      }
      if (v.tier === undefined) {
        errors.push({variant_id: v.id, message: 'missing tier'});
      }
    }
    if (legalSpecies && !legalSpecies.has(toId(v.species))) {
      errors.push({
        variant_id: v.id,
        message: `${v.species} is not legal in ${rules.regulation_id}`,
      });
    }
  }
  return errors;
}

/** Throw if a variant file fails validation. */
export function assertVariantsData(
  data: VariantsData,
  rules: RegulationConfig,
  legalSpecies?: Set<string>
): void {
  const errors = validateVariantsData(data, rules, legalSpecies);
  if (errors.length > 0) {
    const detail = errors.map((e) => `  ${e.variant_id}: ${e.message}`).join('\n');
    throw new Error(`defender-variants.json failed validation:\n${detail}`);
  }
}

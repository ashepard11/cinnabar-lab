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
 * Core-tier size. The spec says "the top seventy or so variants by weight,
 * subject to what Phase 1 learns about how many candidates a user scans", so
 * this is a starting point rather than a settled number — revisit once the
 * interface exists. Everything below it down to the 1% species threshold is
 * extended tier: simulated as opponents, eligible as team members only during
 * local-search refinement.
 */
export const CORE_TIER_SIZE = 70;

/**
 * Assign tiers by descending weight. Returns a new array; does not mutate.
 * Ties are broken by id so the assignment is deterministic across rebuilds —
 * two variants on the same weight must not swap tiers just because the scrape
 * reordered them.
 */
export function assignTiers(variants: Variant[], coreSize = CORE_TIER_SIZE): Variant[] {
  const ranked = [...variants].sort(
    (a, b) => b.weight - a.weight || a.id.localeCompare(b.id)
  );
  const tierOf = new Map<string, VariantTier>();
  ranked.forEach((v, i) => tierOf.set(v.id, i < coreSize ? 'core' : 'extended'));
  return variants.map((v) => ({...v, tier: tierOf.get(v.id)!}));
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

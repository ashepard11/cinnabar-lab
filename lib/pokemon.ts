/**
 * Canonical Pokémon construction from our specs into @smogon/calc objects.
 *
 * Factored out of calc.ts so the follow-on sim project can reuse the same
 * construction logic (see SPEC-damageviz.md "Building for reuse").
 *
 * Champions notes (verified in Phase 0 against @smogon/calc master @ ebe3a81):
 * - Champions is generation 0 in @smogon/calc. `Generations.get(0)`.
 * - The calc's `evs` field is interpreted as Champions SP (0–32 per stat),
 *   not EVs. Stat formula is level-independent:
 *     HP   = base + SP + 75
 *     stat = floor(nature × (base + SP + 20))
 * - EV → SP conversion (matches the official damage-calc UI): SP = ceil(EV/8),
 *   with the special case EV 4 → SP 1.
 * - Weather is NOT auto-applied from abilities like Drought; set it on the
 *   Field explicitly (lib/calc.ts does this for the pipeline).
 */
import {Generations, Pokemon, Move, toID} from '@smogon/calc';
import type {MoveSpec, PokemonSpec, StatID, StatsTable} from './types';

/** The Champions generation object (gen 0 in @smogon/calc master). */
export const GEN = Generations.get(0);

const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

// EV → SP conversion lives in lib/sp.ts (browser-safe, no calc import) so
// lib/evaluator/* can use it without bundling the calc; re-exported here so
// existing imports keep working.
export {evToSp, evsToSps} from './sp';

/** Build an @smogon/calc Pokemon from our spec. Throws if the species is unknown. */
export function buildPokemon(spec: PokemonSpec): Pokemon {
  return new Pokemon(GEN, spec.species, {
    level: 50, // cosmetic in Champions: the stat formula is level-independent
    nature: spec.nature,
    evs: spec.sps,
    ability: spec.ability,
    item: spec.item ?? undefined,
    boosts: spec.boosts,
    // Our overrides shape (partial baseStats, type tuple) is structurally
    // compatible with the calc's Partial<I.Specie>, which isn't re-exported.
    overrides: spec.overrides as any,
  });
}

/** Build an @smogon/calc Move from our spec. */
export function buildMove(spec: MoveSpec): Move {
  return new Move(GEN, spec.name, {
    overrides: spec.overrides,
    hits: spec.hits,
  });
}

/** True if `name` resolves to a known species in the Champions dex. */
export function speciesExists(name: string): boolean {
  return !!GEN.species.get(toID(name));
}

/** True if `name` resolves to a known move in the Champions dex. */
export function moveExists(name: string): boolean {
  return !!GEN.moves.get(toID(name));
}

/** True if `name` resolves to a known item in the Champions dex. */
export function itemExists(name: string): boolean {
  return !!GEN.items.get(toID(name));
}

/** True if `name` resolves to a known ability in the Champions dex. */
export function abilityExists(name: string): boolean {
  return !!GEN.abilities.get(toID(name));
}

/** Showdown-style ID normalization ("Heat Wave" → "heatwave"). */
export {toID} from '@smogon/calc';

/**
 * Manual Pikalytics → calc-dex species mapping for names that don't resolve
 * directly (spec: "log all Pokémon ... that don't match the calc lib's known
 * names — these need a manual mapping table").
 *
 * Aegislash: the calc splits it into -Blade / -Shield / -Both; "-Both" is the
 * damage-calc convention (Blade offenses + Shield defenses) matching how it
 * actually attacks and defends under Stance Change.
 */
export const SPECIES_MAPPING: Record<string, string> = {
  Aegislash: 'Aegislash-Both',
};

/** Resolve a scraped species name to its calc-dex canonical name. */
export function canonicalSpecies(name: string): string {
  return SPECIES_MAPPING[name] ?? name;
}

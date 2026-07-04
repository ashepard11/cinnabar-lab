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

/** Convert one EV value to SP, mirroring the official damage-calc UI. */
export function evToSp(ev: number): number {
  if (ev === 4) return 1;
  return Math.min(32, Math.ceil(ev / 8));
}

/** Convert an EV spread (0–252 per stat) to an SP spread (0–32 per stat). */
export function evsToSps(evs: Partial<StatsTable>): Partial<StatsTable> {
  const sps: Partial<StatsTable> = {};
  for (const stat of STAT_IDS) {
    const ev = evs[stat];
    if (ev !== undefined) sps[stat] = evToSp(ev);
  }
  return sps;
}

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

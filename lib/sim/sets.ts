/**
 * lib/sim/sets.ts — convert defender variants (data/defender-variants.json)
 * into Showdown battle sets for the 1v1 simulator.
 *
 * Moveset = the variant's top 4 moves by usage, after removing moves excluded
 * by the v1 scope (SPEC-sim.md "Version scope"): moves that set new field
 * state (weather, terrain, Tailwind, Trick Room, screens) are not playable
 * actions in v1, and redirection/ally-targeted moves do nothing in a 1v1.
 */
import type { Variant } from '../types';
import type { SimSet } from './engine';

/**
 * Moves excluded from v1 movesets.
 *
 * - field-state setters: v1 scope says "neither Pokémon will set new field
 *   state during the simulated turns" — field state comes only from the
 *   starting condition.
 * - ally-targeted / redirection / teammate-dependent moves: no-ops or near
 *   no-ops with an empty ally slot; a real player in a 1v1 endgame would
 *   never click them, but a search policy might misjudge their value.
 */
export const EXCLUDED_MOVES = new Set(
  [
    // weather / terrain setters
    'Sunny Day', 'Rain Dance', 'Sandstorm', 'Snowscape', 'Hail', 'Chilly Reception',
    'Electric Terrain', 'Grassy Terrain', 'Misty Terrain', 'Psychic Terrain',
    // room / side conditions
    'Trick Room', 'Tailwind', 'Reflect', 'Light Screen', 'Aurora Veil', 'Safeguard',
    'Wide Guard', 'Quick Guard', 'Mist', 'Lucky Chant',
    // hazards (worthless with no bench)
    'Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web',
    // redirection / ally-targeted
    // (Pollen Puff stays eligible: vs an enemy it is a plain 90 BP attack)
    'Follow Me', 'Rage Powder', 'Ally Switch', 'Helping Hand', 'Coaching',
    'Aromatic Mist', 'Decorate', 'Instruct', 'Heal Pulse', 'Life Dew',
    'Beat Up',
  ].map((m) => m.toLowerCase()),
);

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

function fullStats(partial: Partial<Record<string, number>>, fill: number) {
  const out = { hp: fill, atk: fill, def: fill, spa: fill, spd: fill, spe: fill };
  for (const k of STAT_KEYS) if (partial[k] !== undefined) out[k] = partial[k]!;
  return out;
}

/**
 * Pick the variant's battle moveset: top 4 usage moves not excluded by scope.
 * Falls back to fewer than 4 when the variant doesn't carry 4 eligible moves.
 */
export function pickMoves(variant: Variant): string[] {
  const eligible = variant.moves
    .filter((m) => !EXCLUDED_MOVES.has(m.name.toLowerCase()))
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 4)
    .map((m) => m.name);
  if (eligible.length === 0) {
    throw new Error(`variant ${variant.id} has no eligible moves`);
  }
  return eligible;
}

/**
 * Species-name mapping calc-dex → Showdown-dex. "Aegislash-Both" is a
 * damage-calc convention (D9); Showdown uses plain Aegislash and implements
 * real Stance Change (better than the calc's blend). The reverse mapping for
 * the planning model's calc lookups lives in lib/sim/model.ts.
 */
const SPECIES_TO_SHOWDOWN: Record<string, string> = {
  'Aegislash-Both': 'Aegislash',
};

/** Convert a defender variant to a Showdown set for the Champions sim. */
export function variantToSet(variant: Variant): SimSet {
  return {
    name: variant.id.slice(0, 18), // battle nickname = variant id (truncated)
    species: SPECIES_TO_SHOWDOWN[variant.species] ?? variant.species,
    item: variant.item ?? '',
    ability: variant.ability,
    moves: pickMoves(variant),
    nature: variant.nature,
    gender: '',
    // The champions mod reads set.evs as SP (0–32); see DECISIONS.md D2/D20.
    evs: fullStats(variant.sps, 0),
    ivs: fullStats({}, 31),
    level: 50,
  };
}

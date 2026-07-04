/**
 * Shared TypeScript types for the Pokémon Champions VGC analytics pipeline.
 *
 * Damage values everywhere in this codebase are decimals (0–1+) expressed as
 * a fraction of the defender's max HP. Format as percentages at display time only.
 */

export type StatID = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export type StatsTable = Record<StatID, number>;

export type TypeName =
  | 'Normal' | 'Fighting' | 'Flying' | 'Poison' | 'Ground' | 'Rock'
  | 'Bug' | 'Ghost' | 'Steel' | 'Fire' | 'Water' | 'Grass'
  | 'Electric' | 'Psychic' | 'Ice' | 'Dragon' | 'Dark' | 'Fairy';

export const ALL_TYPES: TypeName[] = [
  'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock',
  'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass',
  'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy',
];

export type MoveCategory = 'Physical' | 'Special';

export type Weather = 'Sun' | 'Rain' | 'Sand' | 'Snow' | 'Harsh Sunshine' | 'Heavy Rain';

/**
 * A Pokémon as fed into the damage calc.
 *
 * `sps` holds Champions SP (Stat Points, 0–32 per stat) — NOT EVs. The
 * Champions stat formula is level-independent:
 *   HP   = base + SP + 75
 *   stat = floor(nature × (base + SP + 20))
 * If you have EV-denominated data, convert with `evsToSps` in lib/pokemon.ts
 * (SP ≈ ceil(EV / 8), the same conversion the official damage-calc UI uses).
 */
export interface PokemonSpec {
  /** Canonical Showdown species name, e.g. "Charizard-Mega-Y". */
  species: string;
  ability?: string;
  item?: string | null;
  nature: string;
  sps: Partial<StatsTable>;
  /** Stat stages, -6..+6 (e.g. Intimidate → { atk: -1 } on the attacker). */
  boosts?: Partial<StatsTable>;
  /** Synthetic-Pokémon support: override base stats and/or typing. */
  overrides?: {
    baseStats?: Partial<StatsTable>;
    types?: [TypeName] | [TypeName, TypeName];
  };
}

/** A move as fed into the damage calc. */
export interface MoveSpec {
  /** Canonical move name, e.g. "Heat Wave". Use "Generic" + overrides for synthetic moves. */
  name: string;
  /** Synthetic-move support: override BP / type / category. */
  overrides?: {
    basePower?: number;
    type?: TypeName;
    category?: MoveCategory;
  };
  /** Number of hits for multi-hit moves (calc applies per-hit damage × hits). */
  hits?: number;
}

export interface FieldSpec {
  isDoubles: boolean;
  weather?: Weather | null;
}

/** Damage as a fraction of the defender's max HP. */
export interface CalcResult {
  min: number;
  max: number;
  avg: number;
}

// ---------------------------------------------------------------------------
// Scraped usage data (data/usage-tournaments.json)
// ---------------------------------------------------------------------------

export interface UsageEntry {
  name: string;
  usage: number; // 0–1
}

export interface ModalSet {
  ability: string;
  item: string;
  nature: string;
  /** EV-denominated spread as displayed by Pikalytics. Convert to SP for the calc. */
  evs: StatsTable;
}

export interface PokemonUsage {
  name: string;
  usage: number; // 0–1 overall usage
  moves: UsageEntry[];
  abilities: UsageEntry[];
  items: UsageEntry[];
  modal_set: ModalSet | null;
}

export interface UsageData {
  scraped_at: string;
  format: string;
  pokemon: PokemonUsage[];
}

// ---------------------------------------------------------------------------
// Variants (data/defender-variants.json)
// ---------------------------------------------------------------------------

export interface Variant {
  id: string;
  species: string;
  is_mega: boolean;
  mega_stone?: string;
  item: string | null;
  ability: string;
  nature: string;
  evs: StatsTable;
  /** metagame weight = usage(P) × within-Pokémon share of this item bucket */
  weight: number;
  /** move usage from the base Pokémon (moves + usage %), carried for viz 1 */
  moves: UsageEntry[];
}

export interface VariantsData {
  schema_version: 1;
  generated_at: string;
  variants: Variant[];
}

// ---------------------------------------------------------------------------
// Viz output data
// ---------------------------------------------------------------------------

export interface Viz1Contributor {
  variant_id: string;
  species: string;
  move: string;
  expected_damage: number;
}

export interface Viz1Cell {
  type: TypeName;
  category: MoveCategory;
  share: number;
  contributors: Viz1Contributor[];
}

export interface Viz1Data {
  generated_at: string;
  cells: Viz1Cell[];
}

export interface Viz2Contributor {
  variant_id: string;
  species: string;
  damage: number;
  weighted_contribution: number;
}

export interface Viz2Cell {
  type: TypeName;
  category: MoveCategory;
  weighted_damage: number;
  relative: number;
  contributors: Viz2Contributor[];
}

export interface Viz2Data {
  generated_at: string;
  average_damage: number;
  cells: Viz2Cell[];
}

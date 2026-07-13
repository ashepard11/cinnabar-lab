/**
 * lib/evaluator/dex.ts — types and helpers for data/evaluator-dex.json, the
 * trimmed Champions dex the team evaluator fetches at runtime.
 *
 * The JSON is produced by scripts/build-evaluator-dex.ts: metadata comes from
 * the vendored pokemon-showdown Champions mod, existence from the vendored
 * @smogon/calc gen-0 dex (SPEC-team-evaluator.md Phase 0). Everything in this
 * module must stay browser-safe: no Node imports, no pokemon-showdown, no
 * @smogon/calc (the JSON carries all the metadata the non-damage sections
 * need).
 */
import type {StatID, StatsTable, TypeName} from '../types';

/** Showdown-style normalized id: lowercase alphanumerics only. */
export function toID(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** One secondary effect of a damaging move (chance in percent, 0–100). */
export interface DexSecondary {
  chance: number;
  status?: string;
  volatileStatus?: string;
  /** Stat changes applied to the target (e.g. Icy Wind { spe: -1 }). */
  boosts?: Partial<StatsTable>;
  /** Stat changes applied to the user (e.g. Power-Up Punch { atk: +1 }). */
  selfBoosts?: Partial<StatsTable>;
}

export interface DexMove {
  name: string;
  type: TypeName;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  /** true = always hits (never misses). */
  accuracy: number | true;
  priority: number;
  critRatio: number;
  /** Showdown target string: 'self', 'normal', 'allAdjacentFoes', … */
  target: string;
  // Structured effect fields, present only when the move has them:
  selfSwitch?: boolean | string;
  forceSwitch?: boolean;
  sideCondition?: string;
  pseudoWeather?: string;
  weather?: string;
  terrain?: string;
  volatileStatus?: string;
  status?: string;
  /** Stat changes from status moves (target-relative; see `target`). */
  boosts?: Partial<StatsTable>;
  secondaries?: DexSecondary[];
  /** [numerator, denominator] of damage healed (drain attacks). */
  drain?: [number, number];
  /** [numerator, denominator] of max HP healed (recovery moves). */
  heal?: [number, number];
  /** flags.heal — set on recovery moves whose heal amount isn't in `heal`. */
  healFlag?: boolean;
  ohko?: boolean;
  hasCrashDamage?: boolean;
  /** flags carried for tag rules; omitted when absent. */
  windFlag?: boolean;
  chargeFlag?: boolean;
  rechargeFlag?: boolean;
  multihit?: number | [number, number];
}

export interface DexSpecies {
  name: string;
  types: TypeName[];
  baseStats: StatsTable;
  /** Legal ability names (deduped slot list from the Showdown mod). */
  abilities: string[];
  isMega: boolean;
}

export interface DexNature {
  name: string;
  plus?: StatID;
  minus?: StatID;
}

export interface EvaluatorDex {
  generated_at: string;
  /** Attacking-type enumeration actually present in the Champions dex. */
  types: TypeName[];
  /** All keyed by toID(name). */
  species: Record<string, DexSpecies>;
  moves: Record<string, DexMove>;
  /** id → display name. Semantics live in curated tables, not here. */
  abilities: Record<string, string>;
  items: Record<string, string>;
  natures: Record<string, DexNature>;
  /** Mega Stone id → (base species id → mega forme name), Champions-legal only. */
  megaStones: Record<string, Record<string, string>>;
}

/** Mega forme name when `item` mega-evolves `species`, else null. */
export function megaFormeFor(dex: EvaluatorDex, item: string | null, species: string): string | null {
  if (!item) return null;
  return dex.megaStones[toID(item)]?.[toID(species)] ?? null;
}

export function getSpecies(dex: EvaluatorDex, name: string): DexSpecies | undefined {
  return dex.species[toID(name)];
}

export function getMove(dex: EvaluatorDex, name: string): DexMove | undefined {
  return dex.moves[toID(name)];
}

export function hasAbility(dex: EvaluatorDex, name: string): boolean {
  return toID(name) in dex.abilities;
}

export function hasItem(dex: EvaluatorDex, name: string): boolean {
  return toID(name) in dex.items;
}

/** All secondaries of a move, [] when none. */
export function secondariesOf(move: DexMove): DexSecondary[] {
  return move.secondaries ?? [];
}

/** True when the move deals direct damage (Physical/Special with BP > 0). */
export function isDamaging(move: DexMove): boolean {
  return move.category !== 'Status' && move.basePower > 0;
}

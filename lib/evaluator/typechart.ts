/**
 * lib/evaluator/typechart.ts — defensive and offensive type matrices for the
 * team evaluator (SPEC-team-evaluator.md Phase 2).
 *
 * The displayed multiplier is the *effective* one: raw chart composed with the
 * set's actual ability (pinned table below). Raw values ride along so the UI
 * toggle is free and modified cells can show "raw × ability → effective".
 */
import {getSpecies, isDamaging, getMove, toID} from './dex';
import type {DexMove, EvaluatorDex} from './dex';
import type {ParsedSet} from './parse';
import type {TypeName} from '../types';

/**
 * Pinned type-interaction ability table (spec Phase 2; changes require a
 * DECISIONS.md entry). Entries whose ability is not in the Champions dex are
 * dropped at load with a warning — the expected drops are asserted in tests.
 *
 * Not expressible here and deliberately out of v1 scope: Wonder Guard (not a
 * per-type multiplier; also a dex gap), Wind Rider (keyed on the move `wind`
 * flag, not a type — a type-indexed matrix has no cell for it; deferred).
 */
export interface TypeAbilityMod {
  ability: string;
  type: TypeName;
  mult: number;
  note?: string;
}

export const TYPE_ABILITY_MODS: TypeAbilityMod[] = [
  {ability: 'Levitate', type: 'Ground', mult: 0},
  {ability: 'Flash Fire', type: 'Fire', mult: 0},
  {ability: 'Water Absorb', type: 'Water', mult: 0},
  {ability: 'Dry Skin', type: 'Water', mult: 0},
  {ability: 'Storm Drain', type: 'Water', mult: 0},
  {ability: 'Volt Absorb', type: 'Electric', mult: 0},
  {ability: 'Lightning Rod', type: 'Electric', mult: 0},
  {ability: 'Motor Drive', type: 'Electric', mult: 0},
  {ability: 'Sap Sipper', type: 'Grass', mult: 0},
  {ability: 'Earth Eater', type: 'Ground', mult: 0},
  {ability: 'Well-Baked Body', type: 'Fire', mult: 0},
  {ability: 'Thick Fat', type: 'Fire', mult: 0.5},
  {ability: 'Thick Fat', type: 'Ice', mult: 0.5},
  {ability: 'Heatproof', type: 'Fire', mult: 0.5},
  {ability: 'Water Bubble', type: 'Fire', mult: 0.5},
  {ability: 'Purifying Salt', type: 'Ghost', mult: 0.5},
  {ability: 'Fluffy', type: 'Fire', mult: 2, note: 'contact halving is not type-based'},
  {ability: 'Dry Skin', type: 'Fire', mult: 1.25},
];

/** Curated offensive ability effects: Scrappy only in v1 (spec decision). */
export const SCRAPPY = 'Scrappy';

/** Table entries whose ability the given dex actually carries. */
export function activeTypeAbilityMods(dex: EvaluatorDex): TypeAbilityMod[] {
  return TYPE_ABILITY_MODS.filter((m) => toID(m.ability) in dex.abilities);
}

/** Table entries dropped because the Champions dex lacks the ability. */
export function droppedTypeAbilityMods(dex: EvaluatorDex): string[] {
  return [...new Set(
    TYPE_ABILITY_MODS.filter((m) => !(toID(m.ability) in dex.abilities)).map((m) => m.ability),
  )];
}

export interface DefensiveCell {
  raw: number;
  effective: number;
  /** True when an ability changed the raw multiplier. */
  modified: boolean;
  note?: string;
}

export interface DefensiveMatrix {
  /** Attacking types, in dex enumeration order (rows). */
  types: TypeName[];
  /** cells[typeIndex][memberIndex] */
  cells: DefensiveCell[][];
  /** Per-row tally over effective values. */
  summary: Array<{weak: number; neutral: number; resist: number; immune: number}>;
  /** Members whose typing came from a type-changing forme note (v1: none). */
  warnings: string[];
}

function rawMultiplier(dex: EvaluatorDex, atk: TypeName, defTypes: TypeName[]): number {
  let mult = 1;
  for (const def of defTypes) mult *= dex.typeChart[atk]?.[def] ?? 1;
  return mult;
}

/** Effective multiplier of a single-typed attack into a set, ability-aware. */
export function defensiveCell(dex: EvaluatorDex, set: ParsedSet, atk: TypeName): DefensiveCell {
  const spec = getSpecies(dex, set.battleSpecies) ?? getSpecies(dex, set.species);
  const defTypes = (spec?.types ?? []) as TypeName[];
  const raw = rawMultiplier(dex, atk, defTypes);
  let effective = raw;
  let note: string | undefined;
  for (const mod of activeTypeAbilityMods(dex)) {
    if (mod.type !== atk || toID(mod.ability) !== toID(set.ability)) continue;
    effective = mod.mult === 0 ? 0 : effective * mod.mult;
    note = `${mod.ability}: ${mod.mult === 0 ? 'immune' : `×${mod.mult}`}${mod.note ? ` (${mod.note})` : ''}`;
  }
  return {raw, effective, modified: effective !== raw, note};
}

export function defensiveMatrix(dex: EvaluatorDex, sets: ParsedSet[]): DefensiveMatrix {
  const types = dex.types;
  const cells = types.map((atk) => sets.map((set) => defensiveCell(dex, set, atk)));
  const summary = cells.map((row) => ({
    weak: row.filter((c) => c.effective >= 2).length,
    neutral: row.filter((c) => c.effective > 0.5 && c.effective < 2).length,
    resist: row.filter((c) => c.effective > 0 && c.effective <= 0.5).length,
    immune: row.filter((c) => c.effective === 0).length,
  }));
  return {types, cells, summary, warnings: []};
}

export interface OffensiveCell {
  /** Best effectiveness among the set's damaging moves; null when no moves. */
  best: number | null;
  bestMove: string | null;
  /** True when Scrappy turned a Ghost immunity into a hit. */
  scrappy?: boolean;
}

export interface OffensiveMatrix {
  /** Defending types (rows). */
  types: TypeName[];
  /** cells[typeIndex][memberIndex] */
  cells: OffensiveCell[][];
}

/** The set's damaging moves as dex entries. */
export function damagingMoves(dex: EvaluatorDex, set: ParsedSet): DexMove[] {
  return set.moves
    .map((m) => getMove(dex, m))
    .filter((m): m is DexMove => !!m && isDamaging(m));
}

export function offensiveMatrix(dex: EvaluatorDex, sets: ParsedSet[]): OffensiveMatrix {
  const types = dex.types;
  const scrappyTypes = new Set<TypeName>(['Normal', 'Fighting']);
  const cells = types.map((def) => sets.map((set): OffensiveCell => {
    const moves = damagingMoves(dex, set);
    if (moves.length === 0) return {best: null, bestMove: null};
    let best = -1;
    let bestMove: string | null = null;
    let scrappy = false;
    for (const move of moves) {
      let eff = dex.typeChart[move.type]?.[def] ?? 1;
      let viaScrappy = false;
      if (eff === 0 && def === 'Ghost' && scrappyTypes.has(move.type) && toID(set.ability) === toID(SCRAPPY)) {
        eff = 1;
        viaScrappy = true;
      }
      if (eff > best) {
        best = eff;
        bestMove = move.name;
        scrappy = viaScrappy;
      }
    }
    return {best, bestMove, scrappy: scrappy || undefined};
  }));
  return {types, cells};
}

/** Display bucket for a multiplier: nearest of 0 / 0.25 / 0.5 / 1 / 2 / 4. */
export const BUCKETS = [0, 0.25, 0.5, 1, 2, 4] as const;
export function bucketOf(mult: number): number {
  if (mult === 0) return 0;
  let best: number = BUCKETS[1];
  for (const b of BUCKETS.slice(1)) {
    if (Math.abs(mult - b) < Math.abs(mult - best)) best = b;
  }
  return best;
}

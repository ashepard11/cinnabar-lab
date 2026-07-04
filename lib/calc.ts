/**
 * Damage-calc wrapper around @smogon/calc for Pokémon Champions.
 *
 * Champions support comes from the master branch of smogon/damage-calc
 * (commit ebe3a81), vendored as vendor/smogon-calc-0.11.0-champions-master.tgz
 * because the released 0.11.0 npm package has no Champions data. Champions is
 * generation 0 in that build.
 *
 * SP system: @smogon/calc's `evs` field IS the Champions SP field (0–32 per
 * stat) in gen 0 — there is first-class support, no approximation needed.
 * When converting Pikalytics EV-denominated spreads use `evsToSps` from
 * lib/pokemon.ts (SP = ceil(EV/8), EV 4 → SP 1, mirroring the official
 * damage-calc UI).
 */
import {calculate as smogonCalculate, Field} from '@smogon/calc';
import {GEN, buildMove, buildPokemon} from './pokemon';
import type {CalcResult, FieldSpec, MoveSpec, PokemonSpec} from './types';

/**
 * Run a single damage calc. Returns min/max/avg damage of the 16 rolls as a
 * fraction of the defender's max HP (one hit of a multi-hit counts all hits,
 * as @smogon/calc folds `hits` into the returned rolls).
 *
 * Note: this returns single-target damage. Spread-move accounting for viz 1
 * (the ×1.5 "both targets" multiplier) is applied by the caller, not here.
 */
export function calculate(
  attacker: PokemonSpec,
  defender: PokemonSpec,
  move: MoveSpec,
  field: FieldSpec
): CalcResult {
  const att = buildPokemon(attacker);
  const def = buildPokemon(defender);
  const mv = buildMove(move);
  const f = new Field({
    gameType: field.isDoubles ? 'Doubles' : 'Singles',
    weather: field.weather ?? undefined,
  });

  const result = smogonCalculate(GEN, att, def, mv, f);
  const maxHP = def.maxHP();

  // result.damage is a number for 0-damage cases, an array of 16 rolls
  // normally, or an array of arrays for Parental-Bond-style multi-part hits.
  const rolls = flattenDamage(result.damage as number | number[] | number[][]);
  const min = Math.min(...rolls);
  const max = Math.max(...rolls);
  const avg = rolls.reduce((a, b) => a + b, 0) / rolls.length;

  return {min: min / maxHP, max: max / maxHP, avg: avg / maxHP};
}

function flattenDamage(damage: number | number[] | number[][]): number[] {
  if (typeof damage === 'number') return [damage];
  if (damage.length === 0) return [0];
  if (typeof damage[0] === 'number') return damage as number[];
  // Multi-part damage (e.g. Parental Bond): sum part-wise min..max pairs.
  const parts = damage as number[][];
  const n = parts[0].length;
  const summed: number[] = new Array(n).fill(0);
  for (const part of parts) {
    for (let i = 0; i < n; i++) summed[i] += part[i];
  }
  return summed;
}

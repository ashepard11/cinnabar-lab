/**
 * lib/evaluator/damage.ts — team damage sources by type (SPEC-team-evaluator.md
 * Phase 6, added in D36): a team-local version of viz 1, minus the metagame
 * weighting. One clean hit per member × damaging move into STANDARD_TARGET
 * under the attacker's auto-weather; expected = avg roll × 1.5 spread
 * multiplier; aggregate by calc-resolved (type, category); emit the exact
 * Viz1Data shape so the existing Marimekko component renders unmodified.
 *
 * This is the ONE module in lib/evaluator/ allowed to import @smogon/calc
 * (transitively via lib/calc.ts) — the calc is browser-safe by design.
 */
import {calculate} from '../calc';
import {classifyMove, STATE_DEPENDENT_BP_MOVES, WEATHER_ABILITIES} from '../moves';
import {STANDARD_TARGET} from '../variants';
import type {ParsedSet} from './parse';
import type {MoveCategory, PokemonSpec, TypeName, Viz1Cell, Viz1Data} from '../types';

export interface DamageSources {
  viz: Viz1Data;
  /** Moves included at in-model BP but undercounted (state-dependent BP). */
  flagged: string[];
  /** Moves excluded from the chart, with the classifyMove reason. */
  skipped: Array<{member: string; move: string; reason: string}>;
}

/** The viz-1 spread convention: both-target total from your side's view. */
const SPREAD_MULTIPLIER = 1.5;

export function teamDamageSources(sets: ParsedSet[]): DamageSources {
  interface Entry {
    type: TypeName;
    category: MoveCategory;
    member: ParsedSet;
    move: string;
    expected: number;
  }
  const entries: Entry[] = [];
  const flagged = new Set<string>();
  const skipped: DamageSources['skipped'] = [];

  for (const set of sets) {
    const attacker: PokemonSpec = {
      species: set.battleSpecies,
      ability: set.ability,
      item: set.item,
      nature: set.nature,
      sps: set.sps,
    };
    const weather = WEATHER_ABILITIES[set.ability] ?? null;

    for (const moveName of set.moves) {
      const cls = classifyMove(moveName);
      if (!cls.include) {
        skipped.push({member: set.battleSpecies, move: moveName, reason: cls.reason ?? 'excluded'});
        continue;
      }
      if (cls.flagged || STATE_DEPENDENT_BP_MOVES.has(moveName)) flagged.add(moveName);
      try {
        const result = calculate(attacker, STANDARD_TARGET, {name: moveName}, {
          isDoubles: true,
          weather,
        });
        if (result.effective.category === 'Status' || result.effective.type === '???') continue;
        const expected = result.avg * (result.effective.isSpread ? SPREAD_MULTIPLIER : 1);
        entries.push({
          type: result.effective.type,
          category: result.effective.category,
          member: set,
          move: moveName,
          expected,
        });
      } catch (e) {
        skipped.push({member: set.battleSpecies, move: moveName, reason: `calc error: ${String(e)}`});
      }
    }
  }

  const total = entries.reduce((a, e) => a + e.expected, 0);
  const byCell = new Map<string, Viz1Cell>();
  for (const e of entries) {
    const key = `${e.type}|${e.category}`;
    if (!byCell.has(key)) {
      byCell.set(key, {type: e.type, category: e.category, share: 0, contributors: []});
    }
    const cell = byCell.get(key)!;
    cell.share += total > 0 ? e.expected / total : 0;
    cell.contributors.push({
      variant_id: `member-${sets.indexOf(e.member)}`,
      species: e.member.battleSpecies,
      item: e.member.isMega ? null : e.member.item,
      move: e.move,
      expected_damage: e.expected,
      share: total > 0 ? e.expected / total : 0,
    });
  }
  for (const cell of byCell.values()) {
    cell.contributors.sort((a, b) => b.expected_damage - a.expected_damage);
  }
  const cells = [...byCell.values()].sort((a, b) => b.share - a.share);

  return {
    viz: {generated_at: new Date().toISOString(), cells},
    flagged: [...flagged].sort(),
    skipped,
  };
}

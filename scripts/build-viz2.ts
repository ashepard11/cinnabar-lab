/**
 * Build data/viz2-data.json — the heatmap of relative damage dealt to the
 * weighted metagame field by a generic 90 BP attack of each (type, category).
 *
 * Synthetic attacker: base 100 offenses, 0 SP, neutral nature, no item, inert
 * ability, and `???` typing so NO move gets STAB (all 36 cells directly
 * comparable; see DECISIONS.md D14).
 *
 * Run: npm run build-viz2
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {calculate} from '../lib/calc';
import {ALL_TYPES} from '../lib/types';
import type {
  MoveCategory, PokemonSpec, Variant, VariantsData, Viz2Cell, Viz2Data,
} from '../lib/types';

const DATA_DIR = path.join(__dirname, '..', 'data');
const GENERIC_BP = 90;
const CONTRIBUTORS_KEPT = 10;

const CATEGORIES: MoveCategory[] = ['Physical', 'Special'];

/** Existing plain single-target damaging moves to use as override bases. */
const BASE_MOVE: Record<MoveCategory, string> = {
  Physical: 'Body Slam',
  Special: 'Ice Beam',
};

function syntheticAttacker(category: MoveCategory, defenderAbility: string): PokemonSpec {
  return {
    species: 'Snorlax', // stand-in body; stats and typing fully overridden
    nature: 'Hardy',
    sps: {},
    ability: 'Insomnia',
    overrides: {
      baseStats: {hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100},
      types: ['???'],
    },
    // Intimidate models as -1 Atk on the physical attacker (spec Phase 4).
    boosts: category === 'Physical' && defenderAbility === 'Intimidate' ? {atk: -1} : undefined,
  };
}

/**
 * A defender as the heatmap sees it. Held items have no defensive effect in
 * our model (damage-boost items are offensive-only; defensive items were
 * bucketed away in Phase 2), so same-species variants that differ only by
 * item are merged with summed weight — unlike the marimekko, where the item
 * changes attacking output. Megas keep their own entries (different stats,
 * typing, ability). Merging is exactly weight-linear, so cell values are
 * unchanged; only the contributor drilldown gets cleaner.
 */
interface Defender {
  id: string;
  species: string;
  ability: string;
  nature: string;
  sps: Variant['sps'];
  item: string | null;
  weight: number;
}

function mergeDefensiveVariants(variants: Variant[]): Defender[] {
  const byProfile = new Map<string, Defender>();
  for (const v of variants) {
    // Megas hold their stone (cosmetic here); merged non-Megas hold nothing
    // since the merge spans items. Key on everything that affects damage taken.
    const key = [v.species, v.ability, v.nature, JSON.stringify(v.sps)].join('|');
    const existing = byProfile.get(key);
    if (existing) {
      existing.weight += v.weight;
    } else {
      byProfile.set(key, {
        id: v.is_mega ? v.id : `${v.species.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_defense`,
        species: v.species,
        ability: v.ability,
        nature: v.nature,
        sps: v.sps,
        item: v.is_mega ? v.item : null,
        weight: v.weight,
      });
    }
  }
  return [...byProfile.values()];
}

function main() {
  const {variants}: VariantsData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'defender-variants.json'), 'utf8')
  );
  const defenders = mergeDefensiveVariants(variants);

  // Weights are team-inclusion rates and sum to ~5.4 (six team slots, minus
  // sub-threshold mass). Normalize them to a probability distribution so
  // weighted_damage reads as "average damage vs a random defender from the
  // field" — the `relative` values are unaffected, but the absolute numbers
  // shown in tooltips become meaningful.
  const totalWeight = defenders.reduce((a, v) => a + v.weight, 0);
  const weightOf = (v: Defender) => v.weight / totalWeight;

  const cells: Viz2Cell[] = [];
  for (const type of ALL_TYPES) {
    for (const category of CATEGORIES) {
      const contributors: Array<{variant: Defender; damage: number}> = [];
      let weighted = 0;

      for (const v of defenders) {
        const defender: PokemonSpec = {
          species: v.species,
          ability: v.ability,
          item: v.item,
          nature: v.nature,
          sps: v.sps,
        };
        const move = {
          name: BASE_MOVE[category],
          overrides: {basePower: GENERIC_BP, type, category},
        };
        const result = calculate(
          syntheticAttacker(category, v.ability),
          defender,
          move,
          {isDoubles: true}
        );
        weighted += weightOf(v) * result.avg;
        contributors.push({variant: v, damage: result.avg});
      }

      contributors.sort((a, b) => weightOf(b.variant) * b.damage - weightOf(a.variant) * a.damage);
      cells.push({
        type,
        category,
        weighted_damage: weighted,
        relative: 0, // filled in after the mean is known
        contributors: contributors.slice(0, CONTRIBUTORS_KEPT).map((c) => ({
          variant_id: c.variant.id,
          species: c.variant.species,
          item: null, // items are merged away defensively; Mega formes are in the species name
          damage: c.damage,
          weighted_contribution: weightOf(c.variant) * c.damage,
        })),
      });
    }
  }

  const average = cells.reduce((a, c) => a + c.weighted_damage, 0) / cells.length;
  for (const c of cells) c.relative = c.weighted_damage / average;

  const out: Viz2Data = {
    generated_at: new Date().toISOString(),
    average_damage: average,
    cells,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'viz2-data.json'), JSON.stringify(out, null, 2) + '\n');

  const sorted = cells.slice().sort((a, b) => b.relative - a.relative);
  console.log(`Wrote viz2-data.json. average_damage = ${(average * 100).toFixed(1)}% of defender HP`);
  console.log('Top cells:', sorted.slice(0, 5).map((c) => `${c.type} ${c.category} ${c.relative.toFixed(2)}`).join(' | '));
  console.log('Bottom cells:', sorted.slice(-5).map((c) => `${c.type} ${c.category} ${c.relative.toFixed(2)}`).join(' | '));
}

main();

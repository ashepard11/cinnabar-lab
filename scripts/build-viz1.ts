/**
 * Build data/viz1-data.json — the Marimekko of where metagame damage comes
 * from, by (attack type, category), weighted by Pokémon usage × move usage ×
 * average damage into the standard synthetic target (× 1.5 for spread moves).
 *
 * Run: npm run build-viz1
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {calculate} from '../lib/calc';
import {classifyMove, WEATHER_ABILITIES} from '../lib/moves';
import {STANDARD_TARGET} from '../lib/variants';
import type {
  MoveCategory, PokemonSpec, TypeName, VariantsData, Viz1Cell, Viz1Contributor, Viz1Data,
} from '../lib/types';

const DATA_DIR = path.join(__dirname, '..', 'data');
/** Spec: only moves with ≥ this usage within their Pokémon. */
const MOVE_USAGE_MIN = 0.10;
const CONTRIBUTORS_KEPT = 10;

function main() {
  const {variants}: VariantsData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'defender-variants.json'), 'utf8')
  );

  const skipped = new Map<string, string>();
  const flagged = new Map<string, string>();
  const cells = new Map<string, {type: TypeName; category: MoveCategory; contributors: Viz1Contributor[]}>();

  for (const v of variants) {
    const attacker: PokemonSpec = {
      species: v.species,
      ability: v.ability,
      item: v.item,
      nature: v.nature,
      sps: v.sps,
    };
    const weather = WEATHER_ABILITIES[v.ability] ?? null;

    for (const move of v.moves) {
      if (move.usage < MOVE_USAGE_MIN) continue;
      const cls = classifyMove(move.name);
      if (!cls.include) {
        if (cls.reason !== 'status move' && cls.reason !== 'aggregate "Other" row') {
          skipped.set(move.name, cls.reason ?? '');
        }
        continue;
      }
      if (cls.flagged) flagged.set(move.name, cls.reason ?? '');

      const result = calculate(attacker, STANDARD_TARGET, {name: move.name}, {
        isDoubles: true,
        weather,
      });
      if (result.effective.category === 'Status') continue; // safety net

      const spreadMultiplier = result.effective.isSpread ? 1.5 : 1.0;
      const expected = v.weight * move.usage * result.avg * spreadMultiplier;
      if (expected === 0) continue;

      // Aggregate by the RESOLVED type (Weather Ball under Drought sun counts
      // as Fire, which is what actually threatens the field).
      const type = result.effective.type as TypeName;
      const category = result.effective.category;
      const key = `${type}|${category}`;
      if (!cells.has(key)) cells.set(key, {type, category, contributors: []});
      cells.get(key)!.contributors.push({
        variant_id: v.id,
        species: v.species,
        item: v.is_mega ? null : v.item,
        move: move.name,
        expected_damage: expected,
        share: 0, // normalized once the all-cells total is known
      });
    }
  }

  const total = [...cells.values()].reduce(
    (a, c) => a + c.contributors.reduce((s, x) => s + x.expected_damage, 0), 0
  );

  const outCells: Viz1Cell[] = [...cells.values()]
    .map((c) => {
      const cellTotal = c.contributors.reduce((s, x) => s + x.expected_damage, 0);
      return {
        type: c.type,
        category: c.category,
        share: cellTotal / total,
        contributors: c.contributors
          .sort((a, b) => b.expected_damage - a.expected_damage)
          .slice(0, CONTRIBUTORS_KEPT)
          .map((x) => ({...x, share: x.expected_damage / total})),
      };
    })
    .sort((a, b) => b.share - a.share);

  const out: Viz1Data = {
    generated_at: new Date().toISOString(),
    cells: outCells,
  };
  fs.writeFileSync(path.join(DATA_DIR, 'viz1-data.json'), JSON.stringify(out, null, 2) + '\n');

  console.log(`Wrote viz1-data.json: ${outCells.length} cells, share sum = ${outCells.reduce((a, c) => a + c.share, 0).toFixed(3)}`);
  console.log('Top cells:');
  for (const c of outCells.slice(0, 6)) {
    console.log(`  ${c.type} ${c.category} ${(c.share * 100).toFixed(1)}% — top: ${c.contributors.slice(0, 2).map((x) => `${x.species} ${x.move}`).join('; ')}`);
  }
  if (flagged.size) console.log('Flagged (state-dependent BP, in-model default):', [...flagged.keys()].join(', '));
  if (skipped.size) console.log('Skipped:', [...skipped.entries()].map(([m, r]) => `${m} (${r})`).join(', '));
}

main();

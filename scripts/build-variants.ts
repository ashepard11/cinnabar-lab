/**
 * Build data/defender-variants.json from data/usage-tournaments.json.
 * Run: npm run build-variants
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {buildAllVariants} from '../lib/variants';
import {speciesExists, abilityExists} from '../lib/pokemon';
import type {UsageData, VariantsData} from '../lib/types';

const DATA_DIR = path.join(__dirname, '..', 'data');

function main() {
  const usage: UsageData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'usage-tournaments.json'), 'utf8')
  );

  const variants = buildAllVariants(usage.pokemon);

  // Validate against the calc dex — a name that doesn't resolve would silently
  // produce garbage calcs later.
  for (const v of variants) {
    if (!speciesExists(v.species)) throw new Error(`Unknown species in variant ${v.id}: ${v.species}`);
    if (!abilityExists(v.ability)) throw new Error(`Unknown ability in variant ${v.id}: ${v.ability}`);
  }

  const out: VariantsData = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    variants,
  };
  fs.writeFileSync(
    path.join(DATA_DIR, 'defender-variants.json'),
    JSON.stringify(out, null, 2) + '\n'
  );

  const megas = variants.filter((v) => v.is_mega).length;
  const boosted = variants.filter((v) => !v.is_mega && v.item !== null).length;
  const totalWeight = variants.reduce((a, v) => a + v.weight, 0);
  console.log(
    `Wrote defender-variants.json: ${variants.length} variants ` +
    `(${megas} Mega, ${boosted} damage-boosted, ${variants.length - megas - boosted} no-item) ` +
    `from ${usage.pokemon.length} Pokémon; total weight ${totalWeight.toFixed(3)}`
  );
}

main();

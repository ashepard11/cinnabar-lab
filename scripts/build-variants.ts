/**
 * Build data/defender-variants.json from data/usage-tournaments.json.
 * Run: npm run build-variants
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {buildAllVariants} from '../lib/variants';
import {speciesExists, abilityExists} from '../lib/pokemon';
import {variantCid} from '../lib/variant-cid';
import {activeRegulationConfig, assertSpBudget} from '../lib/format-rules';
import {
  VARIANT_SCHEMA_VERSION, assignTiers, defaultSetLabel, assertVariantsData,
} from '../lib/variant-schema';
import type {FormatRulesFile} from './build-format-rules';
import type {UsageData, VariantsData} from '../lib/types';

const DATA_DIR = path.join(__dirname, '..', 'data');

function main() {
  const usage: UsageData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'usage-tournaments.json'), 'utf8')
  );

  const rules = activeRegulationConfig();
  const variants = buildAllVariants(usage.pokemon);

  // Validate against the calc dex — a name that doesn't resolve would silently
  // produce garbage calcs later.
  for (const v of variants) {
    if (!speciesExists(v.species)) throw new Error(`Unknown species in variant ${v.id}: ${v.species}`);
    if (!abilityExists(v.ability)) throw new Error(`Unknown ability in variant ${v.id}: ${v.ability}`);
    // SP budget (BACKLOG item 09). Champions gives 66 points with a 32-per-stat
    // cap and each point is worth exactly 1 to the final stat, so a spread that
    // breaks the budget is a scrape/parse error rather than an exotic set.
    // Reject rather than clamp: a clamped spread produces plausible-looking
    // damage numbers that are quietly wrong.
    assertSpBudget(v.sps, rules, `variant ${v.id}`);
  }

  // Content-addressed ids (BACKLOG item 02). Distinct variants must not
  // collide: same-cid duplicates would be battle-identical by construction,
  // which the item bucketing should never produce.
  const byCid = new Map<string, string>();
  for (const v of variants) {
    v.cid = variantCid(v);
    const clash = byCid.get(v.cid);
    if (clash) throw new Error(`cid collision: ${v.id} and ${clash} are battle-identical (${v.cid})`);
    byCid.set(v.cid, v.id);
  }

  // Schema v3 fields (BACKLOG item 09). national_dex comes from the resolved
  // format rules rather than a name-parsing heuristic, because the species
  // clause keys on it and alternate formes must collide.
  const rulesFile: FormatRulesFile = JSON.parse(
    fs.readFileSync(
      path.join(DATA_DIR, `format-rules-${rules.regulation_id}.json`), 'utf8'
    )
  );
  const nationalDex = new Map(rulesFile.national_dex);
  const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

  const enriched = assignTiers(
    variants.map((v) => {
      const dex = nationalDex.get(toId(v.species));
      if (dex === undefined) {
        throw new Error(`No National Pokédex number for ${v.species} (variant ${v.id})`);
      }
      return {
        ...v,
        national_dex: dex,
        set_label: defaultSetLabel(v),
        moves_source: 'modal_set' as const,
      };
    })
  );

  const out: VariantsData = {
    schema_version: VARIANT_SCHEMA_VERSION,
    regulation: rules.regulation_id,
    generated_at: new Date().toISOString(),
    variants: enriched,
  };
  assertVariantsData(out, rules, new Set(rulesFile.legal_species));
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

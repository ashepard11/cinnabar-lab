/**
 * scripts/build-format-rules.ts — resolve a regulation's legality sets from
 * the vendored pokemon-showdown mod into data/format-rules-<id>.json
 * (BACKLOG item 10, SPEC-teambuilder.md Phase 0).
 *
 * Run: npm run build-format-rules            (active regulation)
 *      npm run build-format-rules -- --all   (every sourceable regulation)
 *
 * lib/format-rules.ts holds the declarative half — dates, clauses, which mod
 * carries which regulation — and must stay browser-safe. This is the half that
 * reads Showdown, so it lives in scripts/ and emits JSON the frontend can
 * fetch, the same split scripts/build-evaluator-dex.ts uses.
 *
 * Sourcing rules, following the same existence/metadata split as the evaluator
 * dex build:
 *  - *Existence* comes from the vendored @smogon/calc gen-0 dex, which is the
 *    trimmed Champions roster. The Showdown mod inherits the full gen-9 dex,
 *    so its species table is NOT Champions existence — iterating it directly
 *    admits hundreds of species that do not exist in the format.
 *  - *Species legality* comes from the mod's formats-data tier assignments,
 *    intersected with that existence check. A species is legal when its tier
 *    is neither "Illegal" nor an Uber-class tier, and it is not flagged
 *    isNonstandard. Champions BSS is a flat format with no restricted
 *    legendaries, so Uber is the restricted bucket.
 *  - *Item legality* comes from the mod's item table, filtered to items that
 *    exist in the mod and are not marked nonstandard.
 *  - *Mega capability* is read off species with a `requiredItem` and a
 *    `forme` of "Mega"/"Mega-X"/"Mega-Y", which is how the dex models stones.
 *  - *National Pokédex numbers* come from the dex's `num` field, which is what
 *    the species clause keys on.
 *
 * Per-species move bans from balance patches are NOT resolvable from the
 * vendored build: Showdown models them by removing the move from the learnset,
 * which is indistinguishable from a Pokémon that never learned it. The emitted
 * `banned_moves` is therefore empty and the field is a placeholder until a
 * source exists. That is recorded rather than faked.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {Dex} from 'pokemon-showdown';
import {GEN} from '../lib/pokemon';
import {
  REGULATIONS,
  activeRegulationId,
  isSourceable,
  type RegulationConfig,
  type RegulationId,
} from '../lib/format-rules';

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Tiers that mean "not legal in a flat Champions format".
 *
 * Only "Illegal". The mod's `tier` field is the Champions *singles ladder*
 * tiering — OU, UU, UUBL, Uber — not VGC legality, and the two disagree:
 * Gholdengo, Mega Gengar, Mega Blastoise, Mega Blaziken, Mega Lucario,
 * Mega Starmie and Palafin are all Uber on that ladder and all perfectly legal
 * in BSS. Four of them appear in the scraped M-B usage data, which is how this
 * was caught. Champions carries no restricted legendaries, Paradox Pokémon or
 * Treasures of Ruin at all, so there is no restricted bucket to subtract here.
 */
const EXCLUDED_TIERS = new Set(['Illegal']);

/** The JSON shape written to disk. Sets and Maps serialize as arrays/pairs. */
export interface FormatRulesFile {
  schema_version: 1;
  regulation_id: RegulationId;
  generated_at: string;
  showdown_mod: string;
  sim_format: string;
  legal_species: string[];
  legal_items: string[];
  /** [speciesId, itemId] pairs. */
  mega_capable: [string, string][];
  /** [speciesId, moveId[]] pairs. Empty — see the module comment. */
  banned_moves: [string, string[]][];
  /** [speciesId, nationalDexNumber] pairs. */
  national_dex: [string, number][];
}

const warnings: string[] = [];

function resolve(config: RegulationConfig): FormatRulesFile {
  if (!isSourceable(config)) {
    throw new Error(
      `Regulation ${config.regulation_id} has no mod in the vendored Showdown build. ` +
        `Re-vendor pokemon-showdown to resolve it; that bumps SIM_ENGINE_VERSION ` +
        `and invalidates data/matchups.sqlite.`
    );
  }
  const mod = Dex.mod(config.showdown_mod!);

  const legalSpecies: string[] = [];
  const megaCapable: [string, string][] = [];
  const nationalDex: [string, number][] = [];

  for (const calcSpecies of GEN.species) {
    const species = mod.species.get(calcSpecies.name);
    // In the calc dex but unknown to the mod: a naming divergence worth
    // knowing about rather than silently dropping.
    if (!species.exists) {
      warnings.push(`${calcSpecies.name} exists in the calc dex but not in mod ${config.showdown_mod}`);
      continue;
    }
    const legal =
      !species.isNonstandard &&
      species.tier !== undefined &&
      !EXCLUDED_TIERS.has(species.tier);
    if (!legal) continue;

    legalSpecies.push(species.id);
    nationalDex.push([species.id, species.num]);

    // Megas are modelled as separate species gated behind a required item.
    if (species.requiredItem && /^Mega(-[XY])?$/.test(species.forme)) {
      megaCapable.push([species.id, mod.items.get(species.requiredItem).id]);
    }
  }

  const legalItems: string[] = [];
  for (const item of mod.items.all()) {
    if (item.isNonstandard) continue;
    legalItems.push(item.id);
  }

  return {
    schema_version: 1,
    regulation_id: config.regulation_id,
    generated_at: new Date().toISOString(),
    showdown_mod: config.showdown_mod!,
    sim_format: config.sim_format!,
    legal_species: legalSpecies.sort(),
    legal_items: legalItems.sort(),
    mega_capable: megaCapable.sort((a, b) => a[0].localeCompare(b[0])),
    banned_moves: [],
    national_dex: nationalDex.sort((a, b) => a[0].localeCompare(b[0])),
  };
}

function write(config: RegulationConfig): FormatRulesFile {
  const file = resolve(config);
  const out = path.join(DATA_DIR, `format-rules-${config.regulation_id}.json`);
  fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n');

  // Distinct dex numbers is the count that matters for the species clause:
  // alternate formes collide under it, so it is well below the species count.
  const distinctDex = new Set(file.national_dex.map(([, num]) => num)).size;
  console.log(
    `${config.regulation_id}: ${file.legal_species.length} species ` +
      `(${distinctDex} distinct Pokédex numbers), ${file.legal_items.length} items, ` +
      `${file.mega_capable.length} Mega formes → ${path.relative(process.cwd(), out)}`
  );
  return file;
}

function main() {
  const all = process.argv.includes('--all');
  const targets: RegulationConfig[] = all
    ? Object.values(REGULATIONS).filter(isSourceable)
    : [REGULATIONS[activeRegulationId(process.env.CHAMPIONS_REGULATION)]];

  for (const config of targets) write(config);

  if (warnings.length > 0) {
    console.log(`
${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 20)) console.log(`  ${w}`);
    if (warnings.length > 20) console.log(`  … and ${warnings.length - 20} more`);
  }

  const unsourceable = Object.values(REGULATIONS).filter((r) => !isSourceable(r));
  if (all && unsourceable.length > 0) {
    console.log(
      `\nUnsourceable in the vendored build: ` +
        unsourceable.map((r) => r.regulation_id).join(', ') +
        ` — see lib/format-rules.ts.`
    );
  }
}

main();

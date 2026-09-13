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
 * Everything is resolved against the regulation's **VGC doubles** format, not
 * the BSS singles format the 1v1 harness runs in. `Flat Rules` resolves
 * `Picked Team Size = Auto` by game type, so BSS reports bring-3 and VGC
 * reports bring-4; sourcing clauses from the harness's format would describe a
 * different game. `sim_format` is an implementation detail of the simulator
 * (DECISIONS.md D20-D21) and is recorded here only for provenance.
 *
 * Sourcing rules, following the same existence/metadata split as the evaluator
 * dex build:
 *  - *Existence* comes from the vendored @smogon/calc gen-0 dex, which is the
 *    trimmed Champions roster. The Showdown mod inherits the full gen-9 dex,
 *    so its species table is NOT Champions existence — iterating it directly
 *    admits hundreds of species that do not exist in the format.
 *  - *Species legality* comes from the VGC format's rule table, intersected
 *    with that existence check: a species is legal when the format's own
 *    banlist does not ban it. The banlist is tag-driven (`-tag:mythical`,
 *    `-tag:restrictedlegendary`, `-nonexistent`, …), which is why Mewtwo is
 *    excluded and Gholdengo is not. Do NOT read legality off the mod's `tier`
 *    field — that is the Champions *singles ladder* tiering (OU/UU/Uber) and
 *    disagrees with VGC legality on species that see real usage.
 *  - *Clause values* (team size, bring count, level, item and species clauses)
 *    come from the same rule table and are checked against the values declared
 *    in lib/format-rules.ts. A mismatch fails the build rather than letting a
 *    regulation change slip through unnoticed.
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



/** The JSON shape written to disk. Sets and Maps serialize as arrays/pairs. */
export interface FormatRulesFile {
  schema_version: 1;
  regulation_id: RegulationId;
  generated_at: string;
  showdown_mod: string;
  /** VGC doubles format the legality below was resolved from. */
  legality_format: string;
  /** BSS singles format the 1v1 harness runs in. Provenance only. */
  sim_format: string;
  /** Clause values read back out of the format's rule table. */
  sourced_clauses: {
    team_size: number;
    bring_count: number;
    level: number;
    item_clause: boolean;
    species_clause: boolean;
  };
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
  const format = Dex.formats.get(config.legality_format!);
  if (!format.exists) {
    throw new Error(`Format ${config.legality_format} not found in the vendored Showdown build.`);
  }
  if (format.gameType !== 'doubles') {
    throw new Error(
      `Format ${config.legality_format} is ${format.gameType}, not doubles. ` +
        `Legality must come from the VGC format — see the module comment.`
    );
  }
  const mod = Dex.mod(format.mod);
  const ruleTable = Dex.formats.getRuleTable(format);

  // Clause values are read back out of the rule table and cross-checked
  // against what lib/format-rules.ts declares, so a regulation that changes
  // one fails the build instead of silently disagreeing with the search.
  const sourced = {
    team_size: ruleTable.maxTeamSize,
    bring_count: ruleTable.pickedTeamSize ?? ruleTable.maxTeamSize,
    level: ruleTable.adjustLevel ?? ruleTable.adjustLevelDown ?? 0,
    item_clause: ruleTable.has('itemclause'),
    species_clause: ruleTable.has('speciesclause'),
  };
  const mismatches: string[] = [];
  if (sourced.team_size !== config.team_size) mismatches.push(`team_size ${sourced.team_size} vs declared ${config.team_size}`);
  if (sourced.bring_count !== config.bring_count) mismatches.push(`bring_count ${sourced.bring_count} vs declared ${config.bring_count}`);
  if (sourced.level !== config.level) mismatches.push(`level ${sourced.level} vs declared ${config.level}`);
  if (sourced.item_clause !== config.item_clause) mismatches.push(`item_clause ${sourced.item_clause} vs declared ${config.item_clause}`);
  if (!sourced.species_clause) mismatches.push('species clause absent from the format');
  if (mismatches.length > 0) {
    throw new Error(
      `${config.regulation_id}: lib/format-rules.ts disagrees with ${config.legality_format} — ` +
        mismatches.join('; ')
    );
  }

  const legalSpecies: string[] = [];
  const megaCapable: [string, string][] = [];
  const nationalDex: [string, number][] = [];

  for (const calcSpecies of GEN.species) {
    const species = mod.species.get(calcSpecies.name);
    // In the calc dex but unknown to the mod: a naming divergence worth
    // knowing about rather than silently dropping.
    if (!species.exists) {
      warnings.push(`${calcSpecies.name} exists in the calc dex but not in mod ${format.mod}`);
      continue;
    }
    if (ruleTable.isBannedSpecies(species)) continue;

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
    showdown_mod: format.mod,
    legality_format: config.legality_format!,
    sim_format: config.sim_format!,
    sourced_clauses: sourced,
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

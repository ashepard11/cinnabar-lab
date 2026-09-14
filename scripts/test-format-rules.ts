/**
 * scripts/test-format-rules.ts — the "Format rules" test cases from
 * SPEC-teambuilder.md, plus the SP budget validation from BACKLOG item 09.
 *
 * Run: npm run test-format-rules (also part of npm test).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  REGULATIONS,
  activeRegulationId,
  assertSpBudget,
  isSourceable,
  regulationConfig,
  validateSpSpread,
  validateTeam,
  type FormatRules,
  type RegulationId,
  type TeamMemberRef,
} from '../lib/format-rules';
import {
  VARIANT_SCHEMA_VERSION, assignTiers, defaultSetLabel, validateVariantsData,
  CORE_TIER_MIN_WEIGHT, TOURNAMENT_ROUNDS, coreTierMinWeight,
} from '../lib/variant-schema';
import type {Variant, VariantsData} from '../lib/types';
import type {FormatRulesFile} from './build-format-rules';

const DATA_DIR = path.join(__dirname, '..', 'data');

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function section(name: string): void {
  console.log(`\n${name}\n`);
}

function loadResolved(id: RegulationId): FormatRules {
  const file: FormatRulesFile = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, `format-rules-${id}.json`), 'utf8')
  );
  return {
    ...regulationConfig(id),
    legal_species: new Set(file.legal_species),
    legal_items: new Set(file.legal_items),
    mega_capable: new Map(file.mega_capable),
    banned_moves: new Map(file.banned_moves.map(([s, m]) => [s, new Set(m)])),
    national_dex: new Map(file.national_dex),
  };
}

// ---------------------------------------------------------------------------
section('Regulation configuration');

check(
  'unset configuration falls back to the default regulation',
  activeRegulationId(undefined) === 'M-B' && activeRegulationId('') === 'M-B'
);

check('a known regulation id resolves', activeRegulationId('M-A') === 'M-A');

let threwOnUnknown = false;
try {
  activeRegulationId('M-Z');
} catch {
  threwOnUnknown = true;
}
check('an unknown regulation throws rather than falling back', threwOnUnknown);

check(
  'M-C is declared but unsourceable in the vendored build',
  !isSourceable(REGULATIONS['M-C']) && REGULATIONS['M-C'].active_from === '2026-09-09'
);

check(
  'every regulation carries the same Champions constants',
  Object.values(REGULATIONS).every(
    (r) =>
      r.level === 50 &&
      r.sp_total === 66 &&
      r.sp_per_stat_cap === 32 &&
      r.team_size === 6 &&
      r.bring_count === 4
  )
);

// ---------------------------------------------------------------------------
section('Legality is sourced, not hardcoded');

const mb = loadResolved('M-B');
const ma = loadResolved('M-A');

check(
  'switching regulation changes the species pool with no code change',
  ma.legal_species.size !== mb.legal_species.size,
  `M-A ${ma.legal_species.size} vs M-B ${mb.legal_species.size}`
);

check(
  'switching regulation changes the item pool with no code change',
  ma.legal_items.size !== mb.legal_items.size,
  `M-A ${ma.legal_items.size} vs M-B ${mb.legal_items.size}`
);

check(
  'nothing legal in M-A was removed in M-B',
  [...ma.legal_species].every((s) => mb.legal_species.has(s))
);

check(
  'M-B item count matches the regulation announcement (148)',
  mb.legal_items.size === 148,
  `${mb.legal_items.size}`
);

check(
  'Mega-capable species map to their stones',
  mb.mega_capable.get('charizardmegay') === 'charizarditey',
  `${mb.mega_capable.get('charizardmegay')}`
);

check(
  'banned_moves is empty and documented as unsourceable',
  mb.banned_moves.size === 0
);

// Legality must come from the VGC doubles format, not the BSS singles format
// the 1v1 harness runs in. Flat Rules resolves "Picked Team Size = Auto" by
// game type, so BSS reports bring-3 and VGC reports bring-4 — sourcing from
// the harness's format would silently describe a different game.
const mbFile: FormatRulesFile = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'format-rules-M-B.json'), 'utf8')
);
check(
  'legality is resolved from the VGC doubles format, not BSS',
  mbFile.legality_format.includes('vgc') && !mbFile.legality_format.includes('bss'),
  mbFile.legality_format
);
check(
  'the BSS format is recorded separately, for the harness only',
  mbFile.sim_format.includes('bss'),
  mbFile.sim_format
);
check(
  'bring count sourced from the format is 4, not the BSS 3',
  mbFile.sourced_clauses.bring_count === 4,
  `${mbFile.sourced_clauses.bring_count}`
);
check(
  'sourced clauses agree with the declared config',
  mbFile.sourced_clauses.team_size === mb.team_size &&
    mbFile.sourced_clauses.bring_count === mb.bring_count &&
    mbFile.sourced_clauses.level === mb.level &&
    mbFile.sourced_clauses.item_clause === mb.item_clause &&
    mbFile.sourced_clauses.species_clause
);
check(
  'a restricted legendary is excluded by the format banlist',
  !mb.legal_species.has('mewtwo')
);
check(
  'species Uber on the singles ladder but legal in VGC are included',
  ['gholdengo', 'gengarmega', 'palafin', 'lucariomega'].every((s) => mb.legal_species.has(s))
);

// Every variant the pipeline actually built must be legal in the regulation it
// was built under. This is the check that would catch a mis-scoped tier filter.
const variants: VariantsData = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'defender-variants.json'), 'utf8')
);
const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const illegalVariants = variants.variants.filter(
  (v) => !mb.legal_species.has(toId(v.species))
);
check(
  'every built variant species is legal in M-B',
  illegalVariants.length === 0,
  illegalVariants.length > 0 ? illegalVariants.map((v) => v.species).join(', ') : `${variants.variants.length} variants`
);

// ---------------------------------------------------------------------------
section('SP budget (BACKLOG item 09)');

const rules = regulationConfig('M-B');

check(
  'a legal spread passes',
  validateSpSpread({hp: 32, atk: 32, spd: 2}, rules).length === 0
);

check(
  'under-spending is legal',
  validateSpSpread({hp: 4}, rules).length === 0
);

check(
  'a spread exceeding 66 total is rejected',
  validateSpSpread({hp: 32, atk: 32, def: 32}, rules).some((e) => e.kind === 'total'),
  '96 SP'
);

check(
  'a spread exceeding 32 in one stat is rejected',
  validateSpSpread({hp: 33}, rules).some((e) => e.kind === 'cap')
);

check(
  'a negative allocation is rejected',
  validateSpSpread({hp: -1}, rules).some((e) => e.kind === 'negative')
);

check(
  'a fractional allocation is rejected',
  validateSpSpread({hp: 1.5}, rules).some((e) => e.kind === 'fractional')
);

let threwOnBudget = false;
try {
  assertSpBudget({hp: 32, atk: 32, def: 32}, rules, 'test variant');
} catch {
  threwOnBudget = true;
}
check('assertSpBudget throws on an illegal spread', threwOnBudget);

const overBudget = variants.variants.filter(
  (v) => validateSpSpread(v.sps, rules).length > 0
);
check(
  'every built variant respects the 66/32 budget',
  overBudget.length === 0,
  overBudget.length > 0 ? overBudget.map((v) => v.id).join(', ') : `${variants.variants.length} variants`
);

// Champions has no EVs and no IVs, and every Pokémon is Level 50, so neither
// field should have survived into the variant records.
const withIvs = variants.variants.filter((v) => 'ivs' in v || 'evs' in v);
check('no variant carries an ivs or evs field', withIvs.length === 0);
const withLevel = variants.variants.filter(
  (v) => 'level' in v && (v as {level?: number}).level !== 50
);
check('no variant carries a level other than 50', withLevel.length === 0);

// ---------------------------------------------------------------------------
section('Variant schema v3 (BACKLOG item 09)');

check(
  'the committed file is schema v3 and names its regulation',
  variants.schema_version === VARIANT_SCHEMA_VERSION && variants.regulation === 'M-B',
  `v${variants.schema_version} / ${variants.regulation}`
);

check(
  'every variant carries national_dex, set_label, moves_source and tier',
  variants.variants.every(
    (v) =>
      typeof v.national_dex === 'number' &&
      typeof v.set_label === 'string' &&
      v.moves_source !== undefined &&
      (v.tier === 'core' || v.tier === 'extended')
  )
);

check(
  'national_dex agrees with the resolved format rules',
  variants.variants.every((v) => v.national_dex === mb.national_dex.get(toId(v.species)))
);

check(
  'a clean file validates with no errors',
  validateVariantsData(variants, rules, mb.legal_species).length === 0
);

check(
  'validation rejects a file whose regulation disagrees with the rules',
  validateVariantsData({...variants, regulation: 'M-A'}, rules, mb.legal_species).length > 0
);

const budgetBreaker: VariantsData = {
  ...variants,
  variants: [{...variants.variants[0], sps: {hp: 32, atk: 32, def: 32, spa: 0, spd: 0, spe: 0}}],
};
check(
  'validation rejects an over-budget spread on load',
  validateVariantsData(budgetBreaker, rules, mb.legal_species).some((e) =>
    e.message.includes('illegal SP spread')
  )
);

const withIvsField: VariantsData = {
  ...variants,
  variants: [{...variants.variants[0], ivs: {hp: 31}} as unknown as Variant],
};
check(
  'validation rejects a variant carrying an ivs field',
  validateVariantsData(withIvsField, rules, mb.legal_species).some((e) =>
    e.message.includes('ivs')
  )
);

// Tiering is a usage threshold, not a rank cutoff (DECISIONS.md D41), so a
// rescrape that reorders equal-weight variants cannot swap their tiers.
const core = variants.variants.filter((v) => v.tier === 'core');
const extended = variants.variants.filter((v) => v.tier === 'extended');
check(
  'core tier is exactly the variants at or above the usage threshold',
  core.every((v) => v.weight >= CORE_TIER_MIN_WEIGHT) &&
    extended.every((v) => v.weight < CORE_TIER_MIN_WEIGHT) &&
    core.length + extended.length === variants.variants.length,
  `${core.length} core / ${extended.length} extended at ` +
    `${(CORE_TIER_MIN_WEIGHT * 100).toFixed(2)}%`
);
check(
  'every core variant outweighs every extended one',
  Math.min(...core.map((v) => v.weight)) >= Math.max(...extended.map((v) => v.weight))
);
check(
  'the threshold is where one encounter becomes more likely than not',
  // 1 - (1 - w) ** rounds crosses 0.5 exactly at the threshold.
  Math.abs(1 - Math.pow(1 - CORE_TIER_MIN_WEIGHT, TOURNAMENT_ROUNDS) - 0.5) < 1e-12 &&
    Math.abs(coreTierMinWeight(1) - 0.5) < 1e-12,
  `${(CORE_TIER_MIN_WEIGHT * 100).toFixed(3)}% over ${TOURNAMENT_ROUNDS} rounds`
);

const shuffled = [...variants.variants].reverse();
check(
  'tier assignment is independent of input order',
  assignTiers(shuffled).every(
    (v) => v.tier === variants.variants.find((o) => o.id === v.id)!.tier
  )
);

check(
  'set_label distinguishes item buckets and names Megas',
  defaultSetLabel({is_mega: true, item: 'Charizardite Y'} as Variant) === 'Mega' &&
    defaultSetLabel({is_mega: false, item: 'Assault Vest'} as Variant) === 'Assault Vest' &&
    defaultSetLabel({is_mega: false, item: null} as Variant) === 'No item'
);

// ---------------------------------------------------------------------------
section('Team clauses');

const member = (
  label: string,
  species: string,
  item: string | null,
  is_mega = false
): TeamMemberRef => ({label, species, item, is_mega});

check(
  'a team with two Leftovers holders is rejected',
  validateTeam(
    [member('a', 'kingambit', 'leftovers'), member('b', 'garchomp', 'leftovers')],
    mb
  ).some((v) => v.clause === 'item'),
);

check(
  'the item clause ignores itemless members',
  validateTeam([member('a', 'kingambit', null), member('b', 'garchomp', null)], mb).every(
    (v) => v.clause !== 'item'
  )
);

check(
  'Heat Rotom and Wash Rotom collide under the species clause',
  validateTeam([member('a', 'rotomheat', 'leftovers'), member('b', 'rotomwash', 'sitrusberry')], mb).some(
    (v) => v.clause === 'species'
  ),
  `dex #${mb.national_dex.get('rotomheat')} / #${mb.national_dex.get('rotomwash')}`
);

check(
  'two different species do not collide',
  validateTeam([member('a', 'kingambit', 'leftovers'), member('b', 'garchomp', 'sitrusberry')], mb).length === 0
);

check(
  'a second Mega Evolution is rejected',
  validateTeam(
    [
      member('a', 'charizardmegay', 'charizarditey', true),
      member('b', 'garchompmega', 'garchompite', true),
    ],
    mb
  ).some((v) => v.clause === 'mega_limit')
);

check(
  'a seventh team member is rejected',
  validateTeam(
    Array.from({length: 7}, (_, i) => member(`p${i}`, `species${i}`, null)),
    {...mb, national_dex: undefined, legal_species: undefined}
  ).some((v) => v.clause === 'team_size')
);

check(
  'an illegal species is rejected',
  validateTeam([member('a', 'mewtwo', null)], mb).some((v) => v.clause === 'legality')
);

// ---------------------------------------------------------------------------
console.log(
  `\n${failures === 0 ? 'all checks passed' : `${failures} of ${checks} checks FAILED`}\n`
);
if (failures > 0) process.exit(1);

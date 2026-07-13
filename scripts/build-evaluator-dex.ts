/**
 * scripts/build-evaluator-dex.ts — produce data/evaluator-dex.json, the
 * trimmed Champions dex the team evaluator fetches at runtime
 * (SPEC-team-evaluator.md Phase 0).
 *
 * Sourcing rule: *existence* comes from the vendored @smogon/calc gen-0 dex
 * (the trimmed Champions roster the damage pipeline uses); *metadata* comes
 * from the vendored pokemon-showdown Champions mod (which carries the
 * structured effect fields — selfSwitch, sideCondition, secondaries, … — but
 * inherits the full gen-9 dex, so its `exists` flag is NOT Champions
 * existence). Where both know a value (base power), the calc wins and a
 * mismatch is warned.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import {Dex} from 'pokemon-showdown';
import {MEGA_STONES} from '@smogon/calc';
import {GEN, toID as calcToID} from '../lib/pokemon';
import {SIM_FORMAT} from '../lib/sim/engine';
import {toID} from '../lib/evaluator/dex';
import type {DexMove, DexSecondary, DexSpecies, EvaluatorDex} from '../lib/evaluator/dex';
import type {StatsTable, TypeName, VariantsData} from '../lib/types';

const OUT_PATH = path.join(__dirname, '..', 'data', 'evaluator-dex.json');
const VARIANTS_PATH = path.join(__dirname, '..', 'data', 'defender-variants.json');

const mod = Dex.forFormat(SIM_FORMAT);
const warnings: string[] = [];

function trimBoosts(boosts: Record<string, number> | null | undefined): Partial<StatsTable> | undefined {
  if (!boosts || Object.keys(boosts).length === 0) return undefined;
  return boosts as Partial<StatsTable>;
}

// --- species ---------------------------------------------------------------
const species: Record<string, DexSpecies> = {};
for (const s of GEN.species) {
  const id = toID(s.name);
  const msd = mod.species.get(s.name);
  let abilities: string[] = [];
  if (msd.exists) {
    abilities = [...new Set(Object.values(msd.abilities).filter((a): a is string => !!a))];
    const dropped = abilities.filter((a) => !GEN.abilities.get(calcToID(a)));
    if (dropped.length) {
      warnings.push(`species ${s.name}: ability slot(s) not in Champions dex: ${dropped.join(', ')}`);
      abilities = abilities.filter((a) => GEN.abilities.get(calcToID(a)));
    }
  } else {
    warnings.push(`species ${s.name}: no Showdown-mod entry; exporting without ability slots`);
  }
  species[id] = {
    name: s.name,
    types: s.types as TypeName[],
    baseStats: {...s.baseStats} as StatsTable,
    abilities,
    isMega: msd.exists ? !!msd.isMega : /-Mega\b|-Mega-/.test(s.name),
  };
}

// --- moves -----------------------------------------------------------------
const moves: Record<string, DexMove> = {};
for (const m of GEN.moves) {
  if (!m.name || m.name === '(No Move)') continue;
  const id = toID(m.name);
  const mmd = mod.moves.get(m.name);
  if (!mmd.exists) {
    warnings.push(`move ${m.name}: in Champions calc dex but not in Showdown mod; exporting minimal entry`);
    moves[id] = {
      name: m.name,
      type: (m.type ?? 'Normal') as TypeName,
      category: (m.category ?? 'Status') as DexMove['category'],
      basePower: m.basePower ?? 0,
      accuracy: true,
      priority: 0,
      critRatio: 1,
      target: 'normal',
    };
    continue;
  }

  // The calc's gen-0 entries can be stubs (Metal Claw carries only flags), so
  // the calc only wins where it actually has a value; showdown fills gaps.
  const calcBP = m.basePower;
  if (calcBP !== undefined && mmd.basePower !== calcBP) {
    warnings.push(`move ${m.name}: base power mismatch (calc ${calcBP}, showdown ${mmd.basePower}); using calc`);
  }
  const basePower = calcBP ?? mmd.basePower ?? 0;

  const secondaries: DexSecondary[] = (mmd.secondaries ?? []).map((sec) => {
    const out: DexSecondary = {chance: sec.chance ?? 100};
    if (sec.status) out.status = sec.status;
    if (sec.volatileStatus) out.volatileStatus = sec.volatileStatus;
    const target = trimBoosts(sec.boosts as Record<string, number> | undefined);
    if (target) out.boosts = target;
    const self = trimBoosts((sec.self as {boosts?: Record<string, number>} | undefined)?.boosts);
    if (self) out.selfBoosts = self;
    return out;
  });

  const entry: DexMove = {
    name: m.name,
    type: (m.type ?? mmd.type) as TypeName,
    category: (m.category ?? mmd.category) as DexMove['category'],
    basePower: basePower,
    accuracy: mmd.accuracy === true ? true : Number(mmd.accuracy),
    priority: mmd.priority,
    critRatio: mmd.critRatio ?? 1,
    target: mmd.target,
  };
  if (mmd.selfSwitch) entry.selfSwitch = mmd.selfSwitch as boolean | string;
  if (mmd.forceSwitch) entry.forceSwitch = true;
  if (mmd.sideCondition) entry.sideCondition = toID(String(mmd.sideCondition));
  if (mmd.pseudoWeather) entry.pseudoWeather = toID(String(mmd.pseudoWeather));
  if (mmd.weather) entry.weather = toID(String(mmd.weather));
  if ((mmd as {terrain?: string}).terrain) entry.terrain = toID(String((mmd as {terrain?: string}).terrain));
  if (mmd.volatileStatus) entry.volatileStatus = toID(String(mmd.volatileStatus));
  if (mmd.status) entry.status = String(mmd.status);
  const boosts = trimBoosts(mmd.boosts);
  if (boosts) entry.boosts = boosts;
  if (secondaries.length) entry.secondaries = secondaries;
  if (mmd.drain) entry.drain = mmd.drain as [number, number];
  if (mmd.heal) entry.heal = mmd.heal as [number, number];
  if (mmd.flags.heal) entry.healFlag = true;
  if (mmd.ohko) entry.ohko = true;
  if (mmd.hasCrashDamage) entry.hasCrashDamage = true;
  if (mmd.flags.wind) entry.windFlag = true;
  if (mmd.flags.charge) entry.chargeFlag = true;
  if (mmd.flags.recharge) entry.rechargeFlag = true;
  if (mmd.multihit) entry.multihit = mmd.multihit as number | [number, number];
  moves[id] = entry;
}

// --- abilities / items / natures --------------------------------------------
const abilities: Record<string, string> = {};
for (const a of GEN.abilities) abilities[toID(a.name)] = a.name;

const items: Record<string, string> = {};
for (const i of GEN.items) items[toID(i.name)] = i.name;

// Mega Stone mapping (Champions-legal stones + formes only), so the parser
// can resolve mega formes without importing @smogon/calc in the browser.
const megaStones: EvaluatorDex['megaStones'] = {};
for (const [stone, mapping] of Object.entries(MEGA_STONES as Record<string, Record<string, string>>)) {
  const stoneId = toID(stone);
  if (!(stoneId in items)) continue; // stone not in Champions
  const forSpecies: Record<string, string> = {};
  for (const [base, mega] of Object.entries(mapping)) {
    if (species[toID(mega)]) forSpecies[toID(base)] = species[toID(mega)].name;
  }
  if (Object.keys(forSpecies).length) megaStones[stoneId] = forSpecies;
}

const natures: EvaluatorDex['natures'] = {};
for (const n of GEN.natures) {
  natures[toID(n.name)] = {name: n.name, ...(n.plus ? {plus: n.plus} : {}), ...(n.minus ? {minus: n.minus} : {})};
}

// --- attacking-type enumeration ----------------------------------------------
const types = [...GEN.types].map((t) => t.name).filter((t) => t !== '???' && t !== 'Stellar') as TypeName[];

const dex: EvaluatorDex = {
  generated_at: new Date().toISOString(),
  types,
  species,
  moves,
  abilities,
  items,
  natures,
  megaStones,
};

// --- validation ---------------------------------------------------------------
const variants = JSON.parse(fs.readFileSync(VARIANTS_PATH, 'utf8')) as VariantsData;
const missing = variants.variants.filter((v) => !species[toID(v.species)]);
if (missing.length) {
  console.error(`FATAL: ${missing.length} defender-variant species missing from export:`);
  for (const v of missing) console.error(`  - ${v.species} (${v.id})`);
  process.exit(1);
}

const json = JSON.stringify(dex);
fs.writeFileSync(OUT_PATH, json);

for (const w of warnings) console.warn(`warn: ${w}`);
console.log(
  `evaluator-dex.json: ${Object.keys(species).length} species, ${Object.keys(moves).length} moves, ` +
  `${Object.keys(abilities).length} abilities, ${Object.keys(items).length} items, ` +
  `${Object.keys(natures).length} natures, ${types.length} types`,
);
console.log(
  `size: ${(json.length / 1024).toFixed(0)} KB raw, ` +
  `${(zlib.gzipSync(json).length / 1024).toFixed(0)} KB gzipped; ${warnings.length} warnings`,
);
console.log(`all ${variants.variants.length} defender-variant species resolve ✓`);

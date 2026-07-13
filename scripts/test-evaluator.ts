/**
 * scripts/test-evaluator.ts — unit checks for the team evaluator
 * (SPEC-team-evaluator.md; BACKLOG item 08). Fast and pure; part of
 * `npm test` and CI. Sections are appended phase by phase.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {getMove, getSpecies, toID} from '../lib/evaluator/dex';
import type {EvaluatorDex} from '../lib/evaluator/dex';
import type {VariantsData} from '../lib/types';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const dataDir = path.join(__dirname, '..', 'data');
const dex = JSON.parse(fs.readFileSync(path.join(dataDir, 'evaluator-dex.json'), 'utf8')) as EvaluatorDex;
const variants = JSON.parse(fs.readFileSync(path.join(dataDir, 'defender-variants.json'), 'utf8')) as VariantsData;

// ---------------------------------------------------------------------------
console.log('Phase 0: evaluator dex export');
// ---------------------------------------------------------------------------

{
  const missing = variants.variants.filter((v) => !getSpecies(dex, v.species));
  check('every defender-variant species resolves in the export',
    missing.length === 0, missing.map((v) => v.species).join(', '));

  const rockSlide = getMove(dex, 'Rock Slide')!;
  check('Rock Slide: accuracy 90', rockSlide.accuracy === 90);
  check('Rock Slide: 30% flinch secondary',
    rockSlide.secondaries?.length === 1 &&
    rockSlide.secondaries[0].chance === 30 &&
    rockSlide.secondaries[0].volatileStatus === 'flinch');

  const icyWind = getMove(dex, 'Icy Wind')!;
  check('Icy Wind: 100% spe −1 secondary on the target',
    icyWind.secondaries?.[0]?.chance === 100 &&
    icyWind.secondaries?.[0]?.boosts?.spe === -1 &&
    icyWind.secondaries?.[0]?.selfBoosts === undefined);

  check('U-turn has selfSwitch', getMove(dex, 'U-turn')?.selfSwitch === true);
  check('Tailwind has sideCondition', getMove(dex, 'Tailwind')?.sideCondition === 'tailwind');
  check('Trick Room has pseudoWeather', getMove(dex, 'Trick Room')?.pseudoWeather === 'trickroom');
  check('Roar has forceSwitch', getMove(dex, 'Roar')?.forceSwitch === true);

  check('Grav Apple carries the Champions 90 BP', getMove(dex, 'Grav Apple')?.basePower === 90);
  check('Metal Claw stub entry backfilled from the Showdown mod',
    getMove(dex, 'Metal Claw')?.basePower === 50 && getMove(dex, 'Metal Claw')?.type === 'Steel');

  check('Fake Out: priority 3 with 100% flinch',
    getMove(dex, 'Fake Out')?.priority === 3 &&
    getMove(dex, 'Fake Out')?.secondaries?.[0]?.chance === 100);
  check('Power-Up Punch secondary lands on selfBoosts, not boosts',
    getMove(dex, 'Power-Up Punch') === undefined ||
    (getMove(dex, 'Power-Up Punch')!.secondaries?.[0]?.selfBoosts?.atk === 1 &&
     getMove(dex, 'Power-Up Punch')!.secondaries?.[0]?.boosts === undefined));

  check('Recover has heal data', !!getMove(dex, 'Recover')?.heal || !!getMove(dex, 'Recover')?.healFlag);
  check('Giga Drain has drain data', getMove(dex, 'Giga Drain')?.drain?.[0] === 1);

  const garchomp = getSpecies(dex, 'Garchomp')!;
  check('Garchomp: Dragon/Ground, 108 base HP, Rough Skin slot',
    garchomp.types[0] === 'Dragon' && garchomp.types[1] === 'Ground' &&
    garchomp.baseStats.hp === 108 && garchomp.abilities.includes('Rough Skin'));
  check('Charizard-Mega-Y flagged as mega', getSpecies(dex, 'Charizard-Mega-Y')?.isMega === true);

  check('type enumeration has no ???', dex.types.length === 18 && !dex.types.includes('???' as never));

  // Expected Champions dex gaps (spec "Format scope"). If one of these starts
  // resolving, the dex gap closed — update the spec and curated tables.
  const expectedMissingMoves = ['Teleport', 'Heal Block', 'Splintered Stormshards', 'Jungle Healing'];
  const expectedMissingAbilities = ['Serene Grace', 'Dazzling', 'Air Lock', 'Storm Drain', 'Well-Baked Body', 'Wonder Guard', 'Grassy Surge'];
  const expectedMissingItems = ['Black Sludge'];
  for (const name of expectedMissingMoves) {
    check(`expected dex gap still holds: move ${name}`, !getMove(dex, name));
  }
  for (const name of expectedMissingAbilities) {
    check(`expected dex gap still holds: ability ${name}`, !(toID(name) in dex.abilities));
  }
  for (const name of expectedMissingItems) {
    check(`expected dex gap still holds: item ${name}`, !(toID(name) in dex.items));
  }
  check('Lightning Rod IS in the Champions dex (D36)', toID('Lightning Rod') in dex.abilities);
}

// ---------------------------------------------------------------------------
console.log('\nPhase 1: paste parsing');
// ---------------------------------------------------------------------------

{
  const {parseTeam, exportTeam, encodeTeam, decodeTeam} = require('../lib/evaluator/parse') as typeof import('../lib/evaluator/parse');
  const {Teams} = require('pokemon-showdown') as typeof import('pokemon-showdown');
  const {evsToSps} = require('../lib/sp') as typeof import('../lib/sp');

  const FIXTURE = `
Garchomp @ Life Orb
Ability: Rough Skin
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Protect

Chompy (Kingambit) (M) @ Black Glasses
Ability: Defiant
Level: 50
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Sucker Punch
- Kowtow Cleave
- Iron Head
- Swords Dance

Incineroar
Ability: Intimidate
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Parting Shot

Charizard @ Charizardite Y
Ability: Blaze
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Heat Wave
- Solar Beam
- Overheat
- Protect

Rotom-Wash @ Sitrus Berry
Ability: Levitate
EVs: 252 HP / 252 SpA
Modest Nature
- Hydro Pump
- Thunderbolt
- Will-O-Wisp
- Protect

Sylveon
Ability: Pixilate
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
- Hyper Voice
- Moonblast
- Calm Mind
- Protect
`;

  const team = parseTeam(FIXTURE, dex);
  check('fixture parses 6 sets, 0 failures',
    team.sets.length === 6 && team.failures.length === 0,
    team.failures.map((f) => f.message).join('; '));

  // Parity with the vendored Teams.import (the semantics oracle).
  const oracle = Teams.import(FIXTURE)!;
  let parityOk = true;
  const parityDetails: string[] = [];
  for (let i = 0; i < oracle.length; i++) {
    const o = oracle[i];
    const s = team.sets[i];
    const same = (a: string, b: string) => toID(a) === toID(b);
    if (!same(o.species, s.species)) { parityOk = false; parityDetails.push(`set ${i} species ${o.species}≠${s.species}`); }
    if (toID(o.item ?? '') !== toID(s.item ?? '')) { parityOk = false; parityDetails.push(`set ${i} item ${o.item}≠${s.item}`); }
    // Documented divergence: Mega sets take the Mega forme's ability
    // (mirroring the variant builder), so skip the oracle there.
    if (!s.isMega && !same(o.ability, s.ability)) { parityOk = false; parityDetails.push(`set ${i} ability`); }
    if (!same(o.nature, s.nature)) { parityOk = false; parityDetails.push(`set ${i} nature`); }
    const oSps = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...evsToSps(o.evs)};
    if (JSON.stringify(oSps) !== JSON.stringify(s.sps)) { parityOk = false; parityDetails.push(`set ${i} sps ${JSON.stringify(oSps)}≠${JSON.stringify(s.sps)}`); }
    if (o.moves.length !== s.moves.length || !o.moves.every((m, j) => same(m, s.moves[j]))) {
      parityOk = false; parityDetails.push(`set ${i} moves`);
    }
  }
  check('field parity with vendored Teams.import on the fixture', parityOk, parityDetails.join('; '));
  check('EV 4 special case converts to SP 1', team.sets[0].sps.hp === 1);
  check('nickname + gender stripped (Kingambit)', team.sets[1].species === 'Kingambit');
  check('itemless set parses (Incineroar)', team.sets[2].item === null);
  check('3-move set keeps 3 moves', team.sets[2].moves.length === 3);
  check('mega stone resolves battle forme',
    team.sets[3].species === 'Charizard' && team.sets[3].battleSpecies === 'Charizard-Mega-Y' && team.sets[3].isMega);

  // Round-trip: parse(export(team)) reproduces every battle-relevant field.
  const reparsed = parseTeam(exportTeam(team.sets), dex);
  check('parse(export(team)) round-trips',
    JSON.stringify(reparsed.sets) === JSON.stringify(team.sets));

  // URL round-trip.
  const decoded = decodeTeam(encodeTeam(team.sets), dex);
  check('encode/decode ?team= round-trips',
    JSON.stringify(decoded.sets) === JSON.stringify(team.sets));
  check('?team= stays URL-sized', encodeTeam(team.sets).length < 1500,
    `${encodeTeam(team.sets).length} chars`);

  // Unknown species → failure entry, others survive. (Replace a block rather
  // than appending a 7th — the parser caps teams at 6 blocks.)
  const withBad = parseTeam(FIXTURE.replace('Sylveon\n', 'Missingno\n'), dex);
  check('unknown species yields 5 sets + 1 failure',
    withBad.sets.length === 5 && withBad.failures.length === 1 &&
    withBad.failures[0].message.includes('Missingno'));

  // Unknown move degrades that move only, with a warning.
  const badMove = parseTeam('Garchomp\nAbility: Rough Skin\nJolly Nature\n- Earthquake\n- Splintered Stormshards', dex);
  check('unknown move excluded with warning, set survives',
    badMove.sets[0].moves.length === 1 &&
    badMove.sets[0].invalidMoves.length === 1 &&
    badMove.sets[0].warnings.some((w) => w.includes('Splintered Stormshards')));
}

// ---------------------------------------------------------------------------
console.log('\nPhase 2: type matchup matrices');
// ---------------------------------------------------------------------------

{
  const {parseTeam} = require('../lib/evaluator/parse') as typeof import('../lib/evaluator/parse');
  const {defensiveMatrix, offensiveMatrix, droppedTypeAbilityMods, bucketOf} =
    require('../lib/evaluator/typechart') as typeof import('../lib/evaluator/typechart');

  const team = parseTeam(`
Garchomp @ Life Orb
Ability: Rough Skin
Jolly Nature
- Earthquake
- Ice Beam

Rotom-Wash
Ability: Levitate
Modest Nature
- Hydro Pump

Snorlax
Ability: Thick Fat
Adamant Nature
- Body Slam

Gengar
Ability: Cursed Body
Timid Nature
- Shadow Ball
`, dex);
  check('type fixture parses 4 sets', team.sets.length === 4 && team.failures.length === 0,
    team.failures.map((f) => f.message).join('; '));

  const def = defensiveMatrix(dex, team.sets);
  const row = (t: string) => def.cells[def.types.indexOf(t as never)];
  check('Garchomp: Ice 4×, Electric 0×, Fire 0.5×',
    row('Ice')[0].effective === 4 && row('Electric')[0].effective === 0 && row('Fire')[0].effective === 0.5);
  check('Rotom-Wash + Levitate: Ground effective 0, raw 2, marked modified',
    row('Ground')[1].effective === 0 && row('Ground')[1].raw === 2 && row('Ground')[1].modified &&
    (row('Ground')[1].note ?? '').includes('Levitate'));
  check('Thick Fat Snorlax: Ice and Fire 1 → 0.5, marked',
    row('Ice')[2].effective === 0.5 && row('Ice')[2].raw === 1 && row('Ice')[2].modified &&
    row('Fire')[2].effective === 0.5);
  check('unmodified cells not marked', row('Water')[0].modified === false);
  check('Ground-row summary counts Rotom-Wash as immune',
    def.summary[def.types.indexOf('Ground' as never)].immune === 1);

  const off = offensiveMatrix(dex, team.sets);
  const orow = (t: string) => off.cells[off.types.indexOf(t as never)];
  check('offense: EQ covers Steel 2×, Ice Beam covers Flying 2×',
    orow('Steel')[0].best === 2 && orow('Steel')[0].bestMove === 'Earthquake' &&
    orow('Flying')[0].best === 2 && orow('Flying')[0].bestMove === 'Ice Beam');
  check('Normal-only attacker (Body Slam Snorlax): Ghost row 0× without Scrappy',
    orow('Ghost')[2].best === 0);
  check('Ghost-only attacker (Shadow Ball Gengar): Normal row 0×', orow('Normal')[3].best === 0);

  const scrappyTeam = parseTeam('Snorlax\nAbility: Thick Fat\n- Body Slam', dex);
  scrappyTeam.sets[0].ability = 'Scrappy'; // force for the rule test
  const offScrappy = offensiveMatrix(dex, scrappyTeam.sets);
  check('Scrappy turns the Ghost 0× into 1×, flagged',
    offScrappy.cells[offScrappy.types.indexOf('Ghost' as never)][0].best === 1 &&
    offScrappy.cells[offScrappy.types.indexOf('Ghost' as never)][0].scrappy === true);

  check('ability-table drops are exactly the expected dex gaps',
    JSON.stringify(droppedTypeAbilityMods(dex).sort()) === JSON.stringify(['Storm Drain', 'Well-Baked Body']),
    droppedTypeAbilityMods(dex).join(', '));
  check('Dry Skin fire ×1.25 buckets to 1 for display', bucketOf(1.25) === 1);
}

// ---------------------------------------------------------------------------
console.log('\nPhase 4: board control inventory');
// ---------------------------------------------------------------------------

{
  const {parseTeam} = require('../lib/evaluator/parse') as typeof import('../lib/evaluator/parse');
  const {boardControl, validateCurated, EXPECTED_CURATED_DROPS} =
    require('../lib/evaluator/tags') as typeof import('../lib/evaluator/tags');

  // Spec fixture: Tailwind + Fake Out + Icy Wind + Follow Me + U-turn +
  // Will-O-Wisp + Encore + Aqua Jet + Protect + Recover + Leftovers holder.
  // (Moves are not learnset-checked in v1; rule coverage is what matters.)
  const team = parseTeam(`
Whimsicott @ Focus Sash
Ability: Prankster
Timid Nature
- Tailwind
- Encore
- Moonblast
- Icy Wind

Incineroar
Ability: Intimidate
Careful Nature
- Fake Out
- U-turn
- Flare Blitz
- Will-O-Wisp

Sylveon
Ability: Pixilate
Modest Nature
- Follow Me
- Hyper Voice
- Recover
- Protect

Azumarill @ Leftovers
Ability: Huge Power
Adamant Nature
- Aqua Jet
- Play Rough
- Belly Drum
- Protect
`, dex);
  check('board fixture parses 4 sets', team.sets.length === 4 && team.failures.length === 0,
    team.failures.map((f) => f.message).join('; '));

  const inv = boardControl(dex, team.sets);
  const cat = (id: string) => inv.find((c) => c.id === id)!;
  const names = (id: string, member: number) => cat(id).perMember[member].map((t) => t.name);

  // Whimsicott (member 0)
  check('Tailwind + Icy Wind + paralysis-free speed control on Whimsicott',
    names('speed', 0).includes('Tailwind') && names('speed', 0).includes('Icy Wind'));
  check('Prankster produces no speed-control entry (D36)',
    !names('speed', 0).includes('Prankster'));
  check('Encore lands in option control', names('option', 0).includes('Encore'));
  check('Grass typing gets ignores-redirection note',
    cat('targeting').perMember[0].some((t) => t.kind === 'typing' && t.subGroup === 'ignores redirection'));

  // Incineroar (member 1)
  check('Fake Out is targeting control only (D36)',
    names('targeting', 1).includes('Fake Out') &&
    !names('priority', 1).includes('Fake Out') && !names('speed', 1).includes('Fake Out'));
  check('U-turn under pivoting; Will-O-Wisp under mitigation burn',
    names('pivoting', 1).includes('U-turn') && names('mitigation', 1).includes('Will-O-Wisp'));
  check('Intimidate under mitigation abilities', names('mitigation', 1).includes('Intimidate'));

  // Sylveon (member 2)
  check('Follow Me under targeting; Recover under healing recovery',
    names('targeting', 2).includes('Follow Me') && names('healing', 2).includes('Recover'));
  check('Protect in Protect-moves category, absent from mitigation',
    names('protect', 2).includes('Protect') && !names('mitigation', 2).includes('Protect'));

  // Azumarill (member 3)
  check('Aqua Jet lands in priority', names('priority', 3).includes('Aqua Jet'));
  check('Leftovers under healing items',
    cat('healing').perMember[3].some((t) => t.kind === 'item' && t.name === 'Leftovers'));
  check('members without a Protect-class move have empty protect cells (→ "no Protect" marker)',
    cat('protect').perMember[0].length === 0 && cat('protect').perMember[1].length === 0);

  // Regenerator: healing, not pivoting.
  const regen = parseTeam('Amoonguss\nAbility: Regenerator\n- Pollen Puff', dex);
  if (regen.sets.length) {
    const rInv = boardControl(dex, regen.sets);
    check('Regenerator under healing, not pivoting (D36)',
      rInv.find((c) => c.id === 'healing')!.perMember[0].some((t) => t.name === 'Regenerator') &&
      rInv.find((c) => c.id === 'pivoting')!.perMember[0].length === 0);
  } else {
    // Amoonguss is off-dex in Champions; use any Regenerator holder instead.
    const alt = parseTeam('Slowking\nAbility: Regenerator\n- Scald', dex);
    check('Regenerator under healing, not pivoting (D36) [Slowking]',
      alt.sets.length === 1 &&
      boardControl(dex, alt.sets).find((c) => c.id === 'healing')!.perMember[0].some((t) => t.name === 'Regenerator') &&
      boardControl(dex, alt.sets).find((c) => c.id === 'pivoting')!.perMember[0].length === 0);
  }

  // Wide Guard: option control only.
  const wg = parseTeam('Pelipper\nAbility: Drizzle\n- Wide Guard\n- Protect', dex);
  const wgInv = boardControl(dex, wg.sets);
  check('Wide Guard in option control only, not mitigation or protect',
    wgInv.find((c) => c.id === 'option')!.perMember[0].some((t) => t.name === 'Wide Guard') &&
    !wgInv.find((c) => c.id === 'mitigation')!.perMember[0].some((t) => t.name === 'Wide Guard') &&
    !wgInv.find((c) => c.id === 'protect')!.perMember[0].some((t) => t.name === 'Wide Guard'));

  // Conditional dimming: Grassy Glide dims without a Grassy Terrain provider,
  // un-dims with one; Chlorophyll likewise with Drought.
  const glide = parseTeam('Venusaur\nAbility: Overgrow\n- Grassy Glide', dex);
  const glideInv = boardControl(dex, glide.sets);
  const glideTag = glideInv.find((c) => c.id === 'priority')!.perMember[0].find((t) => t.name === 'Grassy Glide');
  check('Grassy Glide is a curated conditional entry (priority 0 in Champions data)',
    !!glideTag && glideTag.dimmed === true && (glideTag.annotation ?? '').includes('Grassy Terrain'));

  const glideWithTerrain = parseTeam(
    'Venusaur\nAbility: Overgrow\n- Grassy Glide\n\nSylveon\nAbility: Cute Charm\n- Grassy Terrain', dex);
  const gwtInv = boardControl(dex, glideWithTerrain.sets);
  check('Grassy Glide un-dims when a member provides Grassy Terrain',
    gwtInv.find((c) => c.id === 'priority')!.perMember[0].find((t) => t.name === 'Grassy Glide')!.dimmed === false);
  check('Grassy Terrain provider double-lists: terrain control + healing field',
    gwtInv.find((c) => c.id === 'terrain')!.perMember[1].some((t) => t.name === 'Grassy Terrain') &&
    gwtInv.find((c) => c.id === 'healing')!.perMember[1].some((t) => t.name === 'Grassy Terrain' && t.subGroup === 'field'));

  const chloro = parseTeam('Venusaur\nAbility: Chlorophyll\n- Giga Drain', dex);
  const chloroInv = boardControl(dex, chloro.sets);
  check('Chlorophyll dimmed without sun',
    chloroInv.find((c) => c.id === 'speed')!.perMember[0].find((t) => t.name === 'Chlorophyll')?.dimmed === true);
  const chloroSun = parseTeam('Venusaur\nAbility: Chlorophyll\n- Giga Drain\n\nCharizard\nAbility: Drought\n- Heat Wave', dex);
  const chloroSunInv = boardControl(dex, chloroSun.sets);
  check('Chlorophyll un-dims with a Drought member',
    chloroSunInv.find((c) => c.id === 'speed')!.perMember[0].find((t) => t.name === 'Chlorophyll')?.dimmed === false);
  check('Giga Drain under healing drain sub-group',
    chloroInv.find((c) => c.id === 'healing')!.perMember[0].some((t) => t.name === 'Giga Drain' && t.subGroup === 'drain'));

  // Taxonomy-rot gate: curated drops match the expected list in both directions.
  const drops = validateCurated(dex);
  check('taxonomy-rot gate: curated drops match EXPECTED_CURATED_DROPS exactly',
    JSON.stringify(drops) === JSON.stringify([...EXPECTED_CURATED_DROPS].sort()),
    `actual: ${drops.join(', ')}`);
}

// ---------------------------------------------------------------------------
console.log('\nPhase 5: RNG exposure');
// ---------------------------------------------------------------------------

{
  const {parseTeam} = require('../lib/evaluator/parse') as typeof import('../lib/evaluator/parse');
  const {rngExposure, noFavorableRng, validateRngCurated, RNG_EXPECTED_DROPS} =
    require('../lib/evaluator/rng') as typeof import('../lib/evaluator/rng');

  const team = parseTeam(`
Garchomp
Ability: Rough Skin
- Rock Slide
- Stone Edge
- Outrage

Pelipper
Ability: Drizzle
- Hurricane
- Hydro Pump

Machamp
Ability: No Guard
- Dynamic Punch
- High Jump Kick

Venusaur
Ability: Chlorophyll
- Sleep Powder
- Giga Drain
`, dex);
  check('rng fixture parses 4 sets', team.sets.length === 4 && team.failures.length === 0,
    team.failures.map((f) => f.message).join('; '));

  const rng = rngExposure(dex, team.sets);
  const has = (arr: Array<{source: string; memberIndex: number}>, source: string, member: number) =>
    arr.some((e) => e.source === source && e.memberIndex === member);

  check('Rock Slide: favorable 30% flinch AND unfavorable 90–99 acc bucket',
    has(rng.favorable.secondaries, 'Rock Slide', 0) &&
    has(rng.unfavorable.acc90to99, 'Rock Slide', 0));
  check('Stone Edge: high crit + 80–89 acc bucket',
    has(rng.favorable.crits, 'Stone Edge', 0) && has(rng.unfavorable.acc80to89, 'Stone Edge', 0));
  check('Outrage: self-lock entry', has(rng.unfavorable.selfLock, 'Outrage', 0));
  check('Hurricane: <80 bucket with its 30% confusion favorable',
    has(rng.unfavorable.accUnder80, 'Hurricane', 1) && has(rng.favorable.secondaries, 'Hurricane', 1));
  check('No Guard exempts Dynamic Punch + HJK from accuracy buckets, with a note',
    !has(rng.unfavorable.accUnder80, 'Dynamic Punch', 2) &&
    !has(rng.unfavorable.acc90to99, 'High Jump Kick', 2) &&
    rng.notes.some((n) => n.includes('No Guard')));
  check('HJK still listed under crash risk', has(rng.unfavorable.crash, 'High Jump Kick', 2));
  check('Sleep Powder: favorable sleep with acc annotation + unfavorable <80',
    has(rng.favorable.sleep, 'Sleep Powder', 3) && has(rng.unfavorable.accUnder80, 'Sleep Powder', 3));

  // Sheer Force strikes wanted secondaries.
  const sheer = parseTeam('Nidoking\nAbility: Sheer Force\n- Sludge Bomb', dex);
  if (sheer.sets.length === 1) {
    const sheerRng = rngExposure(dex, sheer.sets);
    check('Sheer Force: Sludge Bomb secondary struck through + note',
      sheerRng.favorable.secondaries.some((e) => e.source === 'Sludge Bomb' && e.struck) &&
      sheerRng.notes.some((n) => n.includes('Sheer Force')));
  } else {
    const alt = parseTeam('Tauros\nAbility: Sheer Force\n- Rock Slide', dex);
    check('Sheer Force strikes secondaries [fallback species]',
      alt.sets.length === 1 &&
      rngExposure(dex, alt.sets).favorable.secondaries.some((e) => e.source === 'Rock Slide' && e.struck));
  }

  // No proactive upside → explicit callout state.
  const flat = parseTeam('Snorlax\nAbility: Thick Fat\n- Body Slam\n- Protect', dex);
  // Body Slam has a 30% paralysis secondary, so this team DOES have upside…
  check('Body Slam team has favorable RNG', !noFavorableRng(rngExposure(dex, flat.sets)));
  const none = parseTeam('Snorlax\nAbility: Thick Fat\n- Facade\n- Protect', dex);
  check('Facade-only team triggers the no-proactive-RNG callout',
    noFavorableRng(rngExposure(dex, none.sets)));

  check('RNG curated drops match expected list',
    JSON.stringify(validateRngCurated(dex)) === JSON.stringify([...RNG_EXPECTED_DROPS].sort()),
    validateRngCurated(dex).join(', '));
}

// ---------------------------------------------------------------------------
console.log('\nPhase 3: relevant BST');
// ---------------------------------------------------------------------------

{
  const {parseTeam} = require('../lib/evaluator/parse') as typeof import('../lib/evaluator/parse');
  const {relevantBst, isUtilityAttack} = require('../lib/evaluator/bst') as typeof import('../lib/evaluator/bst');

  const bstOf = (name: string) => {
    const s = getSpecies(dex, name)!;
    return s.baseStats.hp + s.baseStats.atk + s.baseStats.def + s.baseStats.spa + s.baseStats.spd + s.baseStats.spe;
  };

  const team = parseTeam(`
Sylveon
Ability: Pixilate
- Hyper Voice
- Moonblast
- Shadow Ball
- Protect

Snorlax
Ability: Thick Fat
- Body Press
- Curse
- Rest

Incineroar
Ability: Intimidate
- Fake Out
- Parting Shot
- Snarl

Garchomp
Ability: Rough Skin
- Earthquake
- Trick Room
`, dex);
  check('bst fixture parses 4 sets', team.sets.length === 4 && team.failures.length === 0,
    team.failures.map((f) => f.message).join('; '));

  const report = relevantBst(dex, team.sets);
  const sylveon = report.members[0];
  check('special attacker: Atk struck, total = BST − base Atk',
    !sylveon.perStat.atk.included &&
    sylveon.totalWithSpeed === bstOf('Sylveon') - getSpecies(dex, 'Sylveon')!.baseStats.atk);

  const snorlax = report.members[1];
  check('Body-Press-only set: Atk still struck, Def double-duty note',
    !snorlax.perStat.atk.included &&
    snorlax.notes.some((n) => n.includes('Body Press')));

  const incin = report.members[2];
  check('Fake Out + Snarl only: both attack stats struck with utility notes',
    !incin.perStat.atk.included && (incin.perStat.atk.note ?? '').includes('Fake Out') &&
    !incin.perStat.spa.included && (incin.perStat.spa.note ?? '').includes('Snarl'));

  const withKnockOff = parseTeam('Incineroar\nAbility: Intimidate\n- Fake Out\n- Knock Off', dex);
  const koReport = relevantBst(dex, withKnockOff.sets);
  check('adding a real attack (Knock Off) restores Atk',
    koReport.members[0].perStat.atk.included);

  check('Trick Room setter triggers the dual average',
    report.hasTrickRoomSetter &&
    report.averageWithSpeed > report.averageWithoutSpeed);
  const noTr = relevantBst(dex, team.sets.slice(0, 3));
  check('no Trick Room setter → single average flag', noTr.hasTrickRoomSetter === false);

  // Worked-example semantics: withSpeed − withoutSpeed = base Speed, per member.
  check('speedless total drops exactly base Speed',
    report.members.every((m, i) =>
      m.totalWithSpeed - m.totalWithoutSpeed === getSpecies(dex, team.sets[i].battleSpecies)!.baseStats.spe));

  // Average = mean of member totals.
  const mean = report.members.reduce((a, m) => a + m.totalWithSpeed, 0) / report.members.length;
  check('team average is the mean of member totals', Math.abs(report.averageWithSpeed - mean) < 1e-9);

  check('isUtilityAttack: Fake Out yes, Aqua Jet no, Icy Wind yes, Knock Off no',
    isUtilityAttack(getMove(dex, 'Fake Out')!) &&
    !isUtilityAttack(getMove(dex, 'Aqua Jet')!) &&
    isUtilityAttack(getMove(dex, 'Icy Wind')!) &&
    !isUtilityAttack(getMove(dex, 'Knock Off')!));
}

// ---------------------------------------------------------------------------
console.log('\nPhase 6: damage sources by type');
// ---------------------------------------------------------------------------

{
  const {parseTeam} = require('../lib/evaluator/parse') as typeof import('../lib/evaluator/parse');
  const {teamDamageSources} = require('../lib/evaluator/damage') as typeof import('../lib/evaluator/damage');
  const {calculate} = require('../lib/calc') as typeof import('../lib/calc');
  const {STANDARD_TARGET} = require('../lib/variants') as typeof import('../lib/variants');

  const team = parseTeam(`
Garchomp @ Life Orb
Ability: Rough Skin
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Protect

Charizard @ Charizardite Y
Ability: Blaze
EVs: 252 SpA / 252 Spe
Timid Nature
- Heat Wave
- Weather Ball
- Solar Beam
- Protect
`, dex);
  check('damage fixture parses 2 sets', team.sets.length === 2 && team.failures.length === 0);

  const ds = teamDamageSources(team.sets);
  check('shares sum to 1', Math.abs(ds.viz.cells.reduce((a, c) => a + c.share, 0) - 1) < 1e-9);
  check('Protect skipped as status, listed in skipped',
    ds.skipped.some((s) => s.move === 'Protect' && s.reason.includes('status')));

  // Oracle: Earthquake expected = direct lib/calc result × 1.5 (spread).
  const eq = calculate(
    {species: 'Garchomp', ability: 'Rough Skin', item: 'Life Orb', nature: 'Jolly', sps: team.sets[0].sps},
    STANDARD_TARGET, {name: 'Earthquake'}, {isDoubles: true, weather: null},
  );
  const eqEntry = ds.viz.cells.find((c) => c.type === 'Ground')!.contributors.find((c) => c.move === 'Earthquake')!;
  check('oracle: Earthquake expected = calc avg × 1.5 spread',
    Math.abs(eqEntry.expected_damage - eq.avg * 1.5) < 1e-9,
    `${eqEntry.expected_damage} vs ${eq.avg * 1.5}`);

  // Mega Charizard Y auto-weather: Weather Ball resolves as Fire under Sun,
  // and Heat Wave computes in Sun (parity with viz 1's field rule).
  const zardCells = ds.viz.cells.filter((c) => c.contributors.some((x) => x.species === 'Charizard-Mega-Y'));
  check('mega forme used as attacker', zardCells.length > 0);
  const wb = ds.viz.cells.find((c) => c.contributors.some((x) => x.move === 'Weather Ball'));
  check('Weather Ball aggregates as Fire under Drought sun', wb?.type === 'Fire');
  const hw = calculate(
    {species: 'Charizard-Mega-Y', ability: 'Drought', item: null, nature: 'Timid', sps: team.sets[1].sps},
    STANDARD_TARGET, {name: 'Heat Wave'}, {isDoubles: true, weather: 'Sun'},
  );
  const hwEntry = ds.viz.cells.find((c) => c.type === 'Fire')!.contributors.find((c) => c.move === 'Heat Wave')!;
  check('Heat Wave computed under auto-sun', Math.abs(hwEntry.expected_damage - hw.avg * 1.5) < 1e-9,
    `${hwEntry.expected_damage} vs ${hw.avg * 1.5}`);

  check('no damaging moves → empty cells, no crash',
    teamDamageSources(parseTeam('Sylveon\nAbility: Pixilate\n- Protect', dex).sets).viz.cells.length === 0);
}

// ---------------------------------------------------------------------------
console.log('\nPhase 7: variant matching');
// ---------------------------------------------------------------------------

{
  const {parseTeam} = require('../lib/evaluator/parse') as typeof import('../lib/evaluator/parse');
  const {matchVariant} = require('../lib/evaluator/match') as typeof import('../lib/evaluator/match');
  const {pickMoves} = require('../lib/sim/sets') as typeof import('../lib/sim/sets');
  const {canonicalSpec} = require('../lib/variant-cid') as typeof import('../lib/variant-cid');
  const all = variants.variants;

  const chompVariant = all.find((v) => v.id === 'garchomp_life_orb')!;
  const modalMoves = pickMoves(chompVariant);
  const modalSps = chompVariant.sps;
  const evLine = (['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const)
    .filter((s) => (modalSps[s] ?? 0) > 0)
    .map((s) => `${modalSps[s]! * 8} ${({hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe'})[s]}`)
    .join(' / ');

  // Exact replica of the variant's resolved battle set → exact match, no badge.
  const exact = parseTeam(
    `Garchomp @ ${chompVariant.item}\nAbility: ${chompVariant.ability}\nEVs: ${evLine}\n${chompVariant.nature} Nature\n` +
    modalMoves.map((m) => `- ${m}`).join('\n'), dex);
  const exactMatch = matchVariant(exact.sets[0], all);
  check('modal Garchomp matches garchomp_life_orb exactly (no badge)',
    exactMatch.variantId === 'garchomp_life_orb' && exactMatch.exact,
    exactMatch.differences.join('; '));

  // Cross-check exactness against the cid machinery (item 02): the fields we
  // compare are the fields canonicalSpec hashes.
  const spec = canonicalSpec(chompVariant);
  check('exactness fields cover canonicalSpec fields',
    spec.moves.length === exact.sets[0].moves.length &&
    toID(spec.ability) === toID(exact.sets[0].ability) &&
    toID(spec.nature) === toID(exact.sets[0].nature));

  // Same variant, different moves → matched with badge.
  const diffMoves = parseTeam(
    `Garchomp @ Life Orb\nAbility: Rough Skin\nEVs: ${evLine}\n${chompVariant.nature} Nature\n- Earthquake\n- Swords Dance\n- Protect\n- Dragon Claw`, dex);
  const diffMatch = matchVariant(diffMoves.sets[0], all);
  check('modal Garchomp with different moves matches with badge',
    diffMatch.variantId === 'garchomp_life_orb' && !diffMatch.exact &&
    diffMatch.differences.some((d) => d.startsWith('moves')));

  // Defensive item (no variant) → aggregate/no-item bucket with badge.
  const lefties = parseTeam('Garchomp @ Leftovers\nAbility: Rough Skin\n- Earthquake', dex);
  const leftMatch = matchVariant(lefties.sets[0], all);
  const chompAggregate = all.find((v) => toID(v.species) === 'garchomp' && v.item === null);
  check('Leftovers Garchomp falls to the aggregate variant with an item badge',
    leftMatch.variantId === (chompAggregate?.id ?? null) && !leftMatch.exact &&
    leftMatch.differences.some((d) => d.startsWith('item')),
    `matched ${leftMatch.variantId}`);

  // Mega: battleSpecies keys the mega variant.
  const mega = parseTeam('Charizard @ Charizardite Y\nAbility: Blaze\n- Heat Wave', dex);
  const megaMatch = matchVariant(mega.sets[0], all);
  check('Charizardite Y set matches the charizard_mega_y variant',
    megaMatch.variantId === 'charizard_mega_y', `matched ${megaMatch.variantId}`);

  // Species with no variant at all → unmatched.
  const offMeta = all.some((v) => toID(v.species) === 'machamp')
    ? null
    : matchVariant(parseTeam('Machamp\nAbility: No Guard\n- Close Combat', dex).sets[0], all);
  check('off-meta species is unmatched (item 05 note)',
    offMeta !== null && offMeta.variantId === null);
}

// ---------------------------------------------------------------------------
console.log('\nSuite-level: example team end-to-end');
// ---------------------------------------------------------------------------

{
  const {parseTeam} = require('../lib/evaluator/parse') as typeof import('../lib/evaluator/parse');
  const {defensiveMatrix, offensiveMatrix} = require('../lib/evaluator/typechart') as typeof import('../lib/evaluator/typechart');
  const {boardControl} = require('../lib/evaluator/tags') as typeof import('../lib/evaluator/tags');
  const {rngExposure, noFavorableRng} = require('../lib/evaluator/rng') as typeof import('../lib/evaluator/rng');
  const {relevantBst} = require('../lib/evaluator/bst') as typeof import('../lib/evaluator/bst');
  const {teamDamageSources} = require('../lib/evaluator/damage') as typeof import('../lib/evaluator/damage');
  const {matchTeam} = require('../lib/evaluator/match') as typeof import('../lib/evaluator/match');

  // Keep in sync with EXAMPLE_TEAM in src/pages/TeamEvaluatorPage.tsx.
  const EXAMPLE = `
Garchomp @ Life Orb
Ability: Rough Skin
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Protect

Kingambit @ Black Glasses
Ability: Defiant
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Sucker Punch
- Kowtow Cleave
- Iron Head
- Swords Dance

Incineroar
Ability: Intimidate
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Parting Shot
- U-turn

Charizard @ Charizardite Y
Ability: Blaze
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Heat Wave
- Solar Beam
- Overheat
- Protect

Rotom-Wash @ Sitrus Berry
Ability: Levitate
EVs: 252 HP / 252 SpA
Modest Nature
- Hydro Pump
- Thunderbolt
- Will-O-Wisp
- Protect

Whimsicott @ Focus Sash
Ability: Prankster
EVs: 252 HP / 252 Spe
Timid Nature
- Tailwind
- Moonblast
- Encore
- Icy Wind
`;
  const team = parseTeam(EXAMPLE, dex);
  check('example team parses 6/6', team.sets.length === 6 && team.failures.length === 0,
    team.failures.map((f) => f.message).join('; '));

  // Every section computes without throwing and returns sane shapes.
  const def = defensiveMatrix(dex, team.sets);
  const off = offensiveMatrix(dex, team.sets);
  check('type matrices: 18 rows × 6 members',
    def.cells.length === 18 && def.cells[0].length === 6 &&
    off.cells.length === 18 && off.cells[0].length === 6);

  const inv = boardControl(dex, team.sets);
  check('board control: 10 categories × 6 members',
    inv.length === 10 && inv.every((c) => c.perMember.length === 6));
  check('example team has tailwind + fake out + pivoting + encore coverage',
    inv.find((c) => c.id === 'speed')!.perMember[5].some((t) => t.name === 'Tailwind') &&
    inv.find((c) => c.id === 'targeting')!.perMember[2].some((t) => t.name === 'Fake Out') &&
    inv.find((c) => c.id === 'pivoting')!.perMember[2].length === 2 &&
    inv.find((c) => c.id === 'option')!.perMember[5].some((t) => t.name === 'Encore'));

  const rng = rngExposure(dex, team.sets);
  check('example team RNG: favorable present (Rock Slide flinch), unfavorable present (Hydro Pump acc)',
    !noFavorableRng(rng) &&
    rng.unfavorable.acc80to89.some((e) => e.source === 'Hydro Pump'));

  const bst = relevantBst(dex, team.sets);
  check('example team BST: no Trick Room → single average; all 6 members scored',
    bst.hasTrickRoomSetter === false && bst.members.length === 6 && bst.averageWithSpeed > 400);

  const ds = teamDamageSources(team.sets);
  check('example team damage sources: shares sum to 1, Fire cell present (Zard Y)',
    Math.abs(ds.viz.cells.reduce((a, c) => a + c.share, 0) - 1) < 1e-9 &&
    ds.viz.cells.some((c) => c.type === 'Fire' && c.category === 'Special'));

  const matches = matchTeam(team.sets, variants.variants);
  check('example team matching: all 6 map to known variants',
    matches.every((m) => m.variantId !== null),
    matches.filter((m) => !m.variantId).map((m) => m.set.species).join(', '));
}

// ---------------------------------------------------------------------------
if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall checks passed');

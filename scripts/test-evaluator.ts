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
    if (!same(o.ability, s.ability)) { parityOk = false; parityDetails.push(`set ${i} ability`); }
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
if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall checks passed');

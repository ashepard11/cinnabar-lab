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
if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall checks passed');

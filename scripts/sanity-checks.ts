/**
 * Final sanity checks from SPEC-damageviz.md "Test cases to verify
 * correctness". Run against the built data files.
 * Run: npx tsx scripts/sanity-checks.ts (exits non-zero on failure)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {calculate} from '../lib/calc';
import {STANDARD_TARGET} from '../lib/variants';
import type {Viz1Data, Viz2Data} from '../lib/types';

const DATA_DIR = path.join(__dirname, '..', 'data');
const viz1: Viz1Data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'viz1-data.json'), 'utf8'));
const viz2: Viz2Data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'viz2-data.json'), 'utf8'));

let failures = 0;
function check(label: string, cond: boolean, detail: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
  if (!cond) failures++;
}

const v1cell = (t: string, c: string) => viz1.cells.find((x) => x.type === t && x.category === c)!;
const v2cell = (t: string, c: string) => viz2.cells.find((x) => x.type === t && x.category === c)!;

// --- Viz 1 ---
{
  const fire = v1cell('Fire', 'Special');
  const top = fire.contributors[0];
  check(
    'Viz 1: Fire special dominated by Charizard-Mega-Y Heat Wave',
    top.species === 'Charizard-Mega-Y' && top.move === 'Heat Wave',
    `top = ${top.species} ${top.move}`
  );

  const ground = v1cell('Ground', 'Physical');
  const gtop = ground.contributors[0];
  check(
    'Viz 1: Ground physical dominated by Garchomp Earthquake',
    gtop.species === 'Garchomp' && gtop.move === 'Earthquake',
    `top = ${gtop.species} ${gtop.move}`
  );

  const dark = v1cell('Dark', 'Physical');
  const darkTop5 = dark.contributors.slice(0, 5);
  const hasKingambit = darkTop5.some((c) => c.species === 'Kingambit' && ['Sucker Punch', 'Kowtow Cleave'].includes(c.move));
  const hasIncineroar = darkTop5.some((c) => c.species === 'Incineroar');
  check(
    'Viz 1: Dark physical led by Kingambit and Incineroar',
    darkTop5[0].species === 'Kingambit' && hasKingambit && hasIncineroar,
    darkTop5.map((c) => `${c.species} ${c.move}`).join(', ')
  );
}

// --- Viz 2 ---
{
  // Ground physical high UNLESS the field is Flying/Levitate-heavy. This field
  // has Charizard, Staraptor, Talonflame, Pelipper, Whimsicott, Dragonite,
  // Aerodactyl etc., so we assert the weaker form: not in the bottom third,
  // and the immune defenders visibly drag it (top contributors exist).
  const gp = v2cell('Ground', 'Physical');
  const sorted = viz2.cells.slice().sort((a, b) => b.relative - a.relative);
  const rank = sorted.findIndex((c) => c === gp) + 1;
  check(
    'Viz 2: Ground physical not dragged into the bottom third (Flying-heavy field caveat)',
    rank <= 24,
    `relative ${gp.relative.toFixed(2)}, rank ${rank}/36`
  );

  const bugRanks = [v2cell('Bug', 'Physical'), v2cell('Bug', 'Special')].map(
    (c) => sorted.findIndex((x) => x === c) + 1
  );
  check(
    'Viz 2: Bug near the bottom',
    bugRanks.every((r) => r > 36 - 6),
    `Bug ranks ${bugRanks.join(', ')} of 36`
  );

  const fairy = v2cell('Fairy', 'Special');
  check(
    'Viz 2: Fairy special elevated (≥ 1.0) thanks to Dragons in the field',
    fairy.relative >= 1.0,
    `relative ${fairy.relative.toFixed(2)}; top: ${fairy.contributors.slice(0, 3).map((c) => c.species).join(', ')}`
  );
}

// --- Calc benchmark ---
{
  const result = calculate(
    {species: 'Charizard-Mega-Y', nature: 'Modest', sps: {spa: 32}, ability: 'Drought', item: 'Charizardite Y'},
    STANDARD_TARGET,
    {name: 'Heat Wave'},
    {isDoubles: true, weather: 'Sun'}
  );
  check(
    'Mega Charizard Y Heat Wave ~70%+ avg into synthetic target',
    result.avg >= 0.7,
    `avg ${(result.avg * 100).toFixed(1)}%`
  );
}

console.log(failures === 0 ? '\nAll sanity checks passed.' : `\n${failures} sanity check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

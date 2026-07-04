/**
 * Unit tests for lib/variants.ts against the spec's worked examples.
 * Run: npx tsx scripts/test-variants.ts (exits non-zero on failure)
 */
import {selectVariants} from '../lib/variants';
import type {PokemonUsage} from '../lib/types';

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const base = (over: Partial<PokemonUsage>): PokemonUsage => ({
  name: 'Testmon',
  usage: 0.1,
  moves: [],
  abilities: [{name: 'Intimidate', usage: 1}],
  items: [],
  modal_set: {
    ability: 'Intimidate',
    item: 'Sitrus Berry',
    nature: 'Adamant',
    sps: {hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0},
  },
  ...over,
});

// --- Worked example 1: Charizard (18% usage) → exactly 2 Mega variants ---
{
  const chz = base({
    name: 'Charizard',
    usage: 0.18,
    modal_set: {ability: 'Blaze', item: 'Charizardite Y', nature: 'Modest', sps: {hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32}},
    items: [
      {name: 'Charizardite Y', usage: 0.923},
      {name: 'Charizardite X', usage: 0.066},
      {name: 'Charcoal', usage: 0.01},
    ],
  });
  const vs = selectVariants(chz);
  check('Charizard → 2 variants', vs.length === 2, vs.map((v) => v.id).join(', '));
  const y = vs.find((v) => v.id === 'charizard_mega_y');
  const x = vs.find((v) => v.id === 'charizard_mega_x');
  check('Mega Y variant exists with Drought', !!y && y.ability === 'Drought', y?.ability);
  check('Mega X variant exists with Tough Claws', !!x && x.ability === 'Tough Claws', x?.ability);
  check('Mega Y weight = 0.18 × 0.923', !!y && Math.abs(y.weight - 0.18 * 0.923) < 1e-9, String(y?.weight));
  check('Mega Y species is canonical Showdown form', !!y && y.species === 'Charizard-Mega-Y', y?.species);
  check('Charcoal bucket (0.18×1% = 0.18%) excluded', !vs.some((v) => v.item === 'Charcoal'));
}

// --- Worked example 2: Garchomp-like (39%, Soft Sand 15.6%, rest non-boosting) → 2 variants ---
{
  const chomp = base({
    name: 'Garchomp',
    usage: 0.39,
    modal_set: {ability: 'Rough Skin', item: 'Life Orb', nature: 'Jolly', sps: {hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32}},
    items: [
      {name: 'Soft Sand', usage: 0.156},
      {name: 'Choice Scarf', usage: 0.2},
      {name: 'White Herb', usage: 0.15},
      {name: 'Lum Berry', usage: 0.1},
      {name: 'Haban Berry', usage: 0.1},
      {name: 'Clear Amulet', usage: 0.03},
    ],
  });
  const vs = selectVariants(chomp);
  check('Garchomp-like → 2 variants', vs.length === 2, vs.map((v) => v.id).join(', '));
  const soft = vs.find((v) => v.item === 'Soft Sand');
  const noItem = vs.find((v) => v.item === null);
  check('Soft Sand variant included (6.1%)', !!soft);
  // 0.2+0.15+0.1+0.1+0.03 listed non-boosting = 0.58, plus truncation residual 0.264 → 0.844
  check('No-item bucket aggregates non-boosting + residual', !!noItem && Math.abs(noItem.weight - 0.39 * 0.844) < 1e-9, String(noItem?.weight));
}

// --- Worked example 3: 1.2% usage, Expert Belt 30%, non-boosting 70% → fallback to modal no-item ---
{
  const lowmon = base({
    name: 'Testmon Low',
    usage: 0.012,
    items: [
      {name: 'Expert Belt', usage: 0.3},
      {name: 'Sitrus Berry', usage: 0.7},
    ],
  });
  const vs = selectVariants(lowmon);
  check('Fallback → exactly 1 variant', vs.length === 1, vs.map((v) => v.id).join(', '));
  check('Fallback variant is the no-item modal bucket', vs[0].item === null, String(vs[0].item));
}

// --- Worked example 4: 1.5% usage, Life Orb 80% → 1 Life Orb variant ---
{
  const orbmon = base({
    name: 'Testmon Orb',
    usage: 0.015,
    items: [
      {name: 'Life Orb', usage: 0.8},
      {name: 'Sitrus Berry', usage: 0.2},
    ],
  });
  const vs = selectVariants(orbmon);
  check('Life Orb variant only → 1 variant', vs.length === 1 && vs[0].item === 'Life Orb', vs.map((v) => `${v.id}:${v.item}`).join(', '));
}

// --- Mis-matched Mega Stone goes to no-item bucket, not a Mega variant ---
{
  const weird = base({
    name: 'Staraptor',
    usage: 0.076,
    items: [
      {name: 'Staraptite', usage: 0.945},
      {name: 'Skarmorite', usage: 0.001},
      {name: 'Choice Band', usage: 0.03},
    ],
  });
  const vs = selectVariants(weird);
  check('Staraptite → Mega variant', vs.some((v) => v.species === 'Staraptor-Mega'), vs.map((v) => v.species).join(', '));
  check('Skarmorite on Staraptor is NOT a Mega variant', !vs.some((v) => v.item === 'Skarmorite'));
}

console.log(failures === 0 ? '\nAll variant tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

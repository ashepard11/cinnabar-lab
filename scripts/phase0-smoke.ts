/**
 * Phase 0 smoke test: verify @smogon/calc (vendored master build) handles
 * Pokémon Champions correctly before building the pipeline on top of it.
 *
 * Run: npx tsx scripts/phase0-smoke.ts
 * Exits non-zero if any check fails.
 */
import {GEN, buildPokemon, toID} from '../lib/pokemon';
import {calculate} from '../lib/calc';
import type {PokemonSpec} from '../lib/types';

let failures = 0;

function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

// --- Champions data markers (catch a stale/wrong-gen calc) ---
const gravApple = GEN.moves.get(toID('Grav Apple'))!;
check('Grav Apple is 90 BP in Champions', gravApple.basePower === 90, `got ${gravApple.basePower}`);

const zardY = GEN.species.get(toID('Charizard-Mega-Y'))!;
check('Mega Charizard Y base SpA is 159', zardY.baseStats.spa === 159, `got ${zardY.baseStats.spa}`);

const growth = GEN.moves.get(toID('Growth'))!;
// Spec says Growth is Grass-type in Champions; the master-branch calc data
// does not (yet) patch it. Status move → zero impact on damage output, so we
// log it as informational rather than failing (see DECISIONS.md).
console.log(`INFO  Growth type in calc data: ${growth.type} (spec says Grass in Champions; status move, no damage impact)`);

// --- Champions stat formula ---
const attacker: PokemonSpec = {
  species: 'Charizard-Mega-Y',
  nature: 'Modest',
  sps: {spa: 32}, // max SpA investment (SP, not EVs)
  ability: 'Drought',
  item: 'Charizardite Y',
};
const att = buildPokemon(attacker);
check('Champions stat formula: 32 SP Modest 159-base SpA = 232', att.stats.spa === 232, `got ${att.stats.spa}`);

// --- The Mega Zard Y Heat Wave end-to-end case ---
import {STANDARD_TARGET} from '../lib/variants';

const result = calculate(
  attacker,
  STANDARD_TARGET,
  {name: 'Heat Wave'},
  {isDoubles: true, weather: 'Sun'}
);
console.log(
  `INFO  Heat Wave rolls vs 100/80/80: min ${(result.min * 100).toFixed(1)}% ` +
  `avg ${(result.avg * 100).toFixed(1)}% max ${(result.max * 100).toFixed(1)}%`
);
// Spec: "roughly 60–80% per hit" as a rough band, and the final sanity check
// is "~70%+ avg roll; if ~30% something's wrong". Champions' level-independent
// stat formula lands the avg slightly above the rough band (~86%).
check('Heat Wave avg roll is 70%+ of target HP', result.avg >= 0.7, `avg ${(result.avg * 100).toFixed(1)}%`);
check('Heat Wave avg roll is not wildly high (< 120%)', result.avg < 1.2, `avg ${(result.avg * 100).toFixed(1)}%`);

// Sun and spread multipliers actually engage:
const noSun = calculate(attacker, STANDARD_TARGET, {name: 'Heat Wave'}, {isDoubles: true});
check('Sun boosts Fire damage ~1.5×', Math.abs(result.avg / noSun.avg - 1.5) < 0.03, `ratio ${(result.avg / noSun.avg).toFixed(3)}`);

const singles = calculate(attacker, STANDARD_TARGET, {name: 'Heat Wave'}, {isDoubles: false, weather: 'Sun'});
check('Doubles spread reduction ~0.75× vs singles', Math.abs(result.avg / singles.avg - 0.75) < 0.03, `ratio ${(result.avg / singles.avg).toFixed(3)}`);

// Immunity handling (viz 2 relies on 0 for immune cells):
const eq = calculate(
  {species: 'Garchomp', nature: 'Jolly', sps: {atk: 32}},
  {species: 'Rotom-Wash', nature: 'Calm', sps: {}, ability: 'Levitate'},
  {name: 'Earthquake'},
  {isDoubles: true}
);
check('Levitate makes Earthquake do 0', eq.avg === 0, `avg ${(eq.avg * 100).toFixed(1)}%`);

console.log(failures === 0 ? '\nAll Phase 0 checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

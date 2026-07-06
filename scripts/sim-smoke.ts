/**
 * Phase 0 smoke test for the battle simulator (SPEC-sim.md).
 *
 * Drives pokemon-showdown's BattleStream headlessly for a Champions 1v1:
 * Mega Charizard Y (modal spread) vs Incineroar (modal spread), both sides
 * on a trivial "always move slot 1" policy.
 *
 * Verifies:
 *  - the Champions Reg M-B format loads and battles run to completion
 *  - Champions stat formula applies (HP = base + SP + 75)
 *  - Drought auto-sets Sun on switch-in
 *  - starting as the Mega forme works (no mega-declaration needed)
 */
import { BattleStream, Teams, Dex } from 'pokemon-showdown';
import { runBattle, type MovePolicy, type SimSet } from '../lib/sim/engine';

type PokemonSet = SimSet;

// 1v1 battles use the BSS (singles) Champions format: the doubles engine
// cannot start a battle with one Pokémon per side (null active slot crash),
// and for a strict 1v1 the mechanics are identical — spread reduction never
// engages with a single target. See DECISIONS.md.
const FORMAT = 'gen9championsbssregmb';

function spsToEvs(sps: Partial<Record<string, number>>) {
  return {
    hp: sps.hp ?? 0, atk: sps.atk ?? 0, def: sps.def ?? 0,
    spa: sps.spa ?? 0, spd: sps.spd ?? 0, spe: sps.spe ?? 0,
  };
}

// Modal sets from data/defender-variants.json
const zardY: PokemonSet = {
  name: 'Charizard', species: 'Charizard-Mega-Y', item: 'Charizardite Y',
  ability: 'Drought', moves: ['Heat Wave', 'Solar Beam', 'Weather Ball', 'Protect'],
  nature: 'Modest', gender: '', evs: spsToEvs({ hp: 2, spa: 32, spe: 32 }),
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
};

const incin: PokemonSet = {
  name: 'Incineroar', species: 'Incineroar', item: 'Charcoal',
  ability: 'Intimidate', moves: ['Flare Blitz', 'Knock Off', 'Fake Out', 'Parting Shot'],
  nature: 'Adamant', gender: '', evs: spsToEvs({ hp: 32, atk: 32 }),
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50,
};

async function main() {
  const format = Dex.formats.get(FORMAT);
  console.log(`format: ${format.name} (exists=${format.exists}, mod=${format.mod}, gameType=${format.gameType})`);

  const stream = new BattleStream();
  const log: string[] = [];
  let winner: string | null = null;
  let sawSun = false;
  let turns = 0;

  const done = (async () => {
    for await (const chunk of stream) {
      for (const line of chunk.split('\n')) {
        log.push(line);
        if (line.startsWith('|error|')) console.error('ERROR:', line);
        if (line.startsWith('|-weather|SunnyDay')) sawSun = true;
        if (line.startsWith('|turn|')) turns = Number(line.split('|')[2]);
        if (line.startsWith('|win|')) winner = line.split('|')[2];
        // Respond to requests
        if (line.startsWith('|request|')) {
          const req = JSON.parse(line.slice('|request|'.length));
          const side = req.side.id; // 'p1' | 'p2'
          if (req.teamPreview) {
            void stream.write(`>${side} team 1`);
          } else if (req.forceSwitch) {
            void stream.write(`>${side} pass`);
          } else if (req.active) {
            void stream.write(`>${side} move 1`);
          }
        }
      }
    }
  })();

  await stream.write(`>start {"formatid":"${FORMAT}"}`);
  await stream.write(`>player p1 {"name":"A","team":"${Teams.pack([zardY])}"}`);
  await stream.write(`>player p2 {"name":"B","team":"${Teams.pack([incin])}"}`);

  // Wait for battle to end (or bail after 5s)
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  await Promise.race([done, timeout]);

  console.log(`\n--- battle log (${log.length} lines) ---`);
  for (const line of log) {
    if (/^\|(move|-damage|-heal|faint|win|turn|-weather|switch|detailschange|-ability|-supereffective|-resisted|error)/.test(line)) {
      console.log(line);
    }
  }

  // Champions stat check: Mega Zard Y HP = 78 + 2 + 75 = 155
  const hpLine = log.find((l) => l.startsWith('|switch|p1a:'));
  console.log('\nchecks:');
  console.log(`  p1 switch-in line: ${hpLine}`);
  console.log(`  expected Zard Y max HP 155 (78 base + 2 SP + 75): ${hpLine?.includes('155/155') ? 'PASS' : 'FAIL'}`);
  console.log(`  Sun auto-set by Drought: ${sawSun ? 'PASS' : 'FAIL'}`);
  console.log(`  battle completed with winner: ${winner ?? 'NONE (FAIL)'} in ${turns} turns`);

  // --- engine.ts: seeded runBattle must be reproducible ---
  const slot1: MovePolicy = {
    id: 'slot1', version: '1',
    choose: () => 'move 1',
  };
  const mkSetup = () => ({
    side_A: zardY as any, side_B: incin as any,
    policy_A: slot1, policy_B: slot1,
    seed: 'smoke-test-seed', collectLog: true,
  });
  const r1 = await runBattle(mkSetup());
  const r2 = await runBattle(mkSetup());
  const same = r1.winner === r2.winner && r1.turns === r2.turns &&
    JSON.stringify(r1.log) === JSON.stringify(r2.log);
  console.log(`  engine runBattle: winner=${r1.winner} turns=${r1.turns} hp_timeline=${r1.hp_timeline?.length} pts`);
  console.log(`  seeded battle reproducible: ${same ? 'PASS' : 'FAIL'}`);
  if (!same || r1.winner === 'draw') process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

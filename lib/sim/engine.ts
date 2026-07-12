/**
 * lib/sim/engine.ts — wraps pokemon-showdown's BattleStream for a Champions 1v1.
 *
 * Design notes (see DECISIONS.md for reasoning):
 *  - Battles run in the Champions BSS (singles) format `gen9championsbssregmb`:
 *    the doubles engine cannot start a battle with one Pokémon per side (null
 *    active-slot crash in the turn loop), and for a strict 1v1 the two game
 *    types are mechanically identical — spread reduction never engages with a
 *    single target.
 *  - Mega variants are sent to the battle already in their Mega forme
 *    (hackmons-style; BattleStream runs no team validation). This matches the
 *    variant data (spreads/abilities are for the Mega) and sidesteps the
 *    mega-declaration API.
 *  - Policies run in-process and receive the live (omniscient) Battle object.
 *    1v1 Champions endgames have no hidden information that matters for v1 —
 *    both modal sets are public knowledge in our model — so omniscience is a
 *    feature, not a leak.
 */
import { BattleStream, Teams, PRNG } from 'pokemon-showdown';
import type { Battle } from 'pokemon-showdown';
import * as crypto from 'crypto';

export const SIM_FORMAT = 'gen9championsbssregmb';

/**
 * Version of the simulation engine as a whole: this driver, the seeding
 * scheme, the planning model, and the vendored showdown build. Bump on any
 * change that can alter battle outcomes — matchup rows are keyed on it
 * (schema v2, BACKLOG item 02), so stale cached rows become distinguishable.
 */
export const SIM_ENGINE_VERSION = '1.0.0';

/** Maximum turns before a battle is declared a draw (PP stall safety net). */
export const MAX_TURNS = 500;

export type SideID = 'p1' | 'p2';

/** Showdown PokemonSet shape (the package exports the type from sim/teams). */
export interface SimSet {
  name: string;
  species: string;
  item: string;
  ability: string;
  moves: string[];
  nature: string;
  gender: string;
  /** Champions SP (0–32 per stat) — the champions mod reads set.evs as SP. */
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  level: number;
}

export interface PolicyContext {
  /** Live battle object — omniscient view, do not mutate. */
  battle: Battle;
  sideId: SideID;
  /** The request JSON Showdown sent this side (moves, pp, disabled flags…). */
  request: any;
  /** Policy-owned seeded RNG for tie-breaking; keeps battles reproducible. */
  prng: PRNG;
}

export interface MovePolicy {
  /** Stable identifier, e.g. "maximin-d2". Recorded in matchups.sqlite metadata. */
  id: string;
  version: string;
  /** Return a Showdown choice string for this side, e.g. "move 2". */
  choose(ctx: PolicyContext): string;
}

export interface BattleSetup {
  side_A: SimSet;
  side_B: SimSet;
  policy_A: MovePolicy;
  policy_B: MovePolicy;
  /**
   * Battle-start hook: runs after both Pokémon are on the field, before the
   * first move request is answered. Used by lib/sim/condition.ts to apply
   * starting conditions directly to the Battle object.
   */
  onBattleStart?: (battle: Battle) => void;
  /** PRNGSeed string ("sodium,<32 hex>"), or any string (hashed to one). */
  seed?: string;
  /** Capture the battle log and per-turn HP timeline (for debugging/UI). */
  collectLog?: boolean;
}

export interface TurnHP {
  turn: number;
  hp_A: number;  // fraction of max HP, 0–1
  hp_B: number;
}

export interface BattleResult {
  winner: 'A' | 'B' | 'draw';
  turns: number;
  log?: string[];
  hp_timeline?: TurnHP[];
}

/** Derive a valid sodium PRNGSeed from an arbitrary string. */
export function seedFromString(s: string): string {
  if (/^(sodium|gen5|[0-9]+),/.test(s)) return s;
  const hex = crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
  return `sodium,${hex}`;
}

/**
 * Run one 1v1 battle to completion. Resolves with the winner ('A' = p1).
 */
export async function runBattle(setup: BattleSetup): Promise<BattleResult> {
  const seed = setup.seed ? seedFromString(setup.seed) : undefined;
  const stream = new BattleStream();

  const log: string[] = [];
  const hpTimeline: TurnHP[] = [];
  let winner: 'A' | 'B' | 'draw' | null = null;
  let turns = 0;
  let started = false;

  const policies: Record<SideID, MovePolicy> = { p1: setup.policy_A, p2: setup.policy_B };
  const prngs: Record<SideID, PRNG> = {
    p1: new PRNG(seedFromString(`${setup.seed ?? 'unseeded'}:policy:p1`) as any),
    p2: new PRNG(seedFromString(`${setup.seed ?? 'unseeded'}:policy:p2`) as any),
  };

  const recordHp = () => {
    if (!setup.collectLog) return;
    const b = stream.battle;
    if (!b) return;
    const a = b.sides[0].pokemon[0];
    const d = b.sides[1].pokemon[0];
    const entry = {
      turn: b.turn,
      hp_A: a ? a.hp / a.maxhp : 0,
      hp_B: d ? d.hp / d.maxhp : 0,
    };
    const last = hpTimeline[hpTimeline.length - 1];
    if (last && last.turn === entry.turn) hpTimeline[hpTimeline.length - 1] = entry;
    else hpTimeline.push(entry);
  };

  const consume = (async () => {
    for await (const chunk of stream) {
      // Chunk format: first line is the type ('update' | 'sideupdate' | 'end');
      // for 'sideupdate' the second line is the side id, the rest the message.
      const lines = chunk.split('\n');
      const chunkType = lines[0];
      const chunkSide: SideID | null =
        chunkType === 'sideupdate' ? (lines[1] as SideID) : null;

      for (const line of lines) {
        if (!line.startsWith('|')) continue;
        if (setup.collectLog) log.push(line);

        if (line.startsWith('|turn|')) {
          turns = Number(line.split('|')[2]);
          recordHp();
          if (turns > MAX_TURNS) {
            winner = 'draw';
            return;
          }
        } else if (line.startsWith('|win|')) {
          const name = line.split('|')[2];
          winner = name === 'A' ? 'A' : 'B';
          return;
        } else if (line.startsWith('|tie|')) {
          winner = 'draw';
          return;
        } else if (line.startsWith('|request|')) {
          const req = JSON.parse(line.slice('|request|'.length));
          if (req.wait) continue;
          const side: SideID = req.side?.id ?? chunkSide;
          let choice: string;
          if (req.teamPreview) {
            choice = 'team 1';
          } else if (req.forceSwitch) {
            // 1v1: no bench — only reachable via self-switch moves (U-turn,
            // Parting Shot); "pass" keeps the active Pokémon in.
            choice = 'pass';
          } else if (req.active) {
            // First move request = both Pokémon are on the field; apply the
            // starting condition before any move is chosen.
            if (!started && stream.battle) {
              started = true;
              setup.onBattleStart?.(stream.battle);
              recordHp();
            }
            choice = policies[side].choose({
              battle: stream.battle!,
              sideId: side,
              request: req,
              prng: prngs[side],
            });
          } else {
            continue;
          }
          void stream.write(`>${side} ${choice}`);
        } else if (line.startsWith('|error|')) {
          // Unexpected choice rejection: fall back to the engine's default
          // choice rather than hanging the battle. [Unavailable choice] is
          // followed by a fresh request, which the branch above answers.
          if (!line.includes('[Unavailable choice]') && chunkSide) {
            void stream.write(`>${chunkSide} default`);
          }
        }
      }
    }
  })();

  await stream.write(
    `>start {"formatid":"${SIM_FORMAT}"${seed ? `,"seed":${JSON.stringify(seed)}` : ''}}`,
  );
  await stream.write(`>player p1 {"name":"A","team":${JSON.stringify(Teams.pack([setup.side_A as any]))}}`);
  await stream.write(`>player p2 {"name":"B","team":${JSON.stringify(Teams.pack([setup.side_B as any]))}}`);

  await consume;
  // Free the battle explicitly. stream.destroy() throws on `pushEnd` when the
  // consume loop returned early (win/tie seen before stream end), and that
  // throw happens BEFORE its internal battle.destroy() — leaking the Battle
  // object (~MBs each; found as unbounded memory growth in the matrix build).
  try { stream.battle?.destroy(); } catch { /* already destroyed */ }
  try { stream.destroy(); } catch { /* already ended */ }

  if (winner === null) winner = 'draw';
  const result: BattleResult = { winner, turns: Math.min(turns, MAX_TURNS) };
  if (setup.collectLog) {
    result.log = log;
    result.hp_timeline = hpTimeline;
  }
  return result;
}

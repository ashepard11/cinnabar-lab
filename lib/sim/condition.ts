/**
 * lib/sim/condition.ts — starting conditions (SPEC-sim.md Phase 2).
 *
 * A StartingCondition describes the battle state at turn 1. Application uses
 * the spec's "option 1": Showdown's Battle/Field/Side/Pokemon objects expose
 * debug-grade mutators (`setWeather(…, 'debug')`, `sethp`, `setStatus`,
 * `addSideCondition`), and since our engine runs the battle in-process we
 * call them directly from engine.ts's onBattleStart hook — after switch-in
 * effects (Intimidate, Drought) resolve, before the first move is chosen.
 *
 * A condition's explicit weather/terrain overrides ability-set weather
 * (rain condition beats Drought sun); `fresh` leaves ability weather alone.
 */
import type { Battle } from 'pokemon-showdown';

export type Stat = 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export type StartingCondition = {
  // Per-side HP fraction (default 1.0)
  hp_A?: number;
  hp_B?: number;

  // Per-side stat stages (default all 0)
  boosts_A?: Partial<Record<Stat, number>>;
  boosts_B?: Partial<Record<Stat, number>>;

  // Per-side status conditions (default none)
  status_A?: 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz' | null;
  status_B?: 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz' | null;

  // Field effects (default none)
  weather?: 'sun' | 'rain' | 'sand' | 'snow' | null;
  weather_turns_remaining?: number;
  terrain?: 'electric' | 'grassy' | 'misty' | 'psychic' | null;
  terrain_turns_remaining?: number;
  tailwind_A?: number;
  tailwind_B?: number;
  trick_room_turns?: number;
  screens_A?: { reflect?: number; light_screen?: number };
  screens_B?: { reflect?: number; light_screen?: number };
};

const WEATHER_ID: Record<string, string> = {
  sun: 'sunnyday', rain: 'raindance', sand: 'sandstorm', snow: 'snowscape',
};
const TERRAIN_ID: Record<string, string> = {
  electric: 'electricterrain', grassy: 'grassyterrain',
  misty: 'mistyterrain', psychic: 'psychicterrain',
};

/** Apply a starting condition to a freshly started battle (both mons active). */
export function applyCondition(battle: Battle, condition: StartingCondition): void {
  const sides = [
    { pokemon: battle.sides[0].active[0] ?? battle.sides[0].pokemon[0], side: battle.sides[0] },
    { pokemon: battle.sides[1].active[0] ?? battle.sides[1].pokemon[0], side: battle.sides[1] },
  ];
  const perSide = [
    {
      hp: condition.hp_A, boosts: condition.boosts_A, status: condition.status_A,
      tailwind: condition.tailwind_A, screens: condition.screens_A,
    },
    {
      hp: condition.hp_B, boosts: condition.boosts_B, status: condition.status_B,
      tailwind: condition.tailwind_B, screens: condition.screens_B,
    },
  ];

  for (let i = 0; i < 2; i++) {
    const { pokemon, side } = sides[i];
    const c = perSide[i];
    if (c.hp !== undefined && c.hp < 1) {
      pokemon.sethp(Math.max(1, Math.round(pokemon.maxhp * c.hp)));
    }
    if (c.boosts) {
      for (const [stat, stage] of Object.entries(c.boosts)) {
        if (stage) pokemon.boosts[stat as Stat] = Math.max(-6, Math.min(6, stage));
      }
    }
    if (c.status) {
      // Force-set: starting conditions bypass in-battle immunity checks the
      // same way an earlier-game status would already be applied. (Immune
      // combinations like brn on Fire-types shouldn't be swept anyway.)
      pokemon.setStatus(c.status, null, null, true);
      if (c.status === 'slp') (pokemon.statusState as any).time = 2;
    }
    if (c.tailwind && c.tailwind > 0) {
      side.addSideCondition('tailwind', 'debug' as any);
      if (side.sideConditions['tailwind']) side.sideConditions['tailwind'].duration = c.tailwind;
    }
    if (c.screens?.reflect) {
      side.addSideCondition('reflect', 'debug' as any);
      if (side.sideConditions['reflect']) side.sideConditions['reflect'].duration = c.screens.reflect;
    }
    if (c.screens?.light_screen) {
      side.addSideCondition('lightscreen', 'debug' as any);
      if (side.sideConditions['lightscreen']) side.sideConditions['lightscreen'].duration = c.screens.light_screen;
    }
  }

  if (condition.weather) {
    battle.field.setWeather(WEATHER_ID[condition.weather], 'debug');
    (battle.field.weatherState as any).duration = condition.weather_turns_remaining ?? 5;
  }
  if (condition.terrain) {
    battle.field.setTerrain(TERRAIN_ID[condition.terrain], 'debug');
    (battle.field.terrainState as any).duration = condition.terrain_turns_remaining ?? 5;
  }
  if (condition.trick_room_turns && condition.trick_room_turns > 0) {
    battle.field.addPseudoWeather('trickroom', 'debug' as any);
    const tr = battle.field.pseudoWeather['trickroom'];
    if (tr) tr.duration = condition.trick_room_turns;
  }
}

// ---------------------------------------------------------------------------
// The enumerated condition set for the matchup matrix (SPEC-sim.md Phase 2)
// ---------------------------------------------------------------------------

export type ConditionId =
  | 'fresh' | 'tailwind_A' | 'tailwind_B' | 'trick_room' | 'sun' | 'rain'
  | 'A_boosted_atk' | 'A_boosted_spa' | 'B_boosted_atk' | 'B_boosted_spa';

export const CONDITIONS: Record<ConditionId, StartingCondition> = {
  fresh: {},
  tailwind_A: { tailwind_A: 4 },
  tailwind_B: { tailwind_B: 4 },
  trick_room: { trick_room_turns: 5 },
  sun: { weather: 'sun', weather_turns_remaining: 5 },
  rain: { weather: 'rain', weather_turns_remaining: 5 },
  A_boosted_atk: { boosts_A: { atk: 1 } },
  A_boosted_spa: { boosts_A: { spa: 1 } },
  B_boosted_atk: { boosts_B: { atk: 1 } },
  B_boosted_spa: { boosts_B: { spa: 1 } },
};

export const CONDITION_IDS = Object.keys(CONDITIONS) as ConditionId[];

/**
 * Conditions symmetric under swapping sides: the (B, A) row is the exact
 * mirror of (A, B), so the matrix build simulates one ordering and derives
 * the other (see scripts/build-matchups.ts).
 */
export const SYMMETRIC_CONDITIONS: ReadonlySet<ConditionId> = new Set([
  'fresh', 'trick_room', 'sun', 'rain',
] as ConditionId[]);

/** The mirror of a condition when sides swap (tailwind_A ↔ tailwind_B, …). */
export function mirrorCondition(id: ConditionId): ConditionId {
  if (SYMMETRIC_CONDITIONS.has(id)) return id;
  if (id.includes('_A')) return id.replace('_A', '_B') as ConditionId;
  if (id.includes('_B')) return id.replace('_B', '_A') as ConditionId;
  if (id.startsWith('A_')) return `B_${id.slice(2)}` as ConditionId;
  return `A_${id.slice(2)}` as ConditionId;
}

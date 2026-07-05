/**
 * lib/sim/model.ts — the planning forward model for the equilibrium-search
 * policy (docs/policy-design.md §3.1).
 *
 * This is NOT a battle engine: ground truth is always the real Showdown
 * battle. The model only has to rank moves — it simulates one turn of a 1v1
 * on a compact state struct, with damage numbers from @smogon/calc (vendored
 * Champions build) and move metadata from the Showdown champions dex.
 *
 * Deliberate approximations are documented in the design doc: crits and
 * unlisted secondaries ignored, sleep at fixed 2 turns, full paralysis folded
 * into accuracy, Encore/Disable/Perish Song/After You as planning no-ops.
 */
import { Dex } from 'pokemon-showdown';
import type { Battle, Pokemon as ShowdownPokemon } from 'pokemon-showdown';
import { calculate as smogonCalculate, Field, Move as CalcMove, Pokemon as CalcPokemon } from '@smogon/calc';

// The Champions calc build keys Champions as generation 0 (see lib/pokemon.ts).
const CALC_GEN = 0;
const dex = Dex.mod('champions' as any);

export type PlanStatus = '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
export type PlanWeather = '' | 'sun' | 'rain' | 'sand' | 'snow';
export type PlanTerrain = '' | 'electric' | 'grassy' | 'misty' | 'psychic';

export interface PlanMove {
  id: string;
  name: string;
  category: 'Physical' | 'Special' | 'Status';
  type: string;
  basePower: number;
  accuracy: number;          // 1.0 for always-hit
  priority: number;
  isProtect: boolean;
  isRecharge: boolean;       // synthetic "recharge" action
  isStruggle: boolean;
  breaksProtect: boolean;
  makesContact: boolean;
  sound: boolean;
  isFakeOut: boolean;
  isSucker: boolean;         // Sucker Punch / Thunderclap-style conditional
  isCharge: boolean;         // two-turn (Solar Beam, Electro Shot, Meteor Beam)
  chargeSkipWeather: PlanWeather | ''; // weather that skips the charge turn
  selfRecharge: boolean;     // Hyper Beam family
  recoil: number;            // fraction of damage dealt
  crashOnMiss: number;       // fraction of own max HP (High Jump Kick) — unused in meta, kept for safety
  drain: number;             // fraction of damage healed
  heal: number;              // fraction of own max HP healed (weather-adjusted at use for Morning Sun family)
  weatherHeal: boolean;      // Morning Sun / Moonlight / Synthesis scaling
  selfBoosts: Partial<Record<string, number>> | null;
  targetBoosts: Partial<Record<string, number>> | null; // status moves like Charm / Scary Face
  status: PlanStatus;        // primary status inflicted (Will-O-Wisp → brn)
  fixedDamage: 'level' | 'half' | number | 0;
  isNoOp: boolean;           // Encore/Disable/Perish Song/etc — planning no-op
  pp: number;
}

export interface PlanMon {
  // static within a battle
  species: string;
  ability: string;
  abilityId: string;
  item: string;
  nature: string;
  sps: Record<string, number>;
  types: string[];
  speBase: number;           // stored (post-nature, pre-boost) speed stat
  maxhp: number;
  moves: PlanMove[];
  grounded: boolean;
  // dynamic
  hp: number;
  boosts: Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>;
  status: PlanStatus;
  toxTurns: number;
  slpTurns: number;
  stall: number;             // consecutive successful protects
  protectedNow: boolean;     // transient within a turn
  flinched: boolean;         // transient within a turn
  choiceLock: number;        // move index, -1 = none
  turnsOut: number;          // for Fake Out legality
  mustRecharge: boolean;
  charging: number;          // move index being charged, -1 = none
  leechSeed: boolean;
  pp: number[];
}

export interface PlanState {
  mons: [PlanMon, PlanMon];  // index 0 = side A (p1), 1 = side B
  weather: PlanWeather;
  weatherTurns: number;
  terrain: PlanTerrain;
  terrainTurns: number;
  trickRoom: number;
  tailwind: [number, number];
  screens: [{ reflect: number; lightScreen: number }, { reflect: number; lightScreen: number }];
}

const BOOST_TABLE = [2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3, 1, 3 / 2, 2, 5 / 2, 3, 7 / 2, 4];

const NO_OP_MOVES = new Set([
  'encore', 'disable', 'perishsong', 'afteryou', 'batonpass', 'infestation',
  'leechseed', // handled poorly by generic path (binding), modeled as no-op; execution is real
]);

const PROTECT_MOVES = new Set(['protect', 'detect', 'spikyshield', 'kingsshield', 'banefulbunker', 'silktrap', 'burningbulwark', 'obstruct']);

// ---------------------------------------------------------------------------
// Move + mon construction
// ---------------------------------------------------------------------------

export function buildPlanMove(idOrName: string, ppOverride?: number): PlanMove {
  const m = dex.moves.get(idOrName);
  const id = m.id;
  const heal = m.heal ? m.heal[0] / m.heal[1] : (m.id === 'roost' || m.id === 'slackoff' ? 0.5 : 0);
  const weatherHeal = ['morningsun', 'moonlight', 'synthesis'].includes(id);
  const isCharge = !!m.flags?.charge;
  let chargeSkipWeather: PlanWeather | '' = '';
  if (id === 'solarbeam' || id === 'solarblade') chargeSkipWeather = 'sun';
  if (id === 'electroshot') chargeSkipWeather = 'rain';
  let status: PlanStatus = '';
  if (m.status && m.category === 'Status') status = m.status as PlanStatus;
  let fixedDamage: PlanMove['fixedDamage'] = 0;
  if (m.damage === 'level') fixedDamage = 'level';
  else if (typeof m.damage === 'number') fixedDamage = m.damage;
  if (id === 'superfang' || id === 'naturesmadness' || id === 'ruination') fixedDamage = 'half';

  return {
    id,
    name: m.name,
    category: m.category as PlanMove['category'],
    type: m.type,
    basePower: m.basePower,
    accuracy: m.accuracy === true ? 1 : (m.accuracy as number) / 100,
    priority: m.priority,
    isProtect: PROTECT_MOVES.has(id),
    isRecharge: false,
    isStruggle: id === 'struggle',
    breaksProtect: !!m.breaksProtect,
    makesContact: !!m.flags?.contact,
    sound: !!m.flags?.sound,
    isFakeOut: id === 'fakeout',
    isSucker: id === 'suckerpunch' || id === 'thunderclap',
    isCharge,
    chargeSkipWeather,
    selfRecharge: !!m.self?.volatileStatus && m.self.volatileStatus === 'mustrecharge' || !!(m as any).recharge || id === 'hyperbeam' || id === 'gigaimpact',
    recoil: m.recoil ? m.recoil[0] / m.recoil[1] : (m.id === 'struggle' ? 0 : 0),
    crashOnMiss: m.hasCrashDamage ? 0.5 : 0,
    drain: m.drain ? m.drain[0] / m.drain[1] : 0,
    heal,
    weatherHeal,
    selfBoosts: (m.boosts && m.category === 'Status' && (m.target === 'self' || m.target === 'adjacentAllyOrSelf'))
      ? (m.boosts as any)
      : (m.self?.boosts as any) ?? null,
    targetBoosts: (m.boosts && m.category === 'Status' && m.target !== 'self') ? (m.boosts as any) : null,
    status,
    fixedDamage,
    isNoOp: NO_OP_MOVES.has(id) ||
      (m.category === 'Status' && !m.boosts && !status && !heal && !weatherHeal &&
       !PROTECT_MOVES.has(id) && !['strengthsap', 'clangoroussoul'].includes(id)),
    pp: ppOverride ?? (m.noPPBoosts ? m.pp : (m.pp / 5 + 1) * 4),
  };
}

export const STRUGGLE: PlanMove = {
  ...buildPlanMove('struggle'),
  isStruggle: true,
  // Struggle recoil is 1/4 of user's max HP, handled specially in step().
};

export const RECHARGE: PlanMove = {
  id: 'recharge', name: 'Recharge', category: 'Status', type: '???', basePower: 0,
  accuracy: 1, priority: 0, isProtect: false, isRecharge: true, isStruggle: false,
  breaksProtect: false, makesContact: false, sound: false, isFakeOut: false,
  isSucker: false, isCharge: false, chargeSkipWeather: '', selfRecharge: false,
  recoil: 0, crashOnMiss: 0, drain: 0, heal: 0, weatherHeal: false,
  selfBoosts: null, targetBoosts: null, status: '', fixedDamage: 0, isNoOp: true, pp: 99,
};

const WEATHER_MAP: Record<string, PlanWeather> = {
  sunnyday: 'sun', raindance: 'rain', sandstorm: 'sand', snowscape: 'snow', hail: 'snow',
  desolateland: 'sun', primordialsea: 'rain',
};

/** Extract the planning state from a live Showdown battle (omniscient). */
export function extractState(battle: Battle): PlanState {
  const mons = battle.sides.map((side) => {
    const p = side.active[0] ?? side.pokemon[0];
    return extractMon(p);
  }) as [PlanMon, PlanMon];

  const field = battle.field;
  const weather: PlanWeather = WEATHER_MAP[field.weather] ?? '';
  const terrain = (field.terrain ? field.terrain.replace('terrain', '') : '') as PlanTerrain;
  const sideCond = (i: number, name: string) =>
    (battle.sides[i].sideConditions[name]?.duration as number | undefined) ?? 0;

  return {
    mons,
    weather,
    weatherTurns: weather ? ((field.weatherState?.duration as number | undefined) ?? 5) : 0,
    terrain,
    terrainTurns: terrain ? ((field.terrainState?.duration as number | undefined) ?? 5) : 0,
    trickRoom: (field.pseudoWeather['trickroom']?.duration as number | undefined) ?? 0,
    tailwind: [sideCond(0, 'tailwind'), sideCond(1, 'tailwind')],
    screens: [
      { reflect: sideCond(0, 'reflect'), lightScreen: sideCond(0, 'lightscreen') },
      { reflect: sideCond(1, 'reflect'), lightScreen: sideCond(1, 'lightscreen') },
    ],
  };
}

function extractMon(p: ShowdownPokemon): PlanMon {
  const moves = p.baseMoveSlots.map((slot) => buildPlanMove(slot.id, slot.pp));
  let choiceLock = -1;
  if (p.volatiles['choicelock']) {
    const lockedId = (p.volatiles['choicelock'] as any).move;
    choiceLock = moves.findIndex((m) => m.id === lockedId);
  }
  let charging = -1;
  if (p.volatiles['twoturnmove']) {
    const chargeId = (p.volatiles['twoturnmove'] as any).move;
    charging = moves.findIndex((m) => m.id === chargeId);
  }
  return {
    species: p.species.name,
    ability: p.getAbility().name,
    abilityId: p.ability,
    item: p.item ? dex.items.get(p.item).name : '',
    nature: p.set.nature || 'Serious',
    sps: { ...p.set.evs },
    types: [...p.getTypes()],
    speBase: p.storedStats.spe,
    maxhp: p.maxhp,
    moves,
    grounded: p.isGrounded() ?? true,
    hp: p.hp,
    boosts: {
      atk: p.boosts.atk, def: p.boosts.def, spa: p.boosts.spa,
      spd: p.boosts.spd, spe: p.boosts.spe,
    },
    status: (p.status || '') as PlanStatus,
    toxTurns: p.status === 'tox' ? ((p.statusState as any).stage ?? 0) : 0,
    slpTurns: p.status === 'slp' ? 2 : 0,
    stall: p.volatiles['stall'] ? ((p.volatiles['stall'] as any).counter ?? 1) : 0,
    protectedNow: false,
    flinched: false,
    choiceLock,
    turnsOut: p.activeMoveActions,
    mustRecharge: !!p.volatiles['mustrecharge'],
    charging,
    leechSeed: !!p.volatiles['leechseed'],
    pp: p.baseMoveSlots.map((s) => s.pp),
  };
}

// ---------------------------------------------------------------------------
// Damage (memoized @smogon/calc)
// ---------------------------------------------------------------------------

export interface DamageEntry {
  rolls: number[];       // absolute HP damage, 16 rolls, vs full state
}

const damageCache = new Map<string, DamageEntry>();

/** Clear between matchup cells to bound memory. */
export function clearDamageCache(): void {
  damageCache.clear();
}

const HP_SCALING_MOVES = new Set(['waterspout', 'eruption', 'dragonenergy']);

/**
 * Showdown-dex → calc-dex species mapping (reverse of lib/sim/sets.ts).
 * The calc has no plain "Aegislash"; in-battle formes map to their stance.
 */
const SPECIES_TO_CALC: Record<string, string> = {
  'Aegislash': 'Aegislash-Shield',
  'Aegislash-Blade': 'Aegislash-Blade',
};

function calcSpecies(name: string): string {
  return SPECIES_TO_CALC[name] ?? name;
}

function damageKey(state: PlanState, atk: number, moveIdx: number, move: PlanMove): string {
  const a = state.mons[atk];
  const d = state.mons[1 - atk];
  const ds = state.screens[1 - atk];
  const hpBucket = HP_SCALING_MOVES.has(move.id) ? Math.ceil((a.hp / a.maxhp) * 16) : 0;
  return [
    a.species, a.item, moveIdx, move.id,
    a.boosts.atk, a.boosts.spa, a.status === 'brn' ? 1 : 0, hpBucket,
    d.species, d.item, d.boosts.def, d.boosts.spd,
    state.weather, state.terrain, ds.reflect > 0 ? 1 : 0, ds.lightScreen > 0 ? 1 : 0,
  ].join('|');
}

const CALC_WEATHER: Record<string, string> = { sun: 'Sun', rain: 'Rain', sand: 'Sand', snow: 'Snow' };
const CALC_TERRAIN: Record<string, string> = { electric: 'Electric', grassy: 'Grassy', misty: 'Misty', psychic: 'Psychic' };

function calcDamage(state: PlanState, atk: number, moveIdx: number, move: PlanMove): DamageEntry {
  const key = damageKey(state, atk, moveIdx, move);
  const hit = damageCache.get(key);
  if (hit) return hit;

  const a = state.mons[atk];
  const d = state.mons[1 - atk];
  const ds = state.screens[1 - atk];

  let rolls: number[];
  if (move.fixedDamage) {
    const dmg = move.fixedDamage === 'level' ? 50
      : move.fixedDamage === 'half' ? Math.max(1, Math.floor(d.hp / 2))
      : move.fixedDamage;
    rolls = new Array(16).fill(dmg);
  } else if (move.category === 'Status') {
    rolls = new Array(16).fill(0);
  } else {
    // Note: weight/HP-scaling moves (Low Kick, Eruption…) have basePower 0 in
    // dex data — the calc resolves their real BP, so they go through it too.
    try {
      const attacker = new CalcPokemon(CALC_GEN as any, calcSpecies(a.species), {
        ability: a.ability, item: a.item || undefined, nature: a.nature,
        evs: a.sps as any, boosts: a.boosts as any,
        status: a.status === 'brn' ? 'brn' : undefined,
      });
      // The calc's HP scale matches the battle's (level-independent formula),
      // so absolute current HP can be set directly for Eruption-style moves.
      if (HP_SCALING_MOVES.has(move.id)) attacker.originalCurHP = Math.max(1, a.hp);
      const defender = new CalcPokemon(CALC_GEN as any, calcSpecies(d.species), {
        ability: d.ability, item: d.item || undefined, nature: d.nature,
        evs: d.sps as any, boosts: d.boosts as any,
      });
      const field = new Field({
        gameType: 'Singles',
        weather: CALC_WEATHER[state.weather] as any,
        terrain: CALC_TERRAIN[state.terrain] as any,
        defenderSide: {
          isReflect: ds.reflect > 0,
          isLightScreen: ds.lightScreen > 0,
        } as any,
      });
      const result = smogonCalculate(CALC_GEN as any, attacker, defender, new CalcMove(CALC_GEN as any, move.name), field);
      const raw = result.damage as number | number[] | number[][];
      if (typeof raw === 'number') rolls = new Array(16).fill(raw);
      else if (raw.length === 0) rolls = new Array(16).fill(0);
      else if (typeof raw[0] === 'number') rolls = raw as number[];
      else {
        const parts = raw as number[][];
        rolls = new Array(parts[0].length).fill(0);
        for (const part of parts) for (let i = 0; i < rolls.length; i++) rolls[i] += part[i];
      }
    } catch {
      // Unknown species/move in the calc: fall back to zero damage (planning
      // will deprioritize; the real battle still executes correctly).
      rolls = new Array(16).fill(0);
    }
  }

  const entry: DamageEntry = { rolls };
  damageCache.set(key, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Turn simulation
// ---------------------------------------------------------------------------

export interface Branch {
  p: number;
  state: PlanState;
}

function cloneMon(m: PlanMon): PlanMon {
  return {
    ...m,
    boosts: { ...m.boosts },
    pp: [...m.pp],
    // moves array is static per battle — shared reference is fine
  };
}

export function cloneState(s: PlanState): PlanState {
  return {
    mons: [cloneMon(s.mons[0]), cloneMon(s.mons[1])],
    weather: s.weather,
    weatherTurns: s.weatherTurns,
    terrain: s.terrain,
    terrainTurns: s.terrainTurns,
    trickRoom: s.trickRoom,
    tailwind: [s.tailwind[0], s.tailwind[1]],
    screens: [{ ...s.screens[0] }, { ...s.screens[1] }],
  };
}

/** Effective speed for order determination. */
export function effectiveSpeed(state: PlanState, i: number): number {
  const m = state.mons[i];
  let spe = m.speBase * BOOST_TABLE[m.boosts.spe + 6];
  if (m.status === 'par') spe *= 0.5;
  if (state.tailwind[i] > 0) spe *= 2;
  const ab = m.abilityId;
  if (ab === 'chlorophyll' && state.weather === 'sun') spe *= 2;
  if (ab === 'swiftswim' && state.weather === 'rain') spe *= 2;
  if (ab === 'sandrush' && state.weather === 'sand') spe *= 2;
  if (ab === 'slushrush' && state.weather === 'snow') spe *= 2;
  if (ab === 'quickfeet' && m.status) spe *= 1.5;
  return Math.floor(spe);
}

function movePriority(state: PlanState, i: number, move: PlanMove): number {
  let prio = move.priority;
  if (move.id === 'grassyglide' && state.terrain === 'grassy' && state.mons[i].grounded) prio += 1;
  if (state.mons[i].abilityId === 'prankster' && move.category === 'Status') prio += 1;
  if (state.mons[i].abilityId === 'galewings' && move.type === 'Flying' && state.mons[i].hp === state.mons[i].maxhp) prio += 1;
  return prio;
}

const STATUS_IMMUNITY_ABILITIES: Record<string, PlanStatus[]> = {
  limber: ['par'], waterveil: ['brn'], waterbubble: ['brn'], thermalexchange: ['brn'],
  vitalspirit: ['slp'], insomnia: ['slp'], sweetveil: ['slp'],
  immunity: ['psn', 'tox'], pastelveil: ['psn', 'tox'],
  comatose: ['brn', 'par', 'psn', 'tox', 'slp', 'frz'],
  purifyingsalt: ['brn', 'par', 'psn', 'tox', 'slp', 'frz'],
  goodasgold: [], // handled separately: blocks all status moves
  shieldsdown: ['brn', 'par', 'psn', 'tox', 'slp', 'frz'],
};

function canBeStatused(state: PlanState, defIdx: number, status: PlanStatus, move: PlanMove): boolean {
  const d = state.mons[defIdx];
  if (d.status) return false;
  if (d.abilityId === 'goodasgold') return false;
  const immune = STATUS_IMMUNITY_ABILITIES[d.abilityId];
  if (immune && (immune.length === 0 || immune.includes(status))) return false;
  const types = d.types;
  if (status === 'brn' && types.includes('Fire')) return false;
  if (status === 'par' && types.includes('Electric')) return false;
  if ((status === 'psn' || status === 'tox') && (types.includes('Poison') || types.includes('Steel')) && state.mons[1 - defIdx].abilityId !== 'corrosion') return false;
  if ((move.id === 'sleeppowder' || move.id === 'spore' || move.id === 'stunspore') &&
      (types.includes('Grass') || d.abilityId === 'overcoat' || d.item === 'Safety Goggles')) return false;
  if (d.grounded && state.terrain === 'misty') return false;
  if (d.grounded && state.terrain === 'electric' && status === 'slp') return false;
  return true;
}

/** Legal planning actions for side i (indices into mon.moves, or specials). */
export function legalActions(state: PlanState, i: number): PlanMove[] {
  const m = state.mons[i];
  if (m.mustRecharge) return [RECHARGE];
  if (m.charging >= 0) return [m.moves[m.charging]];
  let acts = m.moves.filter((mv, idx) => m.pp[idx] > 0);
  if (m.choiceLock >= 0 && m.pp[m.choiceLock] > 0) acts = [m.moves[m.choiceLock]];
  if (acts.length === 0) acts = [STRUGGLE];
  return acts;
}

interface PendingBranch {
  p: number;
  state: PlanState;
  done: boolean; // battle over in this branch
}

/**
 * Simulate one turn: both sides commit (moveA, moveB); returns chance branches.
 * Branches with p < 0.02 are pruned and the rest renormalized.
 */
export function step(state: PlanState, moveA: PlanMove, moveB: PlanMove): Branch[] {
  const moves: [PlanMove, PlanMove] = [moveA, moveB];

  // Order determination
  const prio: [number, number] = [movePriority(state, 0, moveA), movePriority(state, 1, moveB)];
  const spe: [number, number] = [effectiveSpeed(state, 0), effectiveSpeed(state, 1)];
  const tr = state.trickRoom > 0;
  let orders: Array<{ p: number; order: [number, number] }>;
  if (prio[0] !== prio[1]) {
    orders = [{ p: 1, order: prio[0] > prio[1] ? [0, 1] : [1, 0] }];
  } else if (spe[0] !== spe[1]) {
    const faster = (spe[0] > spe[1]) !== tr ? 0 : 1;
    orders = [{ p: 1, order: faster === 0 ? [0, 1] : [1, 0] }];
  } else {
    orders = [
      { p: 0.5, order: [0, 1] },
      { p: 0.5, order: [1, 0] },
    ];
  }

  let branches: PendingBranch[] = [];
  for (const o of orders) {
    const start: PendingBranch = { p: o.p, state: cloneState(state), done: false };
    let current = [start];
    for (const actor of o.order) {
      const next: PendingBranch[] = [];
      for (const br of current) {
        if (br.done) { next.push(br); continue; }
        next.push(...applyAction(br, actor, moves[actor], moves[1 - actor], o.order[0] === actor));
      }
      current = next;
    }
    // end-of-turn residuals
    for (const br of current) {
      if (!br.done) applyResiduals(br);
    }
    branches.push(...current);
  }

  // prune + renormalize
  branches = branches.filter((b) => b.p >= 0.02);
  const total = branches.reduce((s, b) => s + b.p, 0);
  for (const b of branches) b.p /= total;
  return branches.map((b) => ({ p: b.p, state: b.state }));
}

function applyAction(
  br: PendingBranch, actor: number, move: PlanMove, oppMove: PlanMove, actsFirst: boolean,
): PendingBranch[] {
  const s = br.state;
  const me = s.mons[actor];
  const opp = s.mons[1 - actor];

  if (me.hp <= 0 || me.flinched) return [br];

  // sleep: skip turns while asleep
  if (me.status === 'slp' && me.slpTurns > 0) {
    me.slpTurns--;
    if (me.slpTurns <= 0) me.status = '';
    return [br];
  }

  if (move.isRecharge) {
    me.mustRecharge = false;
    return [br];
  }

  // charge turn (Solar Beam out of sun etc.)
  const moveIdx = me.moves.indexOf(move);
  if (move.isCharge && me.charging < 0 && s.weather !== move.chargeSkipWeather) {
    me.charging = moveIdx;
    if (move.id === 'electroshot') me.boosts.spa = Math.min(6, me.boosts.spa + 1);
    return [br];
  }
  if (me.charging === moveIdx) me.charging = -1;

  // PP
  if (moveIdx >= 0 && me.pp[moveIdx] > 0) me.pp[moveIdx]--;
  if (me.item.startsWith('Choice') && moveIdx >= 0) me.choiceLock = moveIdx;

  // Protect family
  if (move.isProtect) {
    const successP = Math.pow(1 / 3, me.stall);
    // Branch on success only when it matters (opp is attacking us this turn)
    const out: PendingBranch[] = [];
    const succ: PendingBranch = { p: br.p * successP, state: cloneState(s), done: false };
    succ.state.mons[actor].protectedNow = true;
    succ.state.mons[actor].stall = Math.min(3, me.stall + 1);
    out.push(succ);
    if (successP < 1) {
      const fail: PendingBranch = { p: br.p * (1 - successP), state: s === br.state ? br.state : cloneState(s), done: false };
      fail.state.mons[actor].stall = 0;
      out.push(fail);
    }
    return out;
  }
  me.stall = 0;

  if (move.isNoOp || move.category === 'Status' && move.isNoOp) return [br];

  // Fake Out: fails after first turn out
  if (move.isFakeOut && me.turnsOut > 0) return [br];

  // Sucker Punch: fails unless acting first and opponent chose a damaging move
  if (move.isSucker && (!actsFirst || oppMove.category === 'Status' || oppMove.isRecharge)) return [br];

  // Status / self-boost / heal moves
  if (move.category === 'Status') {
    if (move.id === 'strengthsap') {
      const oppAtk = Math.floor(opp.maxhp * 0.7 * BOOST_TABLE[opp.boosts.atk + 6]); // rough: heal ≈ opp Atk stat
      me.hp = Math.min(me.maxhp, me.hp + oppAtk);
      opp.boosts.atk = Math.max(-6, opp.boosts.atk - 1);
      return [br];
    }
    if (move.id === 'clangoroussoul') {
      if (me.hp > me.maxhp / 3) {
        me.hp -= Math.floor(me.maxhp / 3);
        for (const st of ['atk', 'def', 'spa', 'spd', 'spe'] as const) {
          me.boosts[st] = Math.min(6, me.boosts[st] + 1);
        }
      }
      return [br];
    }
    if (move.heal > 0 || move.weatherHeal) {
      let frac = move.heal;
      if (move.weatherHeal) frac = s.weather === 'sun' ? 2 / 3 : s.weather ? 0.25 : 0.5;
      me.hp = Math.min(me.maxhp, me.hp + Math.floor(me.maxhp * frac));
      return [br];
    }
    if (move.selfBoosts) {
      for (const [st, v] of Object.entries(move.selfBoosts)) {
        const key = st as keyof PlanMon['boosts'];
        if (key in me.boosts) me.boosts[key] = Math.max(-6, Math.min(6, me.boosts[key] + (v as number)));
      }
      return [br];
    }
    // targeted status / stat-drop moves — blocked by protect, sound bypasses? (status moves don't bypass)
    if (opp.protectedNow || opp.hp <= 0) return [br];
    if (move.targetBoosts) {
      if (opp.abilityId !== 'goodasgold' && opp.abilityId !== 'clearbody' && opp.abilityId !== 'whitesmoke' && opp.abilityId !== 'fullmetalbody') {
        const acc = move.accuracy;
        const apply = (branch: PendingBranch) => {
          const o = branch.state.mons[1 - actor];
          for (const [st, v] of Object.entries(move.targetBoosts!)) {
            const key = st as keyof PlanMon['boosts'];
            if (key in o.boosts) o.boosts[key] = Math.max(-6, Math.min(6, o.boosts[key] + (v as number)));
          }
        };
        if (acc >= 1) { apply(br); return [br]; }
        const hitBr: PendingBranch = { p: br.p * acc, state: cloneState(s), done: false };
        apply(hitBr);
        const missBr: PendingBranch = { p: br.p * (1 - acc), state: br.state, done: false };
        return [hitBr, missBr];
      }
      return [br];
    }
    if (move.status) {
      if (!canBeStatused(s, 1 - actor, move.status, move)) return [br];
      const acc = move.accuracy;
      const applyStatus = (branch: PendingBranch) => {
        const o = branch.state.mons[1 - actor];
        o.status = move.status;
        if (move.status === 'slp') o.slpTurns = 2;
        if (move.status === 'tox') o.toxTurns = 0;
      };
      if (acc >= 1) { applyStatus(br); return [br]; }
      const hitBr: PendingBranch = { p: br.p * acc, state: cloneState(s), done: false };
      applyStatus(hitBr);
      const missBr: PendingBranch = { p: br.p * (1 - acc), state: br.state, done: false };
      return [hitBr, missBr];
    }
    return [br];
  }

  // ----- damaging move -----
  if (opp.hp <= 0) return [br];
  if (opp.protectedNow && !move.breaksProtect) return [br];

  // Priority blocked by Psychic Terrain (grounded target) / immunities like Dazzling
  if (movePriority(s, actor, move) > 0 && s.terrain === 'psychic' && opp.grounded) return [br];
  const oppAb = opp.abilityId;
  if ((oppAb === 'dazzling' || oppAb === 'queenlymajesty' || oppAb === 'armortail') && movePriority(s, actor, move) > 0) return [br];
  if (oppAb === 'soundproof' && move.sound) return [br];

  let hitP = move.accuracy;
  if (me.abilityId === 'noguard' || oppAb === 'noguard') hitP = 1;
  if (move.id === 'blizzard' && s.weather === 'snow') hitP = 1;
  if ((move.id === 'thunder' || move.id === 'hurricane')) {
    if (s.weather === 'rain') hitP = 1;
    else if (s.weather === 'sun') hitP = 0.5;
  }
  // fold full paralysis into action probability
  if (me.status === 'par') hitP *= 0.75;

  const entry = calcDamage(s, actor, moveIdx, move.isStruggle ? STRUGGLE : move);
  const rolls = entry.rolls;
  const koRolls = rolls.filter((r) => r >= opp.hp).length;
  const pKO = koRolls / rolls.length;
  const nonKO = rolls.filter((r) => r < opp.hp);
  const meanNonKO = nonKO.length ? nonKO.reduce((a, b) => a + b, 0) / nonKO.length : 0;

  const out: PendingBranch[] = [];

  const applyHit = (branch: PendingBranch, dmg: number, ko: boolean) => {
    const bs = branch.state;
    const bMe = bs.mons[actor];
    const bOpp = bs.mons[1 - actor];
    const dealt = ko ? bOpp.hp : Math.min(bOpp.hp - 1, Math.floor(dmg)); // non-KO branch can't take HP to 0
    bOpp.hp -= dealt;
    if (ko) bOpp.hp = 0;
    // drain / recoil / struggle recoil / life orb
    if (move.drain > 0) bMe.hp = Math.min(bMe.maxhp, bMe.hp + Math.floor(dealt * move.drain));
    if (move.recoil > 0) bMe.hp -= Math.floor(dealt * move.recoil);
    if (move.isStruggle) bMe.hp -= Math.floor(bMe.maxhp / 4);
    if (bMe.item === 'Life Orb') bMe.hp -= Math.floor(bMe.maxhp / 10);
    if (move.selfRecharge && dealt > 0) bMe.mustRecharge = true;
    if (move.selfBoosts) {
      for (const [st, v] of Object.entries(move.selfBoosts)) {
        const key = st as keyof PlanMon['boosts'];
        if (key in bMe.boosts) bMe.boosts[key] = Math.max(-6, Math.min(6, bMe.boosts[key] + (v as number)));
      }
    }
    if (move.isFakeOut && !ko) bOpp.flinched = true;
    if (bMe.hp <= 0) bMe.hp = 0;
    if (bMe.hp <= 0 || bOpp.hp <= 0) {
      // don't mark done yet — other actor may still act if alive; done only when both relevant
    }
  };

  if (hitP < 1) {
    out.push({ p: br.p * (1 - hitP), state: br.state, done: false }); // miss: state unchanged
    if (move.crashOnMiss > 0) {
      const missState = out[out.length - 1].state.mons[actor];
      missState.hp = Math.max(0, missState.hp - Math.floor(missState.maxhp * move.crashOnMiss));
    }
  }
  if (pKO > 0) {
    const koBr: PendingBranch = { p: br.p * hitP * pKO, state: cloneState(s), done: false };
    applyHit(koBr, 0, true);
    out.push(koBr);
  }
  if (pKO < 1) {
    const hitBr: PendingBranch = { p: br.p * hitP * (1 - pKO), state: cloneState(s), done: false };
    applyHit(hitBr, meanNonKO, false);
    out.push(hitBr);
  }
  return out;
}

function applyResiduals(br: PendingBranch): void {
  const s = br.state;
  // weather chip + timers
  if (s.weather === 'sand') {
    for (const m of s.mons) {
      if (m.hp <= 0) continue;
      const immuneType = m.types.some((t) => t === 'Rock' || t === 'Ground' || t === 'Steel');
      const immuneAb = ['sandrush', 'sandforce', 'sandveil', 'magicguard', 'overcoat'].includes(m.abilityId);
      if (!immuneType && !immuneAb) m.hp = Math.max(0, m.hp - Math.floor(m.maxhp / 16));
    }
  }
  if (s.weatherTurns > 0 && --s.weatherTurns === 0) s.weather = '';
  if (s.terrain === 'grassy') {
    for (const m of s.mons) {
      if (m.hp > 0 && m.grounded) m.hp = Math.min(m.maxhp, m.hp + Math.floor(m.maxhp / 16));
    }
  }
  if (s.terrainTurns > 0 && --s.terrainTurns === 0) s.terrain = '';
  if (s.trickRoom > 0) s.trickRoom--;
  for (const i of [0, 1] as const) {
    if (s.tailwind[i] > 0) s.tailwind[i]--;
    if (s.screens[i].reflect > 0) s.screens[i].reflect--;
    if (s.screens[i].lightScreen > 0) s.screens[i].lightScreen--;
  }
  // status residuals
  for (const m of s.mons) {
    if (m.hp <= 0) continue;
    if (m.status === 'brn' && m.abilityId !== 'magicguard') m.hp = Math.max(0, m.hp - Math.floor(m.maxhp / 16));
    if (m.status === 'psn' && m.abilityId !== 'magicguard' && m.abilityId !== 'poisonheal') m.hp = Math.max(0, m.hp - Math.floor(m.maxhp / 8));
    if (m.status === 'tox' && m.abilityId !== 'magicguard' && m.abilityId !== 'poisonheal') {
      m.toxTurns++;
      m.hp = Math.max(0, m.hp - Math.floor((m.maxhp * m.toxTurns) / 16));
    }
  }
  // leech seed
  for (const i of [0, 1] as const) {
    const m = s.mons[i];
    const o = s.mons[1 - i];
    if (m.leechSeed && m.hp > 0 && o.hp > 0) {
      const drained = Math.floor(m.maxhp / 8);
      m.hp = Math.max(0, m.hp - drained);
      o.hp = Math.min(o.maxhp, o.hp + drained);
    }
  }
  // transient flags reset
  for (const i of [0, 1] as const) {
    const m = s.mons[i];
    m.protectedNow = false;
    m.flinched = false;
    m.turnsOut++;
  }
}

// ---------------------------------------------------------------------------
// Terminal + evaluation
// ---------------------------------------------------------------------------

/** 1 = A won, 0 = A lost, 0.5 = draw, null = ongoing. */
export function terminalValue(state: PlanState): number | null {
  const aDead = state.mons[0].hp <= 0;
  const bDead = state.mons[1].hp <= 0;
  if (aDead && bDead) return 0.5;
  if (bDead) return 1;
  if (aDead) return 0;
  return null;
}

function usefulBoostTerm(state: PlanState, i: number): number {
  const m = state.mons[i];
  const opp = state.mons[1 - i];
  // offensive category actually used by this mon's damaging moves
  let phys = 0, spec = 0;
  for (const mv of m.moves) {
    if (mv.category === 'Physical') phys++;
    else if (mv.category === 'Special') spec++;
  }
  let term = 0;
  if (phys >= spec) term += m.boosts.atk;
  if (spec >= phys) term += m.boosts.spa;
  term += (m.boosts.def + m.boosts.spd) * 0.35;
  // speed only counts while it changes the order
  const mySpe = effectiveSpeed(state, i);
  const oppSpe = effectiveSpeed(state, 1 - i);
  if (m.boosts.spe > 0 && mySpe > oppSpe) term += 0.75;
  if (m.boosts.spe < 0 && mySpe < oppSpe) term -= 0.75;
  void opp;
  return Math.max(-4, Math.min(4, term));
}

function statusTerm(state: PlanState, i: number): number {
  const m = state.mons[i];
  switch (m.status) {
    case 'brn': return -0.10;
    case 'par': return -0.08;
    case 'tox': return -0.06 * (1 + m.toxTurns);
    case 'psn': return -0.08;
    case 'slp': return -0.15 * m.slpTurns;
    case 'frz': return -0.20;
    default: return 0;
  }
}

/**
 * Best expected per-turn damage (absolute HP) side i can deal right now:
 * max over damaging moves with PP of mean rolls × accuracy. Uses the same
 * memoized calc as step(), so state-dependent modifiers (burn, boosts,
 * weather, screens) are priced in.
 */
function bestPerTurnDamage(state: PlanState, i: number): number {
  const m = state.mons[i];
  let best = 0;
  for (let idx = 0; idx < m.moves.length; idx++) {
    const mv = m.moves[idx];
    if (mv.category === 'Status' || m.pp[idx] <= 0) continue;
    if (mv.isSucker) continue; // conditional — don't count as a reliable race move
    const rolls = calcDamage(state, i, idx, mv).rolls;
    const mean = rolls.reduce((a, b) => a + b, 0) / rolls.length;
    let acc = mv.accuracy;
    if (m.status === 'par') acc *= 0.75;
    // charge moves take 2 turns outside their weather → half rate
    if (mv.isCharge && state.weather !== mv.chargeSkipWeather) acc *= 0.5;
    if (mv.selfRecharge) acc *= 0.5;
    const exp = mean * acc;
    if (exp > best) best = exp;
  }
  return best;
}

/**
 * Heuristic leaf evaluation: P(A wins)-like score in [0, 1].
 *
 * Core signal is the KO race (docs/policy-design.md §3.2): expected
 * turns-to-KO for each side from the current state, with the speed edge
 * breaking ties. This prices Will-O-Wisp (halves the opponent's race speed)
 * and de-prices Protect stalling (delay doesn't change the race) — a plain
 * HP-difference eval gets both wrong via the horizon effect.
 */
export function evaluate(state: PlanState): number {
  const t = terminalValue(state);
  if (t !== null) return t;
  const hpA = state.mons[0].hp / state.mons[0].maxhp;
  const hpB = state.mons[1].hp / state.mons[1].maxhp;

  const dmgA = bestPerTurnDamage(state, 0);
  const dmgB = bestPerTurnDamage(state, 1);
  const ttkA = dmgA > 0 ? Math.ceil(state.mons[1].hp / dmgA) : 30; // A's turns to KO B
  const ttkB = dmgB > 0 ? Math.ceil(state.mons[0].hp / dmgB) : 30;
  const speA = effectiveSpeed(state, 0);
  const speB = effectiveSpeed(state, 1);
  const tr = state.trickRoom > 0;
  const speedEdge = speA === speB ? 0 : ((speA > speB) !== tr ? 0.5 : -0.5);

  const x =
    0.8 * Math.max(-4, Math.min(4, ttkB - ttkA)) +
    0.6 * speedEdge +
    0.5 * (hpA - hpB) +
    0.06 * (usefulBoostTerm(state, 0) - usefulBoostTerm(state, 1)) +
    0.5 * (statusTerm(state, 0) - statusTerm(state, 1));
  return 0.5 + 0.5 * Math.tanh(x);
}

/** Compact state key for the per-decision transposition table. */
export function stateKey(state: PlanState): string {
  const monKey = (m: PlanMon) =>
    `${m.hp},${m.boosts.atk},${m.boosts.def},${m.boosts.spa},${m.boosts.spd},${m.boosts.spe},` +
    `${m.status},${m.toxTurns},${m.slpTurns},${m.stall},${m.choiceLock},${m.turnsOut > 0 ? 1 : 0},` +
    `${m.mustRecharge ? 1 : 0},${m.charging},${m.pp.join('.')}`;
  return `${monKey(state.mons[0])}|${monKey(state.mons[1])}|${state.weather}${state.weatherTurns},` +
    `${state.terrain}${state.terrainTurns},${state.trickRoom},${state.tailwind},` +
    `${state.screens[0].reflect},${state.screens[0].lightScreen},${state.screens[1].reflect},${state.screens[1].lightScreen}`;
}

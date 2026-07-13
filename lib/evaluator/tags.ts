/**
 * lib/evaluator/tags.ts — the board-control inventory (SPEC-team-evaluator.md
 * Phase 4, as revised in D36): 10 categories, each defined as a *rule* over
 * the exported move metadata plus a curated supplement for semantics the data
 * lacks (mostly abilities and items).
 *
 * Curated names are validated against the Champions dex: entries the dex
 * lacks are dropped (validateCurated reports them; the test suite asserts the
 * drop list matches EXPECTED_CURATED_DROPS exactly, in both directions).
 * Categories are independent rules over the same data, not a partition —
 * Grassy Terrain providers appear in both terrain control and healing by
 * design, while Fake Out (targeting control only) and Wide/Quick Guard
 * (option control only) are deliberate single-listings (D36).
 */
import {getMove, getSpecies, isDamaging, secondariesOf, toID} from './dex';
import type {DexMove, EvaluatorDex} from './dex';
import type {ParsedSet} from './parse';

/** Field states a conditional tag can depend on. */
export type FieldCondition =
  | 'sun' | 'rain' | 'sand' | 'snow'
  | 'grassy' | 'electric' | 'psychic' | 'misty';

export interface Tag {
  /** Cell text: the move / ability / item name (or a typing note). */
  name: string;
  kind: 'move' | 'ability' | 'item' | 'typing';
  /** Display sub-group within the category. */
  subGroup: string;
  annotation?: string;
  /** Set when the tag only works under a field condition the team must provide. */
  conditional?: FieldCondition;
  /** True when `conditional` is set and no team member provides it. */
  dimmed?: boolean;
}

export type CategoryId =
  | 'speed' | 'priority' | 'weather' | 'terrain' | 'targeting'
  | 'mitigation' | 'protect' | 'healing' | 'pivoting' | 'option';

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
  /** perMember[i] = tags contributed by sets[i]. */
  perMember: Tag[][];
}

// ---------------------------------------------------------------------------
// Curated tables (data, not conditionals — iterated by validation and UI).
// ---------------------------------------------------------------------------

interface CuratedAbility {
  name: string;
  annotation?: string;
  conditional?: FieldCondition;
}

const SPEED_ABILITIES: CuratedAbility[] = [
  {name: 'Quick Draw', annotation: '30% chance'},
  {name: 'Unburden', annotation: 'after item is used'},
  {name: 'Chlorophyll', conditional: 'sun', annotation: 'needs sun'},
  {name: 'Swift Swim', conditional: 'rain', annotation: 'needs rain'},
  {name: 'Sand Rush', conditional: 'sand', annotation: 'needs sand'},
  {name: 'Slush Rush', conditional: 'snow', annotation: 'needs snow'},
  {name: 'Surge Surfer', conditional: 'electric', annotation: 'needs Electric Terrain'},
  {name: 'Quark Drive', annotation: 'conditional'},
  {name: 'Protosynthesis', annotation: 'conditional'},
];
// Prankster is deliberately NOT here (D36: status-move priority is not
// board-level speed control); Gale Wings lives under priority.

const PRIORITY_ABILITIES: CuratedAbility[] = [
  {name: 'Gale Wings', annotation: 'full-HP Flying-move priority'},
];

/** Conditional-priority moves the derived rule misses (D36: Grassy Glide is
 * priority 0 in the Champions data; its +1 is granted in-battle). */
const PRIORITY_CONDITIONAL_MOVES: Array<{name: string; conditional: FieldCondition; annotation: string}> = [
  {name: 'Grassy Glide', conditional: 'grassy', annotation: '+1 in Grassy Terrain'},
];

const WEATHER_SETTER_ABILITIES: Array<CuratedAbility & {sets: FieldCondition}> = [
  {name: 'Drought', sets: 'sun'},
  {name: 'Drizzle', sets: 'rain'},
  {name: 'Sand Stream', sets: 'sand'},
  {name: 'Snow Warning', sets: 'snow'},
  {name: 'Orichalcum Pulse', sets: 'sun', annotation: 'sun + Atk boost'},
];

const WEATHER_NEUTRALIZER_ABILITIES: CuratedAbility[] = [
  {name: 'Cloud Nine', annotation: 'negates weather'},
  {name: 'Air Lock', annotation: 'negates weather'},
];

const TERRAIN_SETTER_ABILITIES: Array<CuratedAbility & {sets: FieldCondition}> = [
  {name: 'Grassy Surge', sets: 'grassy'},
  {name: 'Electric Surge', sets: 'electric'},
  {name: 'Psychic Surge', sets: 'psychic'},
  {name: 'Misty Surge', sets: 'misty'},
  {name: 'Seed Sower', sets: 'grassy', annotation: 'when hit'},
];

const TERRAIN_REMOVAL_MOVES: Array<{name: string; annotation: string}> = [
  {name: 'Ice Spinner', annotation: 'removes terrain'},
  {name: 'Steel Roller', annotation: 'removes terrain (fails without one)'},
];

const TARGETING_MOVES: Array<{name: string; annotation?: string}> = [
  {name: 'Fake Out', annotation: 'flinch pressure — its only category (D36)'},
  {name: 'Ally Switch', annotation: 'repositioning'},
];

const REDIRECT_IMMUNE_ABILITIES: CuratedAbility[] = [
  {name: 'Stalwart'},
  {name: 'Propeller Tail'},
];
const REDIRECT_IMMUNE_MOVES = ['Snipe Shot'];

const MITIGATION_ABILITIES: CuratedAbility[] = [
  {name: 'Intimidate'},
  {name: 'Friend Guard'},
  {name: 'Multiscale', annotation: 'at full HP'},
  {name: 'Fur Coat'},
  {name: 'Ice Scales'},
  {name: 'Fluffy', annotation: 'contact only'},
];

/** Protect-class volatiles (single-target self-protection). Wide/Quick Guard
 * are sideConditions and explicitly not Protect-class (D36). */
const PROTECT_VOLATILES = new Set([
  'protect', 'banefulbunker', 'burningbulwark', 'silktrap', 'spikyshield',
  'kingsshield', 'obstruct', 'maxguard',
]);
const PROTECT_RIDERS: Record<string, string> = {
  'Baneful Bunker': 'poisons on contact',
  'Spiky Shield': 'chips on contact',
  'Silk Trap': 'drops Spe on contact',
  'Burning Bulwark': 'burns on contact',
  "King's Shield": 'drops Atk on contact',
};

const HEALING_MOVES_CURATED: Array<{name: string; annotation: string}> = [
  {name: 'Leech Seed', annotation: 'per-turn drain'},
];

const HEALING_ABILITIES: CuratedAbility[] = [
  {name: 'Regenerator', annotation: 'heals on switch — pairs with pivoting'},
  {name: 'Poison Heal', annotation: 'while poisoned'},
  {name: 'Rain Dish', conditional: 'rain', annotation: 'needs rain'},
  {name: 'Ice Body', conditional: 'snow', annotation: 'needs snow'},
  {name: 'Dry Skin', conditional: 'rain', annotation: 'needs rain'},
];

const HEALING_ITEMS: Array<{name: string; annotation?: string}> = [
  {name: 'Leftovers'},
  {name: 'Black Sludge', annotation: 'Poison-types only'},
  {name: 'Shell Bell'},
  {name: 'Sitrus Berry', annotation: 'at ≤ ½ HP'},
  {name: 'Figy Berry', annotation: 'pinch berry'},
  {name: 'Wiki Berry', annotation: 'pinch berry'},
  {name: 'Mago Berry', annotation: 'pinch berry'},
  {name: 'Aguav Berry', annotation: 'pinch berry'},
  {name: 'Iapapa Berry', annotation: 'pinch berry'},
];

/** Option-denial volatiles: derived rule for Encore-class moves. */
const OPTION_VOLATILES = new Set(['encore', 'disable', 'taunt', 'torment', 'imprison', 'healblock']);

const OPTION_ABILITIES: CuratedAbility[] = [
  {name: 'Armor Tail', annotation: 'blocks priority'},
  {name: 'Dazzling', annotation: 'blocks priority'},
  {name: 'Queenly Majesty', annotation: 'blocks priority'},
  {name: 'Sweet Veil', annotation: 'blocks sleep (side)'},
  {name: 'Vital Spirit', annotation: 'blocks sleep (self)'},
  {name: 'Insomnia', annotation: 'blocks sleep (self)'},
  {name: 'Aroma Veil', annotation: 'blocks Taunt/Encore-class (side)'},
  {name: 'Oblivious', annotation: 'Taunt-immune'},
  {name: 'Own Tempo', annotation: 'Intimidate-immune'},
  {name: 'Inner Focus', annotation: 'Intimidate-immune'},
  {name: 'Scrappy', annotation: 'Intimidate-immune'},
  {name: 'Good as Gold', annotation: 'status-move immunity'},
  {name: 'Magic Bounce', annotation: 'reflects status moves'},
];

/**
 * Curated names verified absent from the Champions dex at spec time. The test
 * suite fails when validateCurated() diverges from this list in either
 * direction, so a closed dex gap forces a table review.
 */
export const EXPECTED_CURATED_DROPS = [
  'Aguav Berry', 'Air Lock', 'Black Sludge', 'Dazzling', 'Figy Berry',
  'Grassy Surge', 'Iapapa Berry', 'Ice Scales', 'Mago Berry', 'Misty Surge',
  'Orichalcum Pulse', 'Propeller Tail', 'Protosynthesis', 'Psychic Surge',
  'Quark Drive', 'Seed Sower', 'Wiki Berry',
];

/** Every curated name not in the given dex (sorted, deduped). */
export function validateCurated(dex: EvaluatorDex): string[] {
  const missing = new Set<string>();
  const ability = (n: string) => { if (!(toID(n) in dex.abilities)) missing.add(n); };
  const move = (n: string) => { if (!getMove(dex, n)) missing.add(n); };
  const item = (n: string) => { if (!(toID(n) in dex.items)) missing.add(n); };
  for (const a of [
    ...SPEED_ABILITIES, ...PRIORITY_ABILITIES, ...WEATHER_SETTER_ABILITIES,
    ...WEATHER_NEUTRALIZER_ABILITIES, ...TERRAIN_SETTER_ABILITIES,
    ...REDIRECT_IMMUNE_ABILITIES, ...MITIGATION_ABILITIES,
    ...HEALING_ABILITIES, ...OPTION_ABILITIES,
  ]) ability(a.name);
  for (const m of [
    ...PRIORITY_CONDITIONAL_MOVES, ...TERRAIN_REMOVAL_MOVES,
    ...TARGETING_MOVES, ...HEALING_MOVES_CURATED,
  ]) move(m.name);
  for (const m of REDIRECT_IMMUNE_MOVES) move(m);
  for (const i of HEALING_ITEMS) item(i.name);
  return [...missing].sort();
}

// ---------------------------------------------------------------------------
// Rule helpers over exported move metadata.
// ---------------------------------------------------------------------------

/** A guaranteed rider: any secondary at 100% chance (target or self). */
export function hasFullSecondary(move: DexMove): boolean {
  return secondariesOf(move).some((s) => s.chance >= 100);
}

/** 100%-chance drop of the given target stat (Icy Wind spe, Snarl spa, …). */
function fullTargetDrop(move: DexMove, stats: Array<'atk' | 'spa' | 'spe'>): boolean {
  if (move.category === 'Status') {
    return move.target !== 'self' && stats.some((s) => (move.boosts?.[s] ?? 0) < 0);
  }
  return secondariesOf(move).some(
    (sec) => sec.chance >= 100 && stats.some((s) => (sec.boosts?.[s] ?? 0) < 0),
  );
}

/** 100%-chance infliction of the given status (Thunder Wave par, Nuzzle par). */
function fullStatus(move: DexMove, status: string): boolean {
  if (move.status === status && move.category === 'Status') return true;
  return secondariesOf(move).some((sec) => sec.chance >= 100 && sec.status === status);
}

const WEATHER_MOVE_CONDITION: Record<string, FieldCondition> = {
  sunnyday: 'sun', raindance: 'rain', sandstorm: 'sand', snowscape: 'snow', hail: 'snow',
};
const TERRAIN_MOVE_CONDITION: Record<string, FieldCondition> = {
  grassyterrain: 'grassy', electricterrain: 'electric',
  psychicterrain: 'psychic', mistyterrain: 'misty',
};

/** Field conditions the team can put up itself (moves + setter abilities). */
export function providedConditions(dex: EvaluatorDex, sets: ParsedSet[]): Set<FieldCondition> {
  const provided = new Set<FieldCondition>();
  for (const set of sets) {
    for (const table of [WEATHER_SETTER_ABILITIES, TERRAIN_SETTER_ABILITIES]) {
      for (const a of table) {
        if (toID(a.name) === toID(set.ability) && toID(a.name) in dex.abilities) provided.add(a.sets);
      }
    }
    for (const name of set.moves) {
      const move = getMove(dex, name);
      if (!move) continue;
      if (move.weather && WEATHER_MOVE_CONDITION[move.weather]) provided.add(WEATHER_MOVE_CONDITION[move.weather]);
      if (move.terrain && TERRAIN_MOVE_CONDITION[move.terrain]) provided.add(TERRAIN_MOVE_CONDITION[move.terrain]);
    }
  }
  return provided;
}

// ---------------------------------------------------------------------------
// The inventory.
// ---------------------------------------------------------------------------

const CATEGORY_META: Array<{id: CategoryId; label: string; description: string}> = [
  {id: 'speed', label: 'Speed control', description: 'Speed drops, Tailwind, Trick Room, paralysis, speed abilities.'},
  {id: 'priority', label: 'Priority', description: 'Damage-first priority moves (guaranteed-rider moves like Fake Out are targeting control).'},
  {id: 'weather', label: 'Weather control', description: 'Weather setters and neutralizers.'},
  {id: 'terrain', label: 'Terrain control', description: 'Terrain setters and removal.'},
  {id: 'targeting', label: 'Targeting control', description: 'Redirection, Fake Out pressure, redirection immunity.'},
  {id: 'mitigation', label: 'Damage mitigation', description: 'Screens, offensive-stat drops, burn, defensive self-boosts, abilities.'},
  {id: 'protect', label: 'Protect moves', description: 'Single-target self-protection; members without one are flagged.'},
  {id: 'healing', label: 'Healing', description: 'Recovery moves, drain attacks, abilities, items, field.'},
  {id: 'pivoting', label: 'Pivoting', description: 'Self-switching and opponent force-switching moves only (D36).'},
  {id: 'option', label: 'Option control', description: 'Denying the opponent choices: Encore-class, guards, blocking abilities.'},
];

function abilityTags(set: ParsedSet, dex: EvaluatorDex, table: CuratedAbility[], subGroup: string): Tag[] {
  return table
    .filter((a) => toID(a.name) in dex.abilities && toID(a.name) === toID(set.ability))
    .map((a) => ({
      name: a.name, kind: 'ability' as const, subGroup,
      annotation: a.annotation, conditional: a.conditional,
    }));
}

function memberTags(dex: EvaluatorDex, set: ParsedSet): Record<CategoryId, Tag[]> {
  const out: Record<CategoryId, Tag[]> = {
    speed: [], priority: [], weather: [], terrain: [], targeting: [],
    mitigation: [], protect: [], healing: [], pivoting: [], option: [],
  };
  const moves = set.moves.map((m) => getMove(dex, m)).filter((m): m is DexMove => !!m);

  for (const move of moves) {
    const tag = (subGroup: string, annotation?: string, conditional?: FieldCondition): Tag =>
      ({name: move.name, kind: 'move', subGroup, annotation, conditional});

    // 1. speed control
    if (fullTargetDrop(move, ['spe'])) out.speed.push(tag('speed drops'));
    if (move.sideCondition === 'tailwind') out.speed.push(tag('Tailwind'));
    if (move.pseudoWeather === 'trickroom') out.speed.push(tag('Trick Room'));
    if (fullStatus(move, 'par')) out.speed.push(tag('paralysis'));

    // 2. priority (damage-first: no guaranteed rider)
    if (isDamaging(move) && move.priority > 0 && !hasFullSecondary(move)) {
      out.priority.push(tag('moves', move.name === 'Sucker Punch' ? 'fails vs non-attacking targets' : undefined));
    }
    const condPrio = PRIORITY_CONDITIONAL_MOVES.find((m) => toID(m.name) === toID(move.name));
    if (condPrio) out.priority.push(tag('moves', condPrio.annotation, condPrio.conditional));

    // 3–4. weather / terrain moves
    if (move.weather && WEATHER_MOVE_CONDITION[move.weather]) {
      out.weather.push(tag('moves'));
    }
    if (move.terrain && TERRAIN_MOVE_CONDITION[move.terrain]) {
      const t = tag('moves');
      out.terrain.push(t);
      if (move.terrain === 'grassyterrain') {
        out.healing.push({...tag('field', 'passive team healing (grounded)')});
      }
      if (move.terrain === 'electricterrain') t.annotation = 'also blocks sleep (grounded)';
      if (move.terrain === 'mistyterrain') t.annotation = 'also blocks status (grounded)';
    }
    const removal = TERRAIN_REMOVAL_MOVES.find((m) => toID(m.name) === toID(move.name));
    if (removal) out.terrain.push(tag('removal', removal.annotation));

    // 5. targeting control
    if (move.volatileStatus === 'followme' || move.volatileStatus === 'ragepowder') {
      out.targeting.push(tag('redirection'));
    }
    const curTarget = TARGETING_MOVES.find((m) => toID(m.name) === toID(move.name));
    if (curTarget) out.targeting.push(tag('pressure', curTarget.annotation));
    if (REDIRECT_IMMUNE_MOVES.some((m) => toID(m) === toID(move.name))) {
      out.targeting.push(tag('ignores redirection'));
    }

    // 6. damage mitigation
    if (['reflect', 'lightscreen', 'auroraveil'].includes(move.sideCondition ?? '')) {
      out.mitigation.push(tag('screens'));
    }
    if (fullTargetDrop(move, ['atk', 'spa'])) out.mitigation.push(tag('stat drops'));
    if (move.category === 'Status' && move.status === 'brn') out.mitigation.push(tag('burn'));
    if (move.category === 'Status' && move.target === 'self' &&
        ((move.boosts?.def ?? 0) >= 2 || (move.boosts?.spd ?? 0) >= 2)) {
      out.mitigation.push(tag('self-boosts'));
    }

    // 7. Protect moves
    if (move.volatileStatus && PROTECT_VOLATILES.has(move.volatileStatus) && move.target === 'self') {
      out.protect.push(tag('moves', PROTECT_RIDERS[move.name]));
    }

    // 8. healing
    if (move.category === 'Status' && (move.heal || move.healFlag)) {
      out.healing.push(tag('recovery', move.name === 'Rest' ? '2-turn sleep' : undefined));
    }
    if (isDamaging(move) && move.drain) {
      out.healing.push(tag('drain', `${Math.round((move.drain[0] / move.drain[1]) * 100)}% of damage`));
    }
    if (HEALING_MOVES_CURATED.some((m) => toID(m.name) === toID(move.name))) {
      out.healing.push(tag('recovery', HEALING_MOVES_CURATED.find((m) => toID(m.name) === toID(move.name))!.annotation));
    }

    // 9. pivoting (rule only — D36)
    if (move.selfSwitch) out.pivoting.push(tag('self-switch'));
    if (move.forceSwitch) out.pivoting.push(tag('force-switch'));

    // 10. option control
    if (move.volatileStatus && OPTION_VOLATILES.has(move.volatileStatus) && move.target !== 'self') {
      out.option.push(tag('Encore-class'));
    }
    if (move.volatileStatus === 'imprison') out.option.push(tag('Encore-class'));
    if (move.sideCondition === 'wideguard') out.option.push(tag('guards', 'blocks spread moves — its only category (D36)'));
    if (move.sideCondition === 'quickguard') out.option.push(tag('guards', 'blocks priority — its only category (D36)'));
  }

  // ability-driven tags
  out.speed.push(...abilityTags(set, dex, SPEED_ABILITIES, 'abilities'));
  out.priority.push(...abilityTags(set, dex, PRIORITY_ABILITIES, 'abilities'));
  out.weather.push(...abilityTags(set, dex, WEATHER_SETTER_ABILITIES, 'setters'));
  out.weather.push(...abilityTags(set, dex, WEATHER_NEUTRALIZER_ABILITIES, 'neutralizers'));
  for (const t of abilityTags(set, dex, TERRAIN_SETTER_ABILITIES, 'setters')) {
    out.terrain.push(t);
    const setter = TERRAIN_SETTER_ABILITIES.find((a) => toID(a.name) === toID(t.name));
    if (setter?.sets === 'grassy') {
      out.healing.push({...t, subGroup: 'field', annotation: 'passive team healing (grounded)'});
    }
  }
  out.targeting.push(...abilityTags(set, dex, REDIRECT_IMMUNE_ABILITIES, 'ignores redirection'));
  out.mitigation.push(...abilityTags(set, dex, MITIGATION_ABILITIES, 'abilities'));
  out.healing.push(...abilityTags(set, dex, HEALING_ABILITIES, 'abilities'));
  out.option.push(...abilityTags(set, dex, OPTION_ABILITIES, 'abilities'));

  // typing-driven: Grass-types ignore Rage Powder
  const spec = getSpecies(dex, set.battleSpecies) ?? getSpecies(dex, set.species);
  if (spec?.types.includes('Grass')) {
    out.targeting.push({
      name: 'Grass typing', kind: 'typing', subGroup: 'ignores redirection',
      annotation: 'immune to Rage Powder',
    });
  }

  // item-driven: healing items
  if (set.item) {
    const it = HEALING_ITEMS.find((i) => toID(i.name) === toID(set.item!));
    if (it && toID(it.name) in dex.items) {
      out.healing.push({name: it.name, kind: 'item', subGroup: 'items', annotation: it.annotation});
    }
  }

  return out;
}

/** The full inventory: 10 categories × team members. */
export function boardControl(dex: EvaluatorDex, sets: ParsedSet[]): Category[] {
  const provided = providedConditions(dex, sets);
  const all = sets.map((set) => memberTags(dex, set));
  return CATEGORY_META.map(({id, label, description}) => ({
    id, label, description,
    perMember: all.map((tags) => tags[id].map((t) => ({
      ...t,
      dimmed: t.conditional ? !provided.has(t.conditional) : undefined,
    }))),
  }));
}

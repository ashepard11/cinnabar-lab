/**
 * lib/effects.ts — the one effect taxonomy (BACKLOG item 11).
 *
 * A curated table mapping abilities, moves and items to what they do, plus the
 * category and display-grouping vocabulary built on it. The evaluator's board
 * control inventory and the teambuilder's enabler catalog are the same question
 * asked twice — "what does this Pokémon bring besides damage" — and they must
 * answer it with the same words.
 *
 * This was `lib/evaluator/tags.ts` (item 08). The teambuilder then needed the
 * same vocabulary for Phase 1's support pills and hand-mirrored it into
 * `lib/teambuilder/types.ts`, so by the time this lift happened there were
 * three copies, not two: the lib categories, the evaluator's five display rows
 * in `BoardControlTable.tsx`, and the teambuilder's mirror of both. They had
 * already drifted — see `displayGroupFor` below on Wide and Quick Guard.
 *
 * Browser-safe by construction: no Node imports, and no dependency on the
 * evaluator's dex module. `validateCurated` takes a lookup interface rather
 * than an `EvaluatorDex` so the taxonomy does not drag the evaluator's data
 * layer into anything that imports it.
 *
 * What stayed behind in `lib/evaluator/tags.ts` is the *rule engine* — the
 * pass over parsed sets that turns moves into tags. That is coupled to
 * `ParsedSet` and `EvaluatorDex`, and the teambuilder works on `Variant`, so
 * sharing it needs an abstraction neither caller can justify yet. The data and
 * the vocabulary are what were duplicated; those are what moved.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Field states a conditional effect can depend on. */
export type FieldCondition =
  | 'sun' | 'rain' | 'sand' | 'snow'
  | 'grassy' | 'electric' | 'psychic' | 'misty';

/**
 * The full category set. The evaluator uses all ten; the teambuilder uses nine
 * (see `TEAMBUILDER_CATEGORIES`).
 */
export type EffectCategory =
  | 'speed' | 'priority' | 'weather' | 'terrain' | 'targeting'
  | 'mitigation' | 'protect' | 'healing' | 'pivoting' | 'option';

export const CATEGORY_META: Array<{
  id: EffectCategory;
  label: string;
  description: string;
}> = [
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

export const CATEGORY_IDS: EffectCategory[] = CATEGORY_META.map((c) => c.id);

export const CATEGORY_LABELS: Record<EffectCategory, string> = Object.fromEntries(
  CATEGORY_META.map((c) => [c.id, c.label])
) as Record<EffectCategory, string>;

/**
 * The categories the teambuilder reasons about, as a narrowed type and the
 * matching runtime list.
 *
 * The type matters as much as the list. Before the taxonomy was shared, the
 * teambuilder declared its own nine-member union, so assigning `priority` to
 * one of its fields was a compile error. Re-exporting the full ten-member
 * union would have silently dropped that guarantee: the fixture generator
 * could emit `priority` and nothing would object, and `displayGroupFor` would
 * file it under Speed control without complaint. `lib/teambuilder/types.ts`
 * therefore re-exports `TeambuilderCategory` under the name `EffectCategory`,
 * which is what its screens have always meant by it.
 *
 * `priority` is deliberately absent. Damage priority is already inside a
 * Pokémon's own matchup numbers — the simulator plays Sucker Punch, so its
 * value is in the win rate — and crediting it again as an enabler would count
 * it twice. The evaluator has no matchup numbers behind its inventory, so for
 * it priority is real information. One taxonomy, two audiences; the difference
 * is stated here rather than encoded as a second list somewhere else.
 */
export type TeambuilderCategory = Exclude<EffectCategory, 'priority'>;

export const TEAMBUILDER_CATEGORIES: TeambuilderCategory[] = CATEGORY_IDS.filter(
  (c): c is TeambuilderCategory => c !== 'priority'
);

/**
 * Which categories change the fight a Pokémon is in, and which change whether
 * it can reach the fight.
 *
 * `mitigation` and `weather` appear in both, and that is not an oversight.
 * Intimidate, Reflect and Friend Guard are conditions in their own right and
 * they also cut a teammate's entry cost — SPEC-teambuilder.md Phase 6 lists all
 * three in its positioning-tool table.
 */
export const SUPPORT_CATEGORIES: EffectCategory[] = [
  'speed', 'weather', 'terrain', 'mitigation', 'healing', 'option',
];

export const POSITIONING_CATEGORIES: EffectCategory[] = [
  'pivoting', 'targeting', 'protect', 'mitigation', 'weather',
];

// ---------------------------------------------------------------------------
// Display grouping
// ---------------------------------------------------------------------------

export type DisplayGroupId = 'speed' | 'field' | 'option' | 'defense' | 'protect';

/**
 * The five rows effects are shown in (DECISIONS.md D38.3).
 *
 * Ten categories is the right granularity for the rules and too many for a
 * reader, so display consolidates. The Build screen renders the teambuilder's
 * support pills and the evaluator's board control table on one page, so they
 * have to group the same effects the same way — nobody should hold two
 * taxonomies for one roster.
 */
export const DISPLAY_GROUPS: Array<{
  id: DisplayGroupId;
  label: string;
  description: string;
  sources: EffectCategory[];
}> = [
  {
    id: 'speed', label: 'Speed control', sources: ['speed', 'priority'],
    description: 'Speed drops, Tailwind, Trick Room, paralysis, priority moves, speed abilities.',
  },
  {
    id: 'field', label: 'Field effects', sources: ['weather', 'terrain'],
    description: 'Weather and terrain setters, removal, and neutralizers.',
  },
  {
    id: 'option', label: 'Option control', sources: ['targeting', 'option'],
    description: 'Redirection, Fake Out pressure, Encore-class denial, blocking abilities.',
  },
  {
    id: 'defense', label: 'Defensive tools', sources: ['mitigation', 'healing', 'pivoting'],
    description: 'Damage mitigation, healing, and pivoting.',
  },
  {
    id: 'protect', label: 'Protects', sources: ['protect'],
    description: 'Protect-class moves plus Wide and Quick Guard; members without one are flagged.',
  },
];

/**
 * The display row an effect belongs to.
 *
 * `subGroup` carries the one case where the row is not a pure function of the
 * category: Wide Guard and Quick Guard are option control as a rule — they deny
 * the opponent a choice — but read as Protects to anyone scanning the table, so
 * D38.3 moved them. The evaluator's table implemented that rule and the
 * teambuilder's mirror did not, which is the concrete drift item 11 exists to
 * end. Callers without a subGroup get the category's row, which is correct for
 * every other effect.
 */
export function displayGroupFor(
  category: EffectCategory,
  subGroup?: string
): DisplayGroupId {
  if (category === 'option' && subGroup === 'guards') return 'protect';
  const group = DISPLAY_GROUPS.find((g) => g.sources.includes(category));
  if (!group) {
    throw new Error(`effect category ${category} belongs to no display group`);
  }
  return group.id;
}

export function displayGroupLabel(id: DisplayGroupId): string {
  return DISPLAY_GROUPS.find((g) => g.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Curated tables
// ---------------------------------------------------------------------------
//
// Semantics the exported move data does not carry — almost all of it abilities
// and items, plus the handful of moves whose effect is granted in-battle rather
// than declared. Rules over move metadata live with the engine that applies
// them; these are the facts no rule can derive.

export interface CuratedAbility {
  name: string;
  annotation?: string;
  conditional?: FieldCondition;
}

export const SPEED_ABILITIES: CuratedAbility[] = [
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

export const PRIORITY_ABILITIES: CuratedAbility[] = [
  {name: 'Gale Wings', annotation: 'full-HP Flying-move priority'},
];

/**
 * Conditional-priority moves the derived rule misses (D36: Grassy Glide is
 * priority 0 in the Champions data; its +1 is granted in-battle).
 */
export const PRIORITY_CONDITIONAL_MOVES: Array<{
  name: string;
  conditional: FieldCondition;
  annotation: string;
}> = [
  {name: 'Grassy Glide', conditional: 'grassy', annotation: '+1 in Grassy Terrain'},
];

export const WEATHER_SETTER_ABILITIES: Array<CuratedAbility & {sets: FieldCondition}> = [
  {name: 'Drought', sets: 'sun'},
  {name: 'Drizzle', sets: 'rain'},
  {name: 'Sand Stream', sets: 'sand'},
  {name: 'Snow Warning', sets: 'snow'},
  {name: 'Orichalcum Pulse', sets: 'sun', annotation: 'sun + Atk boost'},
];

export const WEATHER_NEUTRALIZER_ABILITIES: CuratedAbility[] = [
  {name: 'Cloud Nine', annotation: 'negates weather'},
  {name: 'Air Lock', annotation: 'negates weather'},
];

export const TERRAIN_SETTER_ABILITIES: Array<CuratedAbility & {sets: FieldCondition}> = [
  {name: 'Grassy Surge', sets: 'grassy'},
  {name: 'Electric Surge', sets: 'electric'},
  {name: 'Psychic Surge', sets: 'psychic'},
  {name: 'Misty Surge', sets: 'misty'},
  {name: 'Seed Sower', sets: 'grassy', annotation: 'when hit'},
];

export const TERRAIN_REMOVAL_MOVES: Array<{name: string; annotation: string}> = [
  {name: 'Ice Spinner', annotation: 'removes terrain'},
  {name: 'Steel Roller', annotation: 'removes terrain (fails without one)'},
];

export const TARGETING_MOVES: Array<{name: string; annotation?: string}> = [
  {name: 'Fake Out', annotation: 'flinch pressure — its only category (D36)'},
  {name: 'Ally Switch', annotation: 'repositioning'},
];

export const REDIRECT_IMMUNE_ABILITIES: CuratedAbility[] = [
  {name: 'Stalwart'},
  {name: 'Propeller Tail'},
];

export const REDIRECT_IMMUNE_MOVES = ['Snipe Shot'];

export const MITIGATION_ABILITIES: CuratedAbility[] = [
  {name: 'Intimidate'},
  {name: 'Friend Guard'},
  {name: 'Multiscale', annotation: 'at full HP'},
  {name: 'Fur Coat'},
  {name: 'Ice Scales'},
  {name: 'Fluffy', annotation: 'contact only'},
];

/**
 * Protect-class volatiles (single-target self-protection). Wide and Quick Guard
 * are sideConditions and explicitly not Protect-class as a rule (D36) — they
 * are grouped with Protects for display only, see `displayGroupFor`.
 */
export const PROTECT_VOLATILES = new Set([
  'protect', 'banefulbunker', 'burningbulwark', 'silktrap', 'spikyshield',
  'kingsshield', 'obstruct', 'maxguard',
]);

export const PROTECT_RIDERS: Record<string, string> = {
  'Baneful Bunker': 'poisons on contact',
  'Spiky Shield': 'chips on contact',
  'Silk Trap': 'drops Spe on contact',
  'Burning Bulwark': 'burns on contact',
  "King's Shield": 'drops Atk on contact',
};

export const HEALING_MOVES_CURATED: Array<{name: string; annotation: string}> = [
  {name: 'Leech Seed', annotation: 'per-turn drain'},
];

export const HEALING_ABILITIES: CuratedAbility[] = [
  {name: 'Regenerator', annotation: 'heals on switch — pairs with pivoting'},
  {name: 'Poison Heal', annotation: 'while poisoned'},
  {name: 'Rain Dish', conditional: 'rain', annotation: 'needs rain'},
  {name: 'Ice Body', conditional: 'snow', annotation: 'needs snow'},
  {name: 'Dry Skin', conditional: 'rain', annotation: 'needs rain'},
];

export const HEALING_ITEMS: Array<{name: string; annotation?: string}> = [
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

/** Option-denial volatiles: the rule for Encore-class moves. */
export const OPTION_VOLATILES = new Set([
  'encore', 'disable', 'taunt', 'torment', 'imprison', 'healblock',
]);

export const OPTION_ABILITIES: CuratedAbility[] = [
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

// ---------------------------------------------------------------------------
// Dex validation (the taxonomy-rot gate)
// ---------------------------------------------------------------------------

/**
 * Curated names verified absent from the Champions dex at spec time. The test
 * suite fails when `validateCurated` diverges from this list in either
 * direction, so a closed dex gap forces a table review rather than silently
 * enabling an entry nobody has checked.
 */
export const EXPECTED_CURATED_DROPS = [
  'Aguav Berry', 'Air Lock', 'Black Sludge', 'Dazzling', 'Figy Berry',
  'Grassy Surge', 'Iapapa Berry', 'Ice Scales', 'Mago Berry', 'Misty Surge',
  'Orichalcum Pulse', 'Propeller Tail', 'Protosynthesis', 'Psychic Surge',
  'Quark Drive', 'Seed Sower', 'Wiki Berry',
];

/**
 * What `validateCurated` needs to know about a dex.
 *
 * Deliberately narrower than `EvaluatorDex`: taking the whole thing would tie
 * this module to the evaluator's data layer and cost it browser-safety, for
 * three existence checks.
 */
export interface EffectDexLookup {
  hasAbility(name: string): boolean;
  hasMove(name: string): boolean;
  hasItem(name: string): boolean;
}

/** Every curated name the given dex does not have (sorted, deduped). */
export function validateCurated(dex: EffectDexLookup): string[] {
  const missing = new Set<string>();
  for (const a of [
    ...SPEED_ABILITIES, ...PRIORITY_ABILITIES, ...WEATHER_SETTER_ABILITIES,
    ...WEATHER_NEUTRALIZER_ABILITIES, ...TERRAIN_SETTER_ABILITIES,
    ...REDIRECT_IMMUNE_ABILITIES, ...MITIGATION_ABILITIES,
    ...HEALING_ABILITIES, ...OPTION_ABILITIES,
  ]) {
    if (!dex.hasAbility(a.name)) missing.add(a.name);
  }
  for (const m of [
    ...PRIORITY_CONDITIONAL_MOVES, ...TERRAIN_REMOVAL_MOVES,
    ...TARGETING_MOVES, ...HEALING_MOVES_CURATED,
  ]) {
    if (!dex.hasMove(m.name)) missing.add(m.name);
  }
  for (const m of REDIRECT_IMMUNE_MOVES) {
    if (!dex.hasMove(m)) missing.add(m);
  }
  for (const i of HEALING_ITEMS) {
    if (!dex.hasItem(i.name)) missing.add(i.name);
  }
  return [...missing].sort();
}

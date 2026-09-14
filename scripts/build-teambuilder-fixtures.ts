/**
 * scripts/build-teambuilder-fixtures.ts — one fixture file per teambuilder
 * contract, into data/fixtures/ (SPEC-teambuilder.md Phase 0).
 *
 * Run: npm run build-fixtures
 *
 * Phase 1 builds the interface against these before any pipeline exists, which
 * is the point: the shapes get exercised by something that has to render them
 * before they are expensive to change. Everything downstream is costly to
 * rebuild, so the exploratory work belongs here.
 *
 * Fixtures are derived from the real committed variants wherever possible —
 * real species, real weights, real content ids — so the interface is laid out
 * against plausible data rather than lorem ipsum. The numbers attached to them
 * (win probabilities, positioning scores) are invented and labelled as such.
 * Nothing here is a substitute for a real pipeline run.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {activeRegulationConfig} from '../lib/format-rules';
import type {
  Candidate,
  EffectCategory,
  EnablerRecord,
  PositioningTool,
  PresetSet,
  SuppliedCondition,
  EnablerTarget,
  MatchupCell,
  PositioningProfile,
  TeamScore,
  CustomSetDraft,
  ConditionDescriptor,
} from '../lib/teambuilder/types';
import type {Variant, VariantsData} from '../lib/types';

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_DIR = path.join(DATA_DIR, 'fixtures');

const rules = activeRegulationConfig();
const variants: VariantsData = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'defender-variants.json'), 'utf8')
);

const byWeight = [...variants.variants].sort((a, b) => b.weight - a.weight);
const pick = (n: number) => byWeight.slice(0, n);
const idOf = (v: Variant) => v.cid ?? v.id;

/** Deterministic pseudo-random in [0, 1), so fixtures are stable across runs. */
function stable(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const round = (n: number, places = 3) => Number(n.toFixed(places));

function write(name: string, payload: unknown): void {
  const file = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
  console.log(`  ${path.relative(process.cwd(), file)}`);
}

// --- conditions -------------------------------------------------------------

const conditions: ConditionDescriptor[] = [
  {id: 'fresh', kind: 'simulated', label: 'Both Pokémon at full health, no field effects'},
  {id: 'moves_first', kind: 'simulated', label: 'The measured Pokémon moves first'},
  {id: 'sun', kind: 'simulated', label: 'Harsh sunlight'},
  {id: 'rain', kind: 'simulated', label: 'Rain'},
  {id: 'snow', kind: 'simulated', label: 'Snow'},
  {id: 'sand', kind: 'simulated', label: 'Sandstorm'},
  {
    id: 'chip',
    kind: 'derived',
    label: 'Opponent entered already damaged',
    derives_from: 'final_hp_distribution',
  },
  {
    id: 'phys_mitigation',
    kind: 'simulated',
    label: 'Incoming physical damage reduced (extension roadmap, not in the v0 five)',
  },
];

// --- matchup cells ----------------------------------------------------------

function cell(a: Variant, b: Variant, condition: MatchupCell['condition']): MatchupCell {
  const p = round(0.2 + stable(`${a.id}:${b.id}:${condition}`) * 0.6);
  // Quantiles of remaining HP, so they must come back sorted ascending —
  // the consumers read them as a distribution, not as five loose numbers.
  const quantiles = (seed: string) =>
    [0.1, 0.3, 0.5, 0.7, 0.9]
      .map((q) => round(0.05 + stable(seed + q) * 0.9, 3))
      .sort((x, y) => x - y);
  return {
    variant_A_id: idOf(a),
    variant_B_id: idOf(b),
    condition,
    p_A_wins: p,
    mean_turns: round(2 + stable(`${a.id}${b.id}turns`) * 4, 1),
    hp_quantiles_A_won: quantiles(`${a.id}A`),
    hp_quantiles_B_won: quantiles(`${b.id}B`),
    hp_at_opponent_faint_A: round(stable(`${a.id}faintA`) * 0.6),
    hp_at_opponent_faint_B: round(stable(`${b.id}faintB`) * 0.6),
    status: condition === 'fresh' ? 'simulated' : stable(`${a.id}${b.id}${condition}st`) > 0.6 ? 'simulated' : 'inherited',
    ...(condition !== 'fresh' && stable(`${a.id}${b.id}${condition}st`) <= 0.6
      ? {inherited_from: 'fresh' as const}
      : {}),
    regulation_id: rules.regulation_id,
    policy_version: 'nash-d2@1.0.0',
    calc_version: '0.11.0-champions',
    sim_engine_version: '1.0.0',
  };
}

const cellVariants = pick(6);
const cells: MatchupCell[] = [];
for (const a of cellVariants) {
  for (const b of cellVariants) {
    if (a.id === b.id) continue;
    for (const c of ['fresh', 'moves_first', 'rain', 'sand'] as const) {
      cells.push(cell(a, b, c));
    }
  }
}

// --- enablers ---------------------------------------------------------------

/**
 * A small catalog of mechanisms, each with the effect category it belongs to.
 * Real enablers come from lib/effects.ts (BACKLOG item 11); this is enough
 * shapes to exercise the grouping and the pill rendering.
 */
const MECHANISMS: Array<{
  condition: EnablerRecord['enablers'][number]['condition'];
  mechanism: string;
  mechanism_class: EnablerRecord['enablers'][number]['mechanism_class'];
  category: EffectCategory;
  target: EnablerRecord['enablers'][number]['target'];
  action_cost: number;
  speed_tier: 0 | 1 | 2 | 'computed';
}> = [
  {condition: 'moves_first', mechanism: 'move:Tailwind', mechanism_class: 'support_move', category: 'speed', target: 'ally_side', action_cost: 1, speed_tier: 'computed'},
  {condition: 'moves_first', mechanism: 'move:Icy Wind', mechanism_class: 'support_move', category: 'speed', target: 'opponent_side', action_cost: 1, speed_tier: 'computed'},
  {condition: 'moves_first', mechanism: 'move:Thunder Wave', mechanism_class: 'status_move', category: 'speed', target: 'opponent_side', action_cost: 1, speed_tier: 'computed'},
  {condition: 'moves_first', mechanism: 'move:Dragon Dance', mechanism_class: 'setup_move', category: 'speed', target: 'self', action_cost: 1, speed_tier: 'computed'},
  {condition: 'moves_first', mechanism: 'move:Trick Room', mechanism_class: 'support_move', category: 'speed', target: 'field', action_cost: 1, speed_tier: 'computed'},
  {condition: 'moves_first', mechanism: 'move:Electroweb', mechanism_class: 'support_move', category: 'speed', target: 'opponent_side', action_cost: 1, speed_tier: 'computed'},
  {condition: 'rain', mechanism: 'ability:Drizzle', mechanism_class: 'switch_in_ability', category: 'weather', target: 'field', action_cost: 0, speed_tier: 0},
  {condition: 'sun', mechanism: 'ability:Drought', mechanism_class: 'switch_in_ability', category: 'weather', target: 'field', action_cost: 0, speed_tier: 0},
  {condition: 'sand', mechanism: 'ability:Sand Stream', mechanism_class: 'switch_in_ability', category: 'weather', target: 'field', action_cost: 0, speed_tier: 0},
  {condition: 'snow', mechanism: 'move:Snowscape', mechanism_class: 'support_move', category: 'weather', target: 'field', action_cost: 1, speed_tier: 'computed'},
  {condition: 'phys_mitigation', mechanism: 'ability:Intimidate', mechanism_class: 'switch_in_ability', category: 'mitigation', target: 'opponent_side', action_cost: 0, speed_tier: 0},
  {condition: 'phys_mitigation', mechanism: 'move:Reflect', mechanism_class: 'support_move', category: 'mitigation', target: 'ally_side', action_cost: 1, speed_tier: 'computed'},
  {condition: 'chip', mechanism: 'move:Rock Slide', mechanism_class: 'free_spread_damage', category: 'option', target: 'opponent_side', action_cost: 0, speed_tier: 0},
  {condition: 'chip', mechanism: 'move:Heat Wave', mechanism_class: 'free_spread_damage', category: 'option', target: 'opponent_side', action_cost: 0, speed_tier: 0},
];

/** Positioning tools, which are categorised but supply no condition. */
const TOOLS: Array<{tool: string; effect: PositioningTool['effect']; category: EffectCategory}> = [
  {tool: 'move:U-turn', effect: 'entry_cost_to_zero', category: 'pivoting'},
  {tool: 'move:Volt Switch', effect: 'entry_cost_to_zero', category: 'pivoting'},
  {tool: 'move:Follow Me', effect: 'entry_cost_to_zero', category: 'targeting'},
  {tool: 'move:Rage Powder', effect: 'entry_cost_to_zero', category: 'targeting'},
  {tool: 'move:Ally Switch', effect: 'entry_cost_to_zero', category: 'targeting'},
  {tool: 'move:Parting Shot', effect: 'entry_cost_to_zero', category: 'pivoting'},
  {tool: 'move:Flip Turn', effect: 'entry_cost_to_zero', category: 'pivoting'},
  {tool: 'move:Light Screen', effect: 'relevant_two_thirds', category: 'mitigation'},
  {tool: 'move:Reflect', effect: 'relevant_two_thirds', category: 'mitigation'},
  {tool: 'move:Fake Out', effect: 'entry_cost_to_zero', category: 'targeting'},
  {tool: 'ability:Intimidate', effect: 'physical_two_thirds', category: 'mitigation'},
  {tool: 'move:Protect', effect: 'all_three_quarters', category: 'protect'},
];

/**
 * Enablers are read off the variant's real moves and ability, not assigned at
 * random. Pelipper listing Tailwind in its moveset while supplying no speed
 * control is the kind of incoherence that makes a fixture actively misleading
 * — a reader cannot tell a layout problem from a data problem.
 */
/**
 * The four moves a variant actually runs — the same top-four the preset set
 * shows. Enablers must come from these rather than from the full usage list,
 * or a card can claim Tailwind support while displaying a set without it.
 */
function resolvedMoves(v: Variant): Set<string> {
  return new Set(
    [...v.moves]
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 4)
      .map((m) => m.name.toLowerCase())
  );
}

function enablersFor(v: Variant) {
  const moveNames = resolvedMoves(v);
  const ability = v.ability.toLowerCase();
  return MECHANISMS.filter((m) => {
    const name = m.mechanism.slice(m.mechanism.indexOf(':') + 1).toLowerCase();
    return m.mechanism.startsWith('ability:') ? ability === name : moveNames.has(name);
  }).map((m) => ({
    condition: m.condition,
    mechanism: m.mechanism,
    mechanism_class: m.mechanism_class,
    category: m.category,
    target: m.target,
    action_cost: m.action_cost,
    speed_tier: m.speed_tier,
    // Tier 0 beats the whole field by definition; a computed tier depends on
    // who it is facing, which is exactly what this number reports.
    first_share:
      m.speed_tier === 0 ? 1 : m.speed_tier === 2 ? 0 : round(0.45 + stable(`${v.id}${m.mechanism}fs`) * 0.5, 2),
    ...(m.condition === 'chip' ? {magnitude: 'calc' as const} : {}),
  }));
}

/** Positioning tools, likewise read off the real set. */
function toolCategoriesFor(v: Variant): EffectCategory[] {
  const moveNames = resolvedMoves(v);
  const ability = v.ability.toLowerCase();
  const cats = TOOLS.filter((t) => {
    const name = t.tool.slice(t.tool.indexOf(':') + 1).toLowerCase();
    return t.tool.startsWith('ability:') ? ability === name : moveNames.has(name);
  }).map((t) => t.category);
  return [...new Set(cats)];
}

function toolsFor(v: Variant) {
  const moveNames = resolvedMoves(v);
  const ability = v.ability.toLowerCase();
  return TOOLS.filter((t) => {
    const name = t.tool.slice(t.tool.indexOf(':') + 1).toLowerCase();
    return t.tool.startsWith('ability:') ? ability === name : moveNames.has(name);
  }).map((t) => ({
    tool: t.tool,
    effect: t.effect,
    speed_tier: 'computed' as const,
  }));
}

const enablers: EnablerRecord[] = byWeight.map((v) => ({
  variant_id: idOf(v),
  human_id: v.id,
  enablers: enablersFor(v),
}));

// --- positioning ------------------------------------------------------------

const positioning: PositioningProfile[] = byWeight.map((v) => {
  const costly = byWeight.slice(0, 12).filter((w) => stable(`${v.id}${w.id}cost`) > 0.75);
  return {
    variant_id: idOf(v),
    switch_in_score: round(0.25 + stable(`${v.id}sis`) * 0.4),
    entry_coverage: round(0.35 + stable(`${v.id}ec`) * 0.5),
    conversion: Math.round(4 + stable(`${v.id}conv`) * 18),
    costly_entries: costly.map((w) => ({
      opponent: idOf(w),
      species: w.species,
      cost: round(0.5 + stable(`${v.id}${w.id}c`) * 0.45),
      spread_retained: round(0.15 + stable(`${v.id}${w.id}s`) * 0.4),
    })),
    tools_provided: toolsFor(v),
  };
});

// --- team score -------------------------------------------------------------

const team = pick(6);
const ceiling = 0.641;
const floor = 0.583;
const teamScore: TeamScore = {
  members: team.map(idOf),
  score_ceiling: ceiling,
  score_floor: floor,
  condition_reliance: round((ceiling - floor) / ceiling),
  conditions_supplied: [
    {
      condition: 'rain',
      category: 'weather',
      delta: 0.031,
      enablers: [{member: idOf(team[1]), mechanism: 'ability:Drizzle', speed_tier: 0, first_share: 1}],
    },
    {
      condition: 'moves_first',
      category: 'speed',
      delta: 0.055,
      enablers: [{member: idOf(team[2]), mechanism: 'move:Tailwind', speed_tier: 'computed', first_share: 0.85}],
    },
  ],
  setup_profile: {
    switch_in_ability: 1,
    passive: 0,
    support_move: 1,
    setup_move: 1,
    status_move: 0,
    tier_0: 1,
    tier_1: 1,
    tier_2: 0,
  },
  positioning: {
    member_entry_coverage: team.map((v) => ({
      member: idOf(v),
      coverage: round(0.35 + stable(`${v.id}tec`) * 0.5),
    })),
    unreachable_opponents: byWeight.slice(10, 13).map((v) => ({
      species: v.species,
      weight: round(v.weight, 4),
    })),
  },
  worst_matchups: byWeight.slice(3, 8).map((v) => ({
    variant_id: idOf(v),
    species: v.species,
    weight: round(v.weight, 4),
    p_exposed: round(0.18 + stable(`${v.id}pe`) * 0.2),
    best_answer: {
      member: idOf(team[0]),
      condition: 'fresh' as const,
      p: round(0.2 + stable(`${v.id}ba`) * 0.2),
    },
  })),
  coverage_breadth: 58,
  member_contributions: team.map((v) => ({
    variant_id: idOf(v),
    marginal_score: round(stable(`${v.id}mc`) * 0.08),
  })),
};

// --- candidates -------------------------------------------------------------

const NATURES = ['Adamant', 'Modest', 'Jolly', 'Timid', 'Careful', 'Bold', 'Relaxed', 'Brave'];
const SPARE_ITEMS = ['Assault Vest', 'Sitrus Berry', 'Leftovers', 'Choice Scarf', 'Focus Sash', 'Life Orb'];

/**
 * Preset sets for a species. Phase 2's move-selection rules emit up to three
 * sets per species and item bucket; until they exist this fans one variant out
 * into two or three plausible ones so the preset picker has something to pick
 * between.
 */
function presetsFor(v: Variant): PresetSet[] {
  const ranked = [...v.moves].sort((a, b) => b.usage - a.usage).map((m) => m.name);
  const count = stable(`${v.id}nsets`) > 0.55 ? (stable(`${v.id}nsets2`) > 0.75 ? 3 : 2) : 1;
  return Array.from({length: count}, (_, k) => {
    const item = k === 0 ? v.item : SPARE_ITEMS[Math.floor(stable(`${v.id}item${k}`) * SPARE_ITEMS.length)];
    const moves = k === 0 ? ranked.slice(0, 4) : [...ranked.slice(0, 3), ranked[3 + k] ?? ranked[0]];
    return {
      variant_id: k === 0 ? idOf(v) : `${idOf(v)}-s${k}`,
      human_id: k === 0 ? v.id : `${v.id}_alt${k}`,
      set_label: k === 0 ? (v.set_label ?? v.item ?? 'No item') : (item ?? 'No item'),
      item: item ?? null,
      ability: v.ability,
      nature: k === 0 ? v.nature : NATURES[Math.floor(stable(`${v.id}nat${k}`) * NATURES.length)],
      sps: v.sps,
      moves,
      usage_share: round(k === 0 ? 0.55 + stable(`${v.id}us`) * 0.35 : 0.08 + stable(`${v.id}us${k}`) * 0.2, 2),
      tier: v.tier,
    };
  });
}

/**
 * The conditions a candidate supplies, grouped by category, each carrying the
 * teammate win-rate gain attributable to it.
 */
function supportFor(v: Variant): SuppliedCondition[] {
  const byCondition = new Map<string, SuppliedCondition>();
  for (const e of enablersFor(v)) {
    if (e.condition === 'chip') continue; // chip is a magnitude, not a supplied state
    const existing = byCondition.get(e.condition);
    const entry = {
      member: idOf(v),
      mechanism: e.mechanism,
      speed_tier: e.speed_tier,
      first_share: e.first_share,
    };
    if (existing) existing.enablers.push(entry);
    else
      byCondition.set(e.condition, {
        condition: e.condition,
        category: e.category,
        enablers: [entry],
        delta: round(0.004 + stable(`${v.id}${e.condition}d`) * 0.055),
      });
  }
  return [...byCondition.values()];
}

/**
 * The whole universe is a candidate, not a shortlist.
 *
 * A user filtering for "something that handles these three threats" needs
 * every set in scope, even when they only ever click one. Ranking decides
 * what floats to the top; it should not decide what exists.
 */
const candidates: Candidate[] = byWeight.map((v) => {
  const support = supportFor(v);
  const tools = toolsFor(v);
  // Support and positioning are both teammate win-rate gains, so they are
  // computed jointly rather than summed per condition — two conditions helping
  // the same matchup must not be counted twice.
  const supportDelta = support.length === 0 ? 0 : round(0.006 + stable(`${v.id}sd`) * 0.062);
  const positioningDelta = tools.length === 0 ? 0 : round(0.003 + stable(`${v.id}pd2`) * 0.045);
  // Opponents are only unlocked by a tool that actually reduces entry cost, so
  // this list and positioning_delta must rise and fall together.
  const unlocked =
    tools.length === 0
      ? []
      : byWeight.filter((o) => o.id !== v.id && stable(`${v.id}${o.id}unlock`) > 0.93).slice(0, 4);

  // Which matchups the support and the positioning tools actually move. The
  // teammate named here is a placeholder — the Build screen remaps these onto
  // the real partial team, because a swing is only meaningful relative to who
  // is already picked.
  const swingPool = byWeight.filter((o) => o.id !== v.id);
  const supportSwings = support.flatMap((c) =>
    swingPool
      .filter((o) => stable(`${v.id}${o.id}${c.condition}sw`) > 0.955)
      .slice(0, 2)
      .map((o) => {
        const before = round(0.22 + stable(`${v.id}${o.id}b`) * 0.28);
        return {
          opponent: idOf(o),
          opponent_species: o.species,
          weight: round(o.weight, 4),
          before,
          after: round(Math.min(0.95, before + 0.18 + stable(`${v.id}${o.id}a`) * 0.34)),
          condition: c.condition,
          mechanism: c.enablers[0]?.mechanism,
        };
      })
  );
  const positioningSwings =
    tools.length === 0
      ? []
      : swingPool
          .filter((o) => stable(`${v.id}${o.id}psw`) > 0.945)
          .slice(0, 3)
          .map((o) => {
            const before = round(0.15 + stable(`${v.id}${o.id}pb`) * 0.25);
            return {
              opponent: idOf(o),
              opponent_species: o.species,
              weight: round(o.weight, 4),
              before,
              after: round(Math.min(0.92, before + 0.2 + stable(`${v.id}${o.id}pa`) * 0.3)),
              mechanism: tools[0]?.tool,
            };
          });

  return {
    variant_id: idOf(v),
    human_id: v.id,
    species: v.species,
    set_label: v.set_label ?? 'No item',
    is_mega: v.is_mega,
    marginal_score: round(stable(`${v.id}ms`) * 0.09),
    support_delta: supportDelta,
    conditions_added: support,
    support_swings: supportSwings
      .sort((a, b) => (b.after - b.before) * b.weight - (a.after - a.before) * a.weight)
      .slice(0, 5),
    positioning_delta: positioningDelta,
    positioning_categories: toolCategoriesFor(v),
    positioning_swings: positioningSwings
      .sort((a, b) => (b.after - b.before) * b.weight - (a.after - a.before) * a.weight)
      .slice(0, 4),
    opponents_unlocked: unlocked.map((o, k) => ({
      species: o.species,
      weight: round(o.weight, 4),
      helps: byWeight[(k + 2) % 6].species,
    })),
    entry_coverage: round(0.35 + stable(`${v.id}cec`) * 0.5),
    sets: presetsFor(v),
    source: 'preset' as const,
    // Each candidate patches a different slice of the field, and never itself —
    // a fixture where every card answers the same two Pokémon makes the matchup
    // dimension look broken and tells the Phase 1 read-through nothing.
    patches: byWeight
      .filter((o) => o.id !== v.id && stable(`${v.id}${o.id}patch`) > 0.88)
      .slice(0, 3)
      .map((o) => ({
        variant_id: idOf(o),
        species: o.species,
        weight: round(o.weight, 4),
        p_exposed: round(0.2 + stable(`${v.id}${o.id}pe`) * 0.3),
        best_answer: {member: idOf(v), condition: 'fresh' as const, p: round(0.5 + stable(`${v.id}${o.id}p`) * 0.4)},
      })),
  };
});

// --- candidate matchups -----------------------------------------------------

/**
 * Every candidate's win probability against every variant in the field.
 *
 * The matchup-cells fixture covers only a handful of pairs, because it carries
 * the full cell shape — HP quantiles, provenance, inheritance. This is the thin
 * version: one number per ordered pair, which is what the Build screen's
 * "handles these threats" filter and the threat lists actually read. Against
 * real data this is a projection of the matrix, not a second source.
 */
const candidateMatchups: Record<string, Record<string, number>> = {};
for (const a of byWeight) {
  const row: Record<string, number> = {};
  for (const b of byWeight) {
    if (a.id === b.id) continue;
    row[idOf(b)] = round(0.08 + stable(`${a.id}>${b.id}mu`) * 0.86, 2);
  }
  candidateMatchups[idOf(a)] = row;
}

// --- custom set draft -------------------------------------------------------

const drafts: CustomSetDraft[] = [
  {
    species: byWeight[0].species,
    ability: byWeight[0].ability,
    item: 'Assault Vest',
    nature: byWeight[0].nature,
    sps: {hp: 32, atk: 32, spd: 2},
    moves: byWeight[0].moves.slice(0, 4).map((m) => m.name),
    warm_start_from: byWeight[0].cid ?? byWeight[0].id,
    validation_errors: [],
  },
  {
    // An invalid draft, so the editor's error path has something to render.
    species: byWeight[1].species,
    ability: byWeight[1].ability,
    item: 'Leftovers',
    nature: byWeight[1].nature,
    sps: {hp: 40, atk: 32, spe: 32},
    moves: byWeight[1].moves.slice(0, 3).map((m) => m.name),
    validation_errors: [
      '40 SP in hp exceeds the 32-per-stat cap',
      '104 SP total exceeds the 66-point budget',
      'A set needs four moves',
    ],
  },
];

// --- write ------------------------------------------------------------------

function main() {
  fs.mkdirSync(OUT_DIR, {recursive: true});
  console.log(`Fixtures for ${rules.regulation_id}, from ${variants.variants.length} real variants:`);
  write('conditions', {generated_at: new Date().toISOString(), conditions});
  write('variants', {
    generated_at: new Date().toISOString(),
    regulation: rules.regulation_id,
    variants: pick(12),
  });
  write('matchup-cells', {generated_at: new Date().toISOString(), cells});
  write('enablers', {generated_at: new Date().toISOString(), records: enablers});
  write('positioning', {generated_at: new Date().toISOString(), profiles: positioning});
  write('team-score', {generated_at: new Date().toISOString(), team: teamScore});
  write('candidates', {generated_at: new Date().toISOString(), candidates});
  write('custom-set-drafts', {generated_at: new Date().toISOString(), drafts});
  write('candidate-matchups', {
    generated_at: new Date().toISOString(),
    /** p(row beats column), keyed on content id. */
    matchups: candidateMatchups,
  });
  console.log(
    `\nNumbers in these files are invented. Species, weights and ids are real.`
  );
}

main();

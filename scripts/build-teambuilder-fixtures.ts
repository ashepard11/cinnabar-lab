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
  EnablerRecord,
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

const enablers: EnablerRecord[] = [
  {
    variant_id: idOf(byWeight[0]),
    human_id: byWeight[0].id,
    // One move doing two things produces two records, which is the case the
    // catalog's shape exists to handle.
    enablers: [
      {
        condition: 'moves_first',
        mechanism: 'move:Swords Dance',
        mechanism_class: 'setup_move',
        target: 'self',
        action_cost: 1,
        speed_tier: 'computed',
      },
      {
        condition: 'chip',
        mechanism: 'move:Rock Slide',
        mechanism_class: 'free_spread_damage',
        target: 'opponent_side',
        action_cost: 0,
        speed_tier: 0,
        magnitude: 'calc',
      },
    ],
  },
  {
    variant_id: idOf(byWeight[1]),
    human_id: byWeight[1].id,
    enablers: [
      {
        condition: 'rain',
        mechanism: 'ability:Drizzle',
        mechanism_class: 'switch_in_ability',
        target: 'field',
        action_cost: 0,
        speed_tier: 0,
      },
    ],
  },
  {
    variant_id: idOf(byWeight[2]),
    human_id: byWeight[2].id,
    enablers: [
      {
        condition: 'moves_first',
        mechanism: 'move:Tailwind',
        mechanism_class: 'support_move',
        target: 'ally_side',
        action_cost: 1,
        speed_tier: 'computed',
      },
    ],
  },
];

// --- positioning ------------------------------------------------------------

const positioning: PositioningProfile[] = pick(8).map((v) => {
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
    tools_provided:
      stable(`${v.id}tool`) > 0.6
        ? [{tool: 'move:U-turn', effect: 'entry_cost_to_zero' as const, speed_tier: 'computed' as const}]
        : [],
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
      enablers: [{member: idOf(team[1]), mechanism: 'ability:Drizzle', speed_tier: 0}],
    },
    {
      condition: 'moves_first',
      enablers: [{member: idOf(team[2]), mechanism: 'move:Tailwind', speed_tier: 'computed'}],
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

// 40 rather than a handful: one of Phase 1's questions is how many candidates
// a user actually scans at each slot, and a list short enough to read at a
// glance cannot answer it.
const candidates: Candidate[] = pick(40).map((v) => ({
  variant_id: idOf(v),
  human_id: v.id,
  species: v.species,
  set_label: v.set_label ?? 'No item',
  marginal_score: round(stable(`${v.id}ms`) * 0.09),
  conditions_added:
    stable(`${v.id}ca`) > 0.7
      ? [
          {
            condition: 'moves_first' as const,
            enablers: [
              {member: idOf(v), mechanism: 'move:Tailwind', speed_tier: 'computed' as const},
            ],
          },
        ]
      : [],
  positioning_delta: round(stable(`${v.id}pd`) * 0.05 - 0.01),
  entry_coverage: round(0.35 + stable(`${v.id}cec`) * 0.5),
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
}));

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
  console.log(
    `\nNumbers in these files are invented. Species, weights and ids are real.`
  );
}

main();

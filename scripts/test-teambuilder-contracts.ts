/**
 * scripts/test-teambuilder-contracts.ts — the Phase 0 fixtures satisfy the
 * contracts in lib/teambuilder/types.ts.
 *
 * Run: npm run test-contracts (also part of npm test).
 *
 * Typechecking proves the generator produces the declared shapes. What this
 * adds is the invariants the types cannot express — chiefly that a cell is
 * never absent and never null, which is the property the whole inheritance
 * design exists to guarantee. These fixtures are what Phase 1 builds the
 * interface against, so a fixture that violates an invariant teaches the
 * interface to handle a case that should never reach it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  Candidate,
  ConditionDescriptor,
  CustomSetDraft,
  EnablerRecord,
  MatchupCell,
  PositioningProfile,
  TeamScore,
} from '../lib/teambuilder/types';
import type {Variant} from '../lib/types';

const FIXTURES = path.join(__dirname, '..', 'data', 'fixtures');

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function section(name: string): void {
  console.log(`\n${name}\n`);
}

const load = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));

const isProbability = (n: unknown): boolean =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

// ---------------------------------------------------------------------------
section('Fixture files exist');

const expected = [
  'conditions', 'variants', 'matchup-cells', 'enablers',
  'positioning', 'team-score', 'candidates', 'custom-set-drafts',
];
for (const name of expected) {
  check(`${name}.json`, fs.existsSync(path.join(FIXTURES, `${name}.json`)));
}

// ---------------------------------------------------------------------------
section('Conditions');

const {conditions} = load<{conditions: ConditionDescriptor[]}>('conditions');

check('fresh is present and simulated', conditions.some((c) => c.id === 'fresh' && c.kind === 'simulated'));
check(
  'the five simulated conditions plus chip are declared',
  ['fresh', 'moves_first', 'sun', 'rain', 'snow', 'sand', 'chip'].every((id) =>
    conditions.some((c) => c.id === id)
  )
);
check(
  'every derived condition declares what it derives from',
  conditions.filter((c) => c.kind === 'derived').every((c) => c.derives_from !== undefined)
);
check(
  'no simulated condition claims to derive from anything',
  conditions.filter((c) => c.kind === 'simulated').every((c) => c.derives_from === undefined)
);
check('every condition has a label for the interface', conditions.every((c) => c.label.length > 0));

// ---------------------------------------------------------------------------
section('Matchup cells');

const {cells} = load<{cells: MatchupCell[]}>('matchup-cells');

check('cells are present', cells.length > 0, `${cells.length} cells`);
check('every p_A_wins is a probability', cells.every((c) => isProbability(c.p_A_wins)));
check(
  'no cell is null or absent — every one carries a status',
  cells.every((c) => ['simulated', 'inherited', 'excluded_fallback'].includes(c.status))
);
check(
  'inherited cells name their source, and only inherited cells do',
  cells.every((c) =>
    c.status === 'inherited' ? c.inherited_from !== undefined : c.inherited_from === undefined
  )
);
check(
  'a cell never inherits from itself',
  cells.every((c) => c.inherited_from !== c.condition)
);
check(
  'every fresh cell is simulated — fresh has nothing to inherit from',
  cells.filter((c) => c.condition === 'fresh').every((c) => c.status === 'simulated')
);
check(
  'HP quantile arrays are sorted fractions',
  cells.every((c) =>
    [c.hp_quantiles_A_won, c.hp_quantiles_B_won].every(
      (q) => q.every(isProbability) && q.every((v, i) => i === 0 || v >= q[i - 1])
    )
  )
);
check(
  'both sides record HP at the opponent fainting',
  cells.every((c) => isProbability(c.hp_at_opponent_faint_A) && isProbability(c.hp_at_opponent_faint_B))
);
check(
  'every cell carries full provenance',
  cells.every(
    (c) => !!c.regulation_id && !!c.policy_version && !!c.calc_version && !!c.sim_engine_version
  )
);
check('no cell is self-referential (A vs A)', cells.every((c) => c.variant_A_id !== c.variant_B_id));

// Every pair present must cover every condition present, which is the
// density guarantee: a query for any pair under any condition returns a row.
const pairs = new Set(cells.map((c) => `${c.variant_A_id}|${c.variant_B_id}`));
const conditionsUsed = new Set(cells.map((c) => c.condition));
const keyed = new Set(cells.map((c) => `${c.variant_A_id}|${c.variant_B_id}|${c.condition}`));
check(
  'the fixture matrix is dense over its pairs and conditions',
  [...pairs].every((p) => [...conditionsUsed].every((c) => keyed.has(`${p}|${c}`))),
  `${pairs.size} pairs × ${conditionsUsed.size} conditions`
);

// ---------------------------------------------------------------------------
section('Enablers');

const {records} = load<{records: EnablerRecord[]}>('enablers');
const allEnablers = records.flatMap((r) => r.enablers);

check('enabler records are present', records.length > 0, `${records.length} records`);
check(
  'every enabler names a namespaced mechanism',
  allEnablers.every((e) => /^(move|ability|item):/.test(e.mechanism))
);
check(
  'every enabler declares a target',
  allEnablers.every((e) => ['self', 'ally_side', 'opponent_side', 'field'].includes(e.target))
);
check(
  'passive and free-spread enablers cost no action',
  allEnablers
    .filter((e) => e.mechanism_class === 'switch_in_ability' || e.mechanism_class === 'free_spread_damage')
    .every((e) => e.action_cost === 0)
);
check(
  'a tier-0 enabler costs no action',
  allEnablers.filter((e) => e.speed_tier === 0).every((e) => e.action_cost === 0)
);
check(
  'derived-condition enablers carry a magnitude, simulated ones do not',
  allEnablers.every((e) => (e.condition === 'chip' ? e.magnitude !== undefined : e.magnitude === undefined))
);

// ---------------------------------------------------------------------------
section('Positioning');

const {profiles} = load<{profiles: PositioningProfile[]}>('positioning');

check('profiles are present', profiles.length > 0, `${profiles.length} profiles`);
check(
  'switch_in_score and entry_coverage are probabilities',
  profiles.every((p) => isProbability(p.switch_in_score) && isProbability(p.entry_coverage))
);
check('conversion is a non-negative count', profiles.every((p) => Number.isInteger(p.conversion) && p.conversion >= 0));
check(
  'costly entries carry both a cost and the spread retained',
  profiles.every((p) =>
    p.costly_entries.every((e) => isProbability(e.cost) && isProbability(e.spread_retained))
  )
);

// ---------------------------------------------------------------------------
section('Team score');

const {team} = load<{team: TeamScore}>('team-score');

check('the team has six members', team.members.length === 6, `${team.members.length}`);
check('members are distinct', new Set(team.members).size === team.members.length);
check(
  'ceiling and floor are probabilities and the floor is no higher',
  isProbability(team.score_ceiling) &&
    isProbability(team.score_floor) &&
    team.score_floor <= team.score_ceiling
);
check(
  'condition_reliance equals (ceiling − floor) / ceiling',
  Math.abs(team.condition_reliance - (team.score_ceiling - team.score_floor) / team.score_ceiling) < 5e-4,
  `${team.condition_reliance}`
);
check(
  'every worst matchup scores below 0.4',
  team.worst_matchups.every((m) => m.p_exposed < 0.4)
);
check(
  'every supplied condition names at least one enabler',
  team.conditions_supplied.every((c) => c.enablers.length > 0)
);
check(
  'supplied-condition enablers are all team members',
  team.conditions_supplied.every((c) => c.enablers.every((e) => team.members.includes(e.member)))
);
check(
  'positioning is reported per member, not folded into one number',
  team.positioning.member_entry_coverage.length === team.members.length
);
check(
  'member contributions cover every member',
  team.member_contributions.length === team.members.length
);

// ---------------------------------------------------------------------------
section('Candidates');

const {candidates} = load<{candidates: Candidate[]}>('candidates');

check('candidates are present', candidates.length > 0, `${candidates.length} candidates`);
check(
  'every candidate carries all three surfacing signals',
  candidates.every(
    (c) =>
      typeof c.marginal_score === 'number' &&
      Array.isArray(c.conditions_added) &&
      typeof c.positioning_delta === 'number'
  )
);
// Positioning is a teammate win-rate gain, and adding a member only ever adds
// tools — it cannot take a pivot or a redirector away from the team. So the
// delta is non-negative by construction, and a negative one means the
// computation is wrong rather than that the candidate is bad.
check(
  'positioning_delta is never negative',
  candidates.every((c) => c.positioning_delta >= 0)
);
check(
  'support_delta is never negative',
  candidates.every((c) => c.support_delta >= 0)
);
check(
  'a candidate supplying no conditions has zero support delta',
  candidates.filter((c) => c.conditions_added.length === 0).every((c) => c.support_delta === 0)
);
check(
  'every supplied condition carries a category and at least one enabler',
  candidates.every((c) =>
    c.conditions_added.every((s) => !!s.category && s.enablers.length > 0)
  )
);
check(
  'computed speed tiers carry a first_share, tier 0 is 1 and tier 2 is 0',
  candidates.every((c) =>
    c.conditions_added.every((s) =>
      s.enablers.every((e) =>
        e.speed_tier === 0
          ? e.first_share === 1
          : e.speed_tier === 2
            ? e.first_share === 0
            : typeof e.first_share === 'number' && e.first_share > 0 && e.first_share < 1
      )
    )
  )
);
check(
  'every candidate offers at least one preset set',
  candidates.every((c) => (c.sets?.length ?? 0) >= 1)
);
check(
  'the candidate list covers the whole variant universe, not a shortlist',
  candidates.length >= 80,
  `${candidates.length} candidates`
);
check('every candidate has a display label', candidates.every((c) => !!c.species && !!c.set_label));

// ---------------------------------------------------------------------------
section('Custom set drafts');

const {drafts} = load<{drafts: CustomSetDraft[]}>('custom-set-drafts');

check('a valid draft and an invalid one are both present', drafts.some((d) => d.validation_errors.length === 0) && drafts.some((d) => d.validation_errors.length > 0));
check(
  'the invalid draft explains every problem it has',
  drafts.filter((d) => d.validation_errors.length > 0).every((d) => d.validation_errors.every((e) => e.length > 0))
);

// The variants fixture is real data, so it must satisfy the real contract.
const {variants} = load<{variants: Variant[]}>('variants');
check(
  'the variants fixture carries schema v3 fields',
  variants.every((v) => typeof v.national_dex === 'number' && v.tier !== undefined)
);

// ---------------------------------------------------------------------------
console.log(
  `\n${failures === 0 ? 'all checks passed' : `${failures} of ${checks} checks FAILED`}\n`
);
if (failures > 0) process.exit(1);

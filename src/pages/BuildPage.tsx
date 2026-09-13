import {useMemo, useState} from 'react';
import {useCandidates, useConditions} from '../lib/useFixtures';
import {activeRegulationConfig, validateSpSpread, describeSpErrors} from '../../lib/format-rules';
import type {Candidate} from '../../lib/teambuilder/types';
import type {StatID} from '../../lib/types';
import CandidateCard, {type SortKey} from '../components/teambuilder/CandidateCard';
import TeamStrip from '../components/teambuilder/TeamStrip';

const RULES = activeRegulationConfig();
const STATS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** How many candidates the list shows before asking to show more. */
const PAGE = 10;

const SORTS: Array<{key: SortKey; label: string; help: string}> = [
  {
    key: 'marginal_score',
    label: 'Matchup coverage',
    help: 'How much the team score improves by adding this member.',
  },
  {
    key: 'conditions_added',
    label: 'Conditions added',
    help: 'Conditions this member supplies that the team could not already bring about.',
  },
  {
    key: 'positioning_delta',
    label: 'Positioning',
    help: "How much this member improves existing members' ability to reach their good matchups.",
  },
];

/**
 * Fixture-only re-ranking.
 *
 * The real ranking recomputes against the partial team. There is no pipeline
 * yet, so picks perturb the order deterministically instead — enough that the
 * interaction of picking and re-ranking can be exercised, and clearly not a
 * model of anything. Deterministic so the same team always produces the same
 * list.
 */
function perturb(candidate: Candidate, teamIds: string[]): number {
  const seed = candidate.variant_id + teamIds.join('');
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 100000;
}

export default function BuildPage() {
  const {data: candidates, error, loading} = useCandidates();
  const {data: conditions} = useConditions();

  const [team, setTeam] = useState<Candidate[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('marginal_score');
  const [requiredCondition, setRequiredCondition] = useState<string>('');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [maxScanned, setMaxScanned] = useState(PAGE);
  const [editing, setEditing] = useState<Candidate | null>(null);

  const teamIds = team.map((m) => m.variant_id);

  const ranked = useMemo(() => {
    if (!candidates) return [];
    const picked = new Set(teamIds);
    let list = candidates.filter((c) => !picked.has(c.variant_id));

    if (requiredCondition) {
      list = list.filter((c) => c.conditions_added.some((x) => x.condition === requiredCondition));
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (c) => c.species.toLowerCase().includes(q) || c.set_label.toLowerCase().includes(q)
      );
    }

    const score = (c: Candidate): number => {
      const jitter = perturb(c, teamIds);
      if (sortKey === 'conditions_added') return c.conditions_added.length + jitter;
      if (sortKey === 'positioning_delta') return c.positioning_delta + jitter;
      return c.marginal_score + jitter;
    };
    return [...list].sort((a, b) => score(b) - score(a));
  }, [candidates, teamIds.join(','), requiredCondition, query, sortKey]);

  function pick(candidate: Candidate) {
    setEditing(candidate);
  }

  function confirm(candidate: Candidate) {
    setTeam((t) => [...t, candidate]);
    setEditing(null);
    setVisible(PAGE);
  }

  function backUp() {
    setTeam((t) => t.slice(0, -1));
  }

  function remove(variantId: string) {
    setTeam((t) => t.filter((m) => m.variant_id !== variantId));
  }

  function showMore() {
    const next = visible + PAGE;
    setVisible(next);
    setMaxScanned((m) => Math.max(m, next));
  }

  const full = team.length >= RULES.team_size;

  if (error) return <div className="page"><p className="error">Failed to load fixtures: {error}</p></div>;
  if (loading || !candidates) return <div className="page"><p>Loading fixtures…</p></div>;

  return (
    <div className="page build-page">
      <header className="page-head">
        <h1>Build a team</h1>
        <p className="subtitle">
          Guided mode: pick a slot at a time and the candidate list re-ranks against
          what you already have. Running on <strong>fixture data</strong> — the
          species and weights are real, every score on this page is invented.
        </p>
      </header>

      <section className="build-team">
        <div className="build-team-head">
          <h2>
            Your team <span className="muted">{team.length} / {RULES.team_size}</span>
          </h2>
          <div className="build-controls">
            <button type="button" onClick={backUp} disabled={team.length === 0}>
              Back up
            </button>
            <button type="button" disabled={full || team.length === 0} title="Hand the partial team to the automatic search">
              Finish automatically
            </button>
          </div>
        </div>
        <TeamStrip team={team} teamSize={RULES.team_size} onRemove={remove} />
        {full && (
          <p className="build-complete">
            Six slots filled. <a href="/build/team/current">See the team detail</a> for the full
            matchup grid, condition inventory and leave-one-out contributions.
          </p>
        )}
      </section>

      {!full && (
        <section className="build-candidates">
          <div className="candidates-head">
            <h2>Candidates for slot {team.length + 1}</h2>
            <p className="muted">
              {ranked.length} candidate{ranked.length === 1 ? '' : 's'}
              {requiredCondition && ` supplying ${requiredCondition}`}
            </p>
          </div>

          <div className="candidate-filters">
            <label>
              <span>Sort by</span>
              <div className="sort-toggle" role="group" aria-label="Sort candidates">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    title={s.help}
                    className={sortKey === s.key ? 'active' : ''}
                    onClick={() => setSortKey(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </label>

            <label>
              <span>Require a condition</span>
              <select value={requiredCondition} onChange={(e) => setRequiredCondition(e.target.value)}>
                <option value="">Any</option>
                {(conditions ?? [])
                  .filter((c) => c.id !== 'fresh')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id}
                    </option>
                  ))}
              </select>
            </label>

            {/* Forward entry: the user has a Pokémon in mind. The backward
                entry point — starting from a problem matchup — is one of the
                things this build exists to find out we need; see the note at
                the foot of the page. */}
            <label>
              <span>Find a Pokémon</span>
              <input
                type="search"
                value={query}
                placeholder="Species or set"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          <ol className="candidate-list">
            {ranked.slice(0, visible).map((c, i) => (
              <CandidateCard
                key={c.variant_id}
                candidate={c}
                rank={i + 1}
                highlight={sortKey}
                onPick={pick}
              />
            ))}
          </ol>

          {ranked.length > visible && (
            <button type="button" className="show-more" onClick={showMore}>
              Show {Math.min(PAGE, ranked.length - visible)} more
              <span className="muted"> ({ranked.length - visible} remaining)</span>
            </button>
          )}
          {ranked.length === 0 && <p className="muted">No candidate matches those filters.</p>}
        </section>
      )}

      {editing && <SetEditor candidate={editing} onCancel={() => setEditing(null)} onConfirm={confirm} />}

      <ScanNote maxScanned={maxScanned} />
    </div>
  );
}

/**
 * Choosing the set for a picked candidate.
 *
 * The preset path is stubbed until Phase 2 emits multiple sets per bucket. The
 * custom path is real in the way that matters here: the SP budget and the
 * per-stat cap are validated live against `lib/format-rules.ts`, which is the
 * same code the pipeline uses, so an illegal spread is rejected in the editor
 * rather than after a simulation job is queued.
 */
function SetEditor({
  candidate,
  onCancel,
  onConfirm,
}: {
  candidate: Candidate;
  onCancel: () => void;
  onConfirm: (c: Candidate) => void;
}) {
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [sps, setSps] = useState<Partial<Record<StatID, number>>>({hp: 32, atk: 32, spd: 2});

  const spent = STATS.reduce((sum, s) => sum + (sps[s] ?? 0), 0);
  const errors = validateSpSpread(sps, RULES);
  const legal = errors.length === 0;

  return (
    <div className="set-editor" role="dialog" aria-label={`Choose a set for ${candidate.species}`}>
      <div className="set-editor-head">
        <h3>
          {candidate.species} <span className="muted">{candidate.set_label}</span>
        </h3>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>

      <div className="set-modes" role="group">
        <button type="button" className={mode === 'preset' ? 'active' : ''} onClick={() => setMode('preset')}>
          Preset set
        </button>
        <button type="button" className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>
          Define my own
        </button>
      </div>

      {mode === 'preset' ? (
        <p className="muted">
          Using the modal set. Multiple sets per item bucket arrive with Phase 2's
          move-selection rules; until then there is one preset per candidate.
        </p>
      ) : (
        <div className="sp-editor">
          <p className="muted">
            {RULES.sp_total} Stat Points, no more than {RULES.sp_per_stat_cap} in any
            one stat. Each point is worth exactly 1 to the final stat.
          </p>
          <div className="sp-grid">
            {STATS.map((stat) => (
              <label key={stat}>
                <span>{stat.toUpperCase()}</span>
                <input
                  type="number"
                  min={0}
                  max={RULES.sp_per_stat_cap}
                  value={sps[stat] ?? 0}
                  onChange={(e) => setSps((s) => ({...s, [stat]: Number(e.target.value)}))}
                />
              </label>
            ))}
          </div>
          <p className={legal ? 'sp-budget ok' : 'sp-budget over'}>
            {spent} / {RULES.sp_total} SP spent
            {!legal && ` — ${describeSpErrors(errors)}`}
          </p>
          {legal && (
            <p className="muted">
              A custom set is ranked provisionally from the damage calculator within
              a second, then refined in the background. Nothing is simulated yet in
              this build.
            </p>
          )}
        </div>
      )}

      <div className="set-editor-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={mode === 'custom' && !legal} onClick={() => onConfirm(candidate)}>
          Add to team
        </button>
      </div>
    </div>
  );
}

/**
 * Phase 1 exists to answer questions, and the cheapest of them is how deep
 * into the candidate list a user actually reads. If the answer is ten, the
 * core tier can be well under seventy and the matrix build shrinks with it.
 * Rather than instrument silently, the page says what it is watching.
 */
function ScanNote({maxScanned}: {maxScanned: number}) {
  return (
    <aside className="phase1-note">
      <h3>What this build is trying to find out</h3>
      <ul>
        <li>
          <strong>How deep does the candidate list get read?</strong> Furthest you have
          opened this session: <strong>{maxScanned}</strong>. If that settles near ten,
          the core tier can be much smaller than seventy and the matrix build shrinks
          accordingly.
        </li>
        <li>
          <strong>Are the three dimensions readable side by side?</strong> Every card
          shows matchup coverage, conditions added and positioning at equal weight. If
          this only works by sorting to one of them, the ranking function needs to
          return three orderings rather than one.
        </li>
        <li>
          <strong>Forward or backward?</strong> This screen only works forward, from a
          Pokémon you have in mind. If you find yourself wanting to start from an
          opponent you lose to, the search needs an entry point that does not exist
          in the current design.
        </li>
        <li>
          <strong>Is the speed tier a badge or a number?</strong> Tiers are shown next
          to each enabler and are not priced into any score. If you expect a
          Drizzle team and a slow-Rain-Dance team to score differently, the penalty
          has to stop being advisory.
        </li>
      </ul>
    </aside>
  );
}

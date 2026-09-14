import {useMemo, useState} from 'react';
import {useCandidates, useCandidateMatchups, useFixtureVariants} from '../lib/useFixtures';
import {activeRegulationConfig} from '../../lib/format-rules';
import type {Candidate, PresetSet} from '../../lib/teambuilder/types';
import CandidateCard, {type SortKey} from '../components/teambuilder/CandidateCard';
import CandidateFilters, {EMPTY_FILTERS, type FilterState} from '../components/teambuilder/CandidateFilters';
import TeamStrip from '../components/teambuilder/TeamStrip';
import SetEditor, {type ChosenSet} from '../components/teambuilder/SetEditor';
import EvaluatorPanel from '../components/teambuilder/EvaluatorPanel';
import OffMetaEntry from '../components/teambuilder/OffMetaEntry';
import {teamToParsedSets, type TeamMember} from '../lib/teamToSets';

const RULES = activeRegulationConfig();
const PAGE = 10;

/** A "good matchup" for the threat filter. Deliberately generous. */
const GOOD_MATCHUP = 0.55;

const SORTS: Array<{key: SortKey; label: string; help: string}> = [
  {
    key: 'marginal_score',
    label: 'Matchup coverage',
    help: 'Percentage points of team win rate this member adds through its own matchups.',
  },
  {
    key: 'support_delta',
    label: 'Support',
    help: "Percentage points it adds to teammates' win rate by supplying conditions they convert on.",
  },
  {
    key: 'positioning_delta',
    label: 'Positioning',
    help: "Percentage points it adds to teammates' win rate by helping them reach their good matchups.",
  },
];

function perturb(candidate: Candidate, teamIds: string[]): number {
  const seed = candidate.variant_id + teamIds.join('');
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 100000;
}

interface Picked extends TeamMember {
  candidate: Candidate;
}

export default function BuildPage() {
  const {data: candidates, error, loading} = useCandidates();
  const {data: matchups} = useCandidateMatchups();
  const {data: variants} = useFixtureVariants();

  const [team, setTeam] = useState<Picked[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('marginal_score');
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [detailed, setDetailed] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [maxScanned, setMaxScanned] = useState(PAGE);
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [offMeta, setOffMeta] = useState(false);

  const teamIds = team.map((m) => m.candidate.variant_id);
  const threatOptions = useMemo(
    () =>
      (candidates ?? [])
        .map((c) => ({id: c.variant_id, label: `${c.species} (${c.set_label})`}))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [candidates]
  );

  const ranked = useMemo(() => {
    if (!candidates) return [];
    const picked = new Set(teamIds);
    let list = candidates.filter((c) => !picked.has(c.variant_id));

    if (filters.mega !== 'all') {
      const wantMega = filters.mega === 'mega';
      list = list.filter((c) => c.is_mega === wantMega);
    }
    if (filters.supports) {
      const cat = filters.supports;
      // A category can be reached two ways: by supplying a condition in it, or
      // by carrying a positioning tool in it. Mitigation and weather are in
      // both lists, so both tests have to be exact — checking "has any
      // positioning at all" would make those two match everything.
      list = list.filter(
        (c) =>
          c.conditions_added.some((s) => s.category === cat) ||
          c.positioning_categories.includes(cat)
      );
    }
    if (filters.threats.length > 0 && matchups) {
      list = list.filter((c) => {
        const row = matchups[c.variant_id];
        return row && filters.threats.every((t) => (row[t] ?? 0) >= GOOD_MATCHUP);
      });
    }
    if (filters.query.trim()) {
      const q = filters.query.trim().toLowerCase();
      list = list.filter(
        (c) => c.species.toLowerCase().includes(q) || c.set_label.toLowerCase().includes(q)
      );
    }

    const score = (c: Candidate): number => {
      const jitter = perturb(c, teamIds);
      if (sortKey === 'support_delta') return c.support_delta + jitter;
      if (sortKey === 'positioning_delta') return c.positioning_delta + jitter;
      return c.marginal_score + jitter;
    };
    return [...list].sort((a, b) => score(b) - score(a));
  }, [candidates, matchups, teamIds.join(","), filters, sortKey]);

  /**
   * Swings name a teammate, and a fixture cannot know who is on the team. Map
   * them onto the real roster so the sentence reads as it will against real
   * data: "Basculegion 41%→78% vs Floette" is only meaningful when Basculegion
   * is actually picked.
   */
  const withTeammates = useMemo(() => {
    if (team.length === 0) return ranked;
    return ranked.map((c) => ({
      ...c,
      support_swings: c.support_swings.map((s, i) => ({
        ...s,
        teammate: team[i % team.length].candidate.variant_id,
        teammate_species: team[i % team.length].candidate.species,
      })),
      positioning_swings: c.positioning_swings.map((s, i) => ({
        ...s,
        teammate: team[i % team.length].candidate.variant_id,
        teammate_species: team[i % team.length].candidate.species,
      })),
    }));
  }, [ranked, team]);

  function confirm(candidate: Candidate, chosen: ChosenSet) {
    const variant = variants?.find((v) => (v.cid ?? v.id) === candidate.variant_id);
    setTeam((t) => [
      ...t,
      {
        candidate: chosen.source === 'custom' ? {...candidate, source: 'custom', provisional: true} : candidate,
        species: candidate.species,
        battleSpecies: variant?.species ?? candidate.species,
        isMega: variant?.is_mega ?? false,
        set: chosen.set,
      },
    ]);
    setEditing(null);
    setVisible(PAGE);
  }

  function addOffMeta(candidate: Candidate, set: PresetSet) {
    setTeam((t) => [
      ...t,
      {candidate, species: candidate.species, battleSpecies: candidate.species, isMega: false, set},
    ]);
    setOffMeta(false);
  }

  const full = team.length >= RULES.team_size;
  const parsedSets = useMemo(() => teamToParsedSets(team), [team]);

  if (error) return <div className="page"><p className="error">Failed to load fixtures: {error}</p></div>;
  if (loading || !candidates) return <div className="page"><p>Loading fixtures…</p></div>;

  return (
    <div className="page build-page">
      <header className="page-head">
        <h1>Build a team</h1>
        <p className="subtitle">
          Guided mode: pick a slot at a time and the candidate list re-ranks against
          what you already have. All three figures on a card are percentage points
          of metagame-weighted win rate — the difference is whose. Running on{' '}
          <strong>fixture data</strong>: species, sets and weights are real, every
          score is invented.
        </p>
      </header>

      <section className="build-team">
        <div className="build-team-head">
          <h2>
            Your team <span className="muted">{team.length} / {RULES.team_size}</span>
          </h2>
          <div className="build-controls">
            <button type="button" onClick={() => setTeam((t) => t.slice(0, -1))} disabled={team.length === 0}>
              Back up
            </button>
            <button type="button" disabled={full || team.length === 0} title="Hand the partial team to the automatic search">
              Finish automatically
            </button>
          </div>
        </div>
        <TeamStrip
          team={team.map((m) => ({candidate: m.candidate, set: m.set}))}
          teamSize={RULES.team_size}
          onRemove={(id) => setTeam((t) => t.filter((m) => m.candidate.variant_id !== id))}
        />
      </section>

      <EvaluatorPanel sets={parsedSets} />

      {!full && (
        <section className="build-candidates">
          <div className="candidates-head">
            <h2>Candidates for slot {team.length + 1}</h2>
            <div className="candidates-head-controls">
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
              <button
                type="button"
                className={detailed ? 'density active' : 'density'}
                aria-pressed={detailed}
                onClick={() => setDetailed((d) => !d)}
                title="Show the matchups behind every figure on every card"
              >
                {detailed ? 'Compact' : 'Expand all'}
              </button>
            </div>
          </div>

          <CandidateFilters
            options={threatOptions}
            filters={filters}
            onChange={(f) => {
              setFilters(f);
              setVisible(PAGE);
            }}
            threshold={GOOD_MATCHUP}
            matching={ranked.length}
            total={candidates.length}
          />

          <ol className="candidate-list">
            {withTeammates.slice(0, visible).map((c, i) => (
              <CandidateCard
                key={c.variant_id}
                candidate={c}
                rank={i + 1}
                highlight={sortKey}
                detailed={detailed}
                hasTeammates={team.length > 0}
                onPick={setEditing}
              />
            ))}
          </ol>

          {ranked.length > visible && (
            <button
              type="button"
              className="show-more"
              onClick={() => {
                const next = visible + PAGE;
                setVisible(next);
                setMaxScanned((m) => Math.max(m, next));
              }}
            >
              Show {Math.min(PAGE, ranked.length - visible)} more
              <span className="muted"> ({ranked.length - visible} remaining)</span>
            </button>
          )}
          {ranked.length === 0 && (
            <p className="muted">
              Nothing in the universe matches all of those filters at once. Drop one,
              or lower what counts as a good matchup.
            </p>
          )}

          <div className="off-meta-entry">
            <button type="button" className="link" onClick={() => setOffMeta(true)}>
              + Add a Pokémon that isn't in this list
            </button>
            <span className="muted">
              Anything legal in {RULES.regulation_id}, whether or not it sees usage.
            </span>
          </div>
        </section>
      )}

      {editing && (
        <SetEditor
          candidate={editing}
          onCancel={() => setEditing(null)}
          onConfirm={(chosen) => confirm(editing, chosen)}
        />
      )}

      {offMeta && (
        <OffMetaEntry onCancel={() => setOffMeta(false)} onAdd={addOffMeta} teamSize={team.length} />
      )}

      <ScanNote maxScanned={maxScanned} />
    </div>
  );
}

function ScanNote({maxScanned}: {maxScanned: number}) {
  return (
    <aside className="phase1-note">
      <h3>What this build is trying to find out</h3>
      <ul>
        <li>
          <strong>How deep does the candidate list get read?</strong> Furthest opened
          this session: <strong>{maxScanned}</strong>. If that settles near ten, the
          core tier can be much smaller than seventy and the matrix build shrinks
          accordingly.
        </li>
        <li>
          <strong>Do the three figures compare?</strong> All three are percentage
          points of metagame win rate; they differ in whose win rate moves.
        </li>
        <li>
          <strong>Is positioning the right measure?</strong> Expressing it as a
          teammate win-rate delta makes it comparable, but it is derived from
          machinery that does not exist yet. Revisit when Phase 6 is real.
        </li>
      </ul>
    </aside>
  );
}

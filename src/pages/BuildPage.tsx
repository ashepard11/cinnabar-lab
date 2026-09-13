import {useMemo, useState} from 'react';
import {useCandidates, useCandidateMatchups, useFixtureVariants} from '../lib/useFixtures';
import {activeRegulationConfig} from '../../lib/format-rules';
import type {Candidate, PresetSet} from '../../lib/teambuilder/types';
import CandidateCard, {type SortKey} from '../components/teambuilder/CandidateCard';
import TeamStrip from '../components/teambuilder/TeamStrip';
import SetEditor, {type ChosenSet} from '../components/teambuilder/SetEditor';
import EvaluatorPanel from '../components/teambuilder/EvaluatorPanel';
import OffMetaEntry from '../components/teambuilder/OffMetaEntry';
import {teamToParsedSets, type TeamMember} from '../lib/teamToSets';

const RULES = activeRegulationConfig();

/** How many candidates the list shows before asking to show more. */
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

/** Deterministic fixture jitter so picking re-ranks visibly. Not a model. */
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
  const [threats, setThreats] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [maxScanned, setMaxScanned] = useState(PAGE);
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [offMeta, setOffMeta] = useState(false);

  const teamIds = team.map((m) => m.candidate.variant_id);

  /** Every variant is a possible threat to filter against, not just candidates. */
  const threatOptions = useMemo(() => {
    const seen = new Map<string, {id: string; label: string}>();
    for (const c of candidates ?? []) {
      if (!seen.has(c.variant_id)) {
        seen.set(c.variant_id, {id: c.variant_id, label: `${c.species} (${c.set_label})`});
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [candidates]);

  const ranked = useMemo(() => {
    if (!candidates) return [];
    const picked = new Set(teamIds);
    let list = candidates.filter((c) => !picked.has(c.variant_id));

    // "Handles these threats": keep only candidates with a good matchup into
    // every selected opponent. This is the backward entry point — starting
    // from a problem rather than from a Pokémon you already like.
    if (threats.length > 0 && matchups) {
      list = list.filter((c) => {
        const row = matchups[c.variant_id];
        return row && threats.every((t) => (row[t] ?? 0) >= GOOD_MATCHUP);
      });
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
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
  }, [candidates, matchups, teamIds.join(','), threats.join(','), query, sortKey]);

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

  function showMore() {
    const next = visible + PAGE;
    setVisible(next);
    setMaxScanned((m) => Math.max(m, next));
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
          <strong>fixture data</strong>: species and weights are real, every score is
          invented.
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
          team={team.map((m) => m.candidate)}
          teamSize={RULES.team_size}
          onRemove={(id) => setTeam((t) => t.filter((m) => m.candidate.variant_id !== id))}
        />
      </section>

      {!full && (
        <section className="build-candidates">
          <div className="candidates-head">
            <h2>Candidates for slot {team.length + 1}</h2>
            <p className="muted">
              {ranked.length} of {candidates.length}
              {threats.length > 0 && ` with a good matchup into all ${threats.length} selected`}
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
              <span>Find a Pokémon</span>
              <input
                type="search"
                value={query}
                placeholder="Species or set"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          <ThreatFilter
            options={threatOptions}
            selected={threats}
            onChange={setThreats}
            threshold={GOOD_MATCHUP}
          />

          <ol className="candidate-list">
            {ranked.slice(0, visible).map((c, i) => (
              <CandidateCard
                key={c.variant_id}
                candidate={c}
                rank={i + 1}
                highlight={sortKey}
                onPick={setEditing}
              />
            ))}
          </ol>

          {ranked.length > visible && (
            <button type="button" className="show-more" onClick={showMore}>
              Show {Math.min(PAGE, ranked.length - visible)} more
              <span className="muted"> ({ranked.length - visible} remaining)</span>
            </button>
          )}
          {ranked.length === 0 && (
            <p className="muted">
              Nothing in the universe has a good matchup into all of those at once.
              Drop one, or lower what counts as good.
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

      <EvaluatorPanel sets={parsedSets} />

      {editing && (
        <SetEditor
          candidate={editing}
          onCancel={() => setEditing(null)}
          onConfirm={(chosen) => confirm(editing, chosen)}
        />
      )}

      {offMeta && (
        <OffMetaEntry
          onCancel={() => setOffMeta(false)}
          onAdd={addOffMeta}
          teamSize={team.length}
        />
      )}

      <ScanNote maxScanned={maxScanned} />
    </div>
  );
}

/**
 * "Handles these threats" — the backward entry point.
 *
 * The design in the spec only works forward, from a Pokémon you already have
 * in mind. Real teambuilding starts at least as often from a problem: this
 * team loses to these three things, what fixes that. Selecting opponents here
 * filters the universe to sets with a good matchup into every one of them.
 */
function ThreatFilter({
  options,
  selected,
  onChange,
  threshold,
}: {
  options: Array<{id: string; label: string}>;
  selected: string[];
  onChange: (ids: string[]) => void;
  threshold: number;
}) {
  const [query, setQuery] = useState('');
  const available = options.filter(
    (o) => !selected.includes(o.id) && o.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="threat-filter">
      <div className="threat-filter-head">
        <span className="field-label">Handles these threats</span>
        <span className="muted">
          keeps only sets winning at least {Math.round(threshold * 100)}% against every one
        </span>
      </div>

      <div className="threat-chips">
        {selected.map((id) => (
          <span key={id} className="threat-chip">
            {options.find((o) => o.id === id)?.label ?? id}
            <button type="button" aria-label="Remove" onClick={() => onChange(selected.filter((s) => s !== id))}>
              ×
            </button>
          </span>
        ))}
        <input
          type="search"
          className="threat-input"
          value={query}
          placeholder={selected.length === 0 ? 'Add an opponent…' : 'Add another…'}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {query.trim() && (
        <ul className="threat-options">
          {available.slice(0, 8).map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, o.id]);
                  setQuery('');
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
          {available.length === 0 && <li className="muted">No match</li>}
        </ul>
      )}
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
          points of metagame win rate; they differ in whose win rate moves. If they
          still do not read against each other, the ranking needs three orderings
          rather than one number per axis.
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

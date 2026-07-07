import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Database } from 'sql.js';
import {
  loadMatchupDb, allVariantIds, suggestPartners, weakestMatchups,
  type ConditionId, type WeakMatchup,
} from '../lib/matchupDb';
import { useVariants } from '../lib/useVariants';
import Combobox from '../components/Combobox';
import ConditionSelect from '../components/ConditionSelect';
import MatchupCard from '../components/MatchupCard';

/** Both team-builder lists show the same number of rows. */
const TOP_N = 20;

function WeakMatchupCard({
  db, weak, condition, label,
}: {
  db: Database;
  weak: WeakMatchup;
  condition: ConditionId;
  label: (id: string) => string;
}) {
  return (
    <MatchupCard
      db={db}
      A={weak.best_member}
      B={weak.opponent}
      heading={`${label(weak.best_member)} vs ${label(weak.opponent)} by starting condition`}
    >
      <table className="weak-card-members">
        <thead>
          <tr><th>Core member</th><th>vs {label(weak.opponent)} ({condition})</th></tr>
        </thead>
        <tbody>
          {[...weak.per_member].sort((a, b) => b.p - a.p).map((m) => (
            <tr key={m.member} className={m.member === weak.best_member ? 'weak-best-member' : ''}>
              <td>
                {label(m.member)}
                {m.member === weak.best_member && <span className="weak-best-tag"> best answer</span>}
              </td>
              <td>{Math.round(m.p * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="weak-card-meta">
        Metagame weight of {label(weak.opponent)}: {(weak.weight * 100).toFixed(1)}% of teams ·
        best answer {Math.round(weak.team_best * 100)}% ·
        backup {weak.per_member.length > 1 ? `${Math.round(weak.team_second_best * 100)}%` : 'none'}
      </p>
    </MatchupCard>
  );
}

export default function TeamBuilderPage() {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const { variants, error, label, weights } = useVariants();
  const [core, setCore] = useState<string[]>([]);
  const [condition, setCondition] = useState<ConditionId>('fresh');

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setDbError(String(e)));
  }, []);

  const ids = useMemo(() => (db ? allVariantIds(db) : []), [db]);

  const suggestions = useMemo(() => {
    if (!db || core.length === 0 || !variants) return null;
    return suggestPartners(db, core, condition, weights).slice(0, TOP_N);
  }, [db, core, condition, variants, weights]);

  const weakest = useMemo(() => {
    if (!db || core.length === 0 || !variants) return null;
    return weakestMatchups(db, core, condition, weights).slice(0, TOP_N);
  }, [db, core, condition, variants, weights]);

  // accordion: id of the one expanded weakest-matchup row (or null)
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setExpanded(null), [core, condition]);

  const toggle = (id: string) => {
    setCore((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 4 ? [...c, id] : c));
  };

  if (error || dbError) return <div className="error-note">Could not load matchup data — {error ?? dbError}</div>;
  if (!db || !variants) return <div className="loading">Loading matchup matrix (~18 MB)…</div>;

  const sorted = [...ids].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));

  return (
    <div>
      <h1>Team-building assist</h1>
      <p className="subtitle">
        Pick 1–4 variants as your team core; candidates are ranked by how much
        they improve the core's worst 1v1 matchups, weighted by opponent usage
        and matchup urgency (fixing a 30% matchup counts more than polishing a
        60% one).
      </p>

      <div className="controls">
        <ConditionSelect value={condition} onChange={setCondition} />
      </div>

      <div className="core-picker">
        <Combobox
          options={sorted.filter((id) => !core.includes(id)).map((id) => ({ id, label: label(id) }))}
          placeholder={core.length >= 4 ? 'Core is full (4/4)' : 'Add Pokémon to core…'}
          disabled={core.length >= 4}
          onSelect={(id) => toggle(id)}
        />
        <div className="core-chips">
          {core.length === 0 && <span className="core-empty">No core picked yet — add 1–4 Pokémon.</span>}
          {core.map((id) => (
            <span key={id} className="core-chip">
              {label(id)}
              <button
                className="core-chip-remove"
                aria-label={`Remove ${label(id)} from core`}
                onClick={() => toggle(id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      {weakest && (
        <>
          <h2>Weakest matchups</h2>
          <p className="footer-note" style={{ marginTop: 0 }}>
            The core's worst opponents, ranked by usage-weighted best answer,
            then by usage-weighted backup answer — so once the field is broadly
            covered, matchups with no redundant answer rise to the top. Click a
            row for detail.
          </p>
          <div className="weak-list">
            {weakest.map((w) => (
              <div key={w.opponent} className="weak-row-wrap">
                <button
                  className={`weak-row${expanded === w.opponent ? ' expanded' : ''}`}
                  onClick={() => setExpanded(expanded === w.opponent ? null : w.opponent)}
                  aria-expanded={expanded === w.opponent}
                >
                  <span className="weak-opponent">{label(w.opponent)}</span>
                  <span className="weak-rate">
                    best: {Math.round(w.team_best * 100)}%
                    {w.per_member.length > 1 && ` · backup: ${Math.round(w.team_second_best * 100)}%`}
                  </span>
                  <span className="weak-caret">{expanded === w.opponent ? '▾' : '▸'}</span>
                </button>
                {expanded === w.opponent && (
                  <WeakMatchupCard db={db} weak={w} condition={condition} label={label} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {suggestions && (
        <>
          <h2>Suggested partners</h2>
          <table className="partners">
            <thead>
              <tr><th>#</th><th>Candidate</th><th>Coverage score</th><th>Biggest matchup fixes</th></tr>
            </thead>
            <tbody>
              {suggestions.map((s, i) => (
                <tr key={s.variant}>
                  <td>{i + 1}</td>
                  <td>{label(s.variant)}</td>
                  <td>{s.coverage_score.toFixed(3)}</td>
                  <td>
                    {s.top_improvements.map((imp) => (
                      <span key={imp.opponent} className="improvement">
                        <Link to={`/matchup/${s.variant}/${imp.opponent}`}>
                          {label(imp.opponent)}
                        </Link>{' '}
                        {Math.round(imp.before * 100)}%→{Math.round(imp.after * 100)}%
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

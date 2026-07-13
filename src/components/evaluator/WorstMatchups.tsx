import { useEffect, useMemo, useState } from 'react';
import type { Database } from 'sql.js';
import {
  loadMatchupDb, weakestMatchups, CONDITION_IDS, type ConditionId, type WeakMatchup,
} from '../../lib/matchupDb';
import { useVariants } from '../../lib/useVariants';
import ConditionSelect from '../ConditionSelect';
import ConditionSensitivity from '../ConditionSensitivity';
import MatchupCard from '../MatchupCard';
import { matchTeam } from '../../../lib/evaluator/match';
import type { ParsedSet } from '../../../lib/evaluator/parse';
import type { Variant } from '../../../lib/types';
import { setLabel } from './TeamInput';

const TOP_N = 12;

/** The team-builder's expanded weak-matchup card, reused verbatim. */
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
          <tr><th>Team member</th><th>vs {label(weak.opponent)} ({condition})</th></tr>
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

export default function WorstMatchups({ sets }: { sets: ParsedSet[] }) {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const { variants, error, label, weights } = useVariants();
  const [condition, setCondition] = useState<ConditionId>(CONDITION_IDS[0] as ConditionId);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setDbError(String(e)));
  }, []);

  // Map pasted sets to nearest known variants (item 05 upgrades this).
  const matches = useMemo(() => {
    if (!variants) return null;
    // VariantMeta is structurally a Variant for matching purposes.
    return matchTeam(sets, variants as unknown as Variant[]);
  }, [sets, variants]);

  const matched = useMemo(
    () => (matches ?? []).filter((m) => m.variantId !== null),
    [matches],
  );
  const core = useMemo(
    () => [...new Set(matched.map((m) => m.variantId!))],
    [matched],
  );

  const weakest = useMemo(() => {
    if (!db || core.length === 0 || !variants) return null;
    return weakestMatchups(db, core, condition, weights).slice(0, TOP_N);
  }, [db, core, condition, weights, variants]);

  useEffect(() => setExpanded(null), [core.join(','), condition]);

  if (error || dbError) return <div className="error-note">Could not load matchup data — {error ?? dbError}</div>;
  if (!db || !variants || !matches) return <div className="loading">Loading matchup matrix (~13 MB)…</div>;

  const unmatched = matches.filter((m) => m.variantId === null);
  const approximated = matches.filter((m) => m.variantId !== null && !m.exact);

  return (
    <div>
      {unmatched.length > 0 && (
        <p className="match-note error-note" style={{ padding: '8px 0' }}>
          Not in the metagame variant set: {unmatched.map((m) => setLabel(m.set)).join(', ')} —
          matchup analysis for custom sets needs on-demand simulation (backlog
          item 05); excluded here.
        </p>
      )}
      {approximated.length > 0 && (
        <div className="match-badges">
          {approximated.map((m, i) => (
            <p key={i} className="footer-note" style={{ margin: '2px 0' }}>
              {setLabel(m.set)} approximated as <strong>{label(m.variantId!)}</strong>
              {' '}({m.differences.join('; ')})
            </p>
          ))}
        </div>
      )}
      {matched.length < matches.length && matched.length > 0 && (
        <p className="footer-note">Based on {matched.length} of {matches.length} team members.</p>
      )}

      {core.length === 0 ? (
        <p className="footer-note">No team member maps to a known variant — nothing to analyze yet.</p>
      ) : (
        <>
          <div className="controls">
            <ConditionSelect value={condition} onChange={setCondition} />
          </div>

          <h3 className="wm-subhead">Condition sensitivity</h3>
          <ConditionSensitivity db={db} core={core} weights={weights} />

          <h3 className="wm-subhead">Weakest matchups</h3>
          {weakest && (
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
          )}
        </>
      )}
    </div>
  );
}

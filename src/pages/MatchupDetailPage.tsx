import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Database } from 'sql.js';
import { loadMatchupDb, allConditionsFor, type MatchupRow } from '../lib/matchupDb';
import { useVariants } from '../lib/useVariants';
import ConditionCards from '../components/ConditionCards';
import StatBlock from '../components/StatBlock';

export default function MatchupDetailPage() {
  const { A, B } = useParams<{ A: string; B: string }>();
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const { byId, error } = useVariants();

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setDbError(String(e)));
  }, []);

  const rows = useMemo(() => {
    if (!db || !A || !B) return null;
    const byCondition = new Map<string, MatchupRow>();
    for (const r of allConditionsFor(db, A, B)) byCondition.set(r.condition, r);
    return byCondition;
  }, [db, A, B]);

  if (error || dbError) return <div className="error-note">Could not load matchup data — {error ?? dbError}</div>;
  if (!rows || !A || !B) return <div className="loading">Loading…</div>;

  const vA = byId.get(A);
  const vB = byId.get(B);
  const fresh = rows.get('fresh');

  return (
    <div>
      <p><Link to="/matchups">← back to the matrix</Link></p>
      <h1>{vA?.species ?? A} vs {vB?.species ?? B}</h1>
      {fresh && (
        <p className="subtitle">
          Fresh 1v1: <strong>{Math.round(fresh.p_A_wins * 100)}%</strong> for {vA?.species ?? A}{' '}
          (95% CI {Math.round(fresh.ci_low * 100)}–{Math.round(fresh.ci_high * 100)}%,
          n={fresh.n_simulated}, mean {fresh.mean_turns.toFixed(1)} turns,
          {' '}{fresh.draws} draws).
        </p>
      )}

      <h2>By starting condition</h2>
      <ConditionCards rows={rows} />
      <p className="footer-note">
        Conditions are from side A's ({vA?.species ?? A}) perspective: e.g. tailwind_A
        means {vA?.species ?? A} has Tailwind up.
      </p>

      <h2>Sets used</h2>
      <div className="stat-blocks">
        {vA && <StatBlock v={vA} />}
        {vB && <StatBlock v={vB} />}
        {(!vA || !vB) && <p className="footer-note">(variant metadata unavailable for {!vA ? A : B})</p>}
      </div>
      <p className="footer-note">
        Spreads are SP (0–32); the battle uses each variant's top-4 eligible
        moves by usage. Per-turn HP timelines are not persisted in the matrix
        (run <code>npm run inspect-matchup -- --A {A} --B {B} --verbose</code> locally to see one).
      </p>
    </div>
  );
}

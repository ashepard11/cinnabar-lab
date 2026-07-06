import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Database } from 'sql.js';
import { loadMatchupDb, allConditionsFor, type MatchupRow } from '../lib/matchupDb';
import { fetchJSON } from '../lib';
import ConditionCards from '../components/ConditionCards';

interface VariantFull {
  id: string;
  species: string;
  item: string | null;
  ability: string;
  nature: string;
  sps: Record<string, number>;
  weight: number;
  moves: Array<{ name: string; usage: number }>;
}

function StatBlock({ v }: { v: VariantFull }) {
  const stats = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  return (
    <div className="stat-block">
      <h3>{v.species}{v.item ? ` @ ${v.item}` : ''}</h3>
      <p>{v.ability} · {v.nature}</p>
      <table>
        <tbody>
          <tr>{stats.map((s) => <th key={s}>{s.toUpperCase()}</th>)}</tr>
          <tr>{stats.map((s) => <td key={s}>{v.sps[s] ?? 0}</td>)}</tr>
        </tbody>
      </table>
      <p className="stat-block-moves">
        {v.moves.slice(0, 8).map((m) => `${m.name} (${Math.round(m.usage * 100)}%)`).join(' · ')}
      </p>
    </div>
  );
}

export default function MatchupDetailPage() {
  const { A, B } = useParams<{ A: string; B: string }>();
  const [db, setDb] = useState<Database | null>(null);
  const [variants, setVariants] = useState<VariantFull[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setError(String(e)));
    fetchJSON<{ variants: VariantFull[] }>('defender-variants.json')
      .then((d) => setVariants(d.variants))
      .catch((e) => setError(String(e)));
  }, []);

  const rows = useMemo(() => {
    if (!db || !A || !B) return null;
    const byCondition = new Map<string, MatchupRow>();
    for (const r of allConditionsFor(db, A, B)) byCondition.set(r.condition, r);
    return byCondition;
  }, [db, A, B]);

  if (error) return <div className="error-note">Could not load matchup data — {error}</div>;
  if (!rows || !A || !B) return <div className="loading">Loading…</div>;

  const vA = variants?.find((v) => v.id === A);
  const vB = variants?.find((v) => v.id === B);
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

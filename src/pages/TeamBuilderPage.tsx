import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Database } from 'sql.js';
import {
  loadMatchupDb, allVariantIds, suggestPartners,
  CONDITION_IDS, type ConditionId,
} from '../lib/matchupDb';
import { fetchJSON } from '../lib';

interface VariantMeta {
  id: string;
  species: string;
  item: string | null;
  weight: number;
}

export default function TeamBuilderPage() {
  const [db, setDb] = useState<Database | null>(null);
  const [variants, setVariants] = useState<VariantMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [core, setCore] = useState<string[]>([]);
  const [condition, setCondition] = useState<ConditionId>('fresh');

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setError(String(e)));
    fetchJSON<{ variants: VariantMeta[] }>('defender-variants.json')
      .then((d) => setVariants(d.variants))
      .catch((e) => setError(String(e)));
  }, []);

  const label = useMemo(() => {
    const m = new Map((variants ?? []).map((v) => [v.id, v]));
    return (id: string) => {
      const v = m.get(id);
      return v ? (v.item && !v.id.includes('mega') ? `${v.species} (${v.item})` : v.species) : id;
    };
  }, [variants]);

  const ids = useMemo(() => (db ? allVariantIds(db) : []), [db]);

  const suggestions = useMemo(() => {
    if (!db || core.length === 0 || !variants) return null;
    const weights = new Map(variants.map((v) => [v.id, v.weight]));
    return suggestPartners(db, core, condition, weights).slice(0, 20);
  }, [db, core, condition, variants]);

  const toggle = (id: string) => {
    setCore((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 4 ? [...c, id] : c));
  };

  if (error) return <div className="error-note">Could not load matchup data — {error}</div>;
  if (!db || !variants) return <div className="loading">Loading matchup matrix (~10 MB)…</div>;

  const sorted = [...ids].sort((a, b) => {
    const w = new Map(variants.map((v) => [v.id, v.weight]));
    return (w.get(b) ?? 0) - (w.get(a) ?? 0);
  });

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
        <label>
          Condition{' '}
          <select value={condition} onChange={(e) => setCondition(e.target.value as ConditionId)}>
            {CONDITION_IDS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <span className="core-summary">
          Core ({core.length}/4): {core.length ? core.map(label).join(' + ') : '(none picked)'}
        </span>
      </div>

      <div className="variant-picker">
        {sorted.map((id) => (
          <button
            key={id}
            className={`variant-chip${core.includes(id) ? ' selected' : ''}`}
            onClick={() => toggle(id)}
            disabled={!core.includes(id) && core.length >= 4}
          >
            {label(id)}
          </button>
        ))}
      </div>

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

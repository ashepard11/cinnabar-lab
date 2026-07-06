import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Database } from 'sql.js';
import { interpolateRdBu } from 'd3-scale-chromatic';
import {
  loadMatchupDb, allVariantIds, conditionRows, metadata,
  type ConditionId, type MatchupRow,
} from '../lib/matchupDb';
import { useVariants } from '../lib/useVariants';
import ConditionSelect from '../components/ConditionSelect';

type SortMode = 'usage' | 'winrate' | 'alpha';

/** p → cell color: blue = row wins, red = row loses, white ≈ 50/50. */
function cellShade(p: number): string {
  return interpolateRdBu(p);
}

export default function MatchupsPage() {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const { variants, error, label, weights } = useVariants();
  const [condition, setCondition] = useState<ConditionId>('fresh');
  const [sort, setSort] = useState<SortMode>('usage');

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setDbError(String(e)));
  }, []);

  const grid = useMemo(() => {
    if (!db) return null;
    const ids = allVariantIds(db);
    const rows = conditionRows(db, condition);
    const cell = new Map<string, MatchupRow>();
    const winSum = new Map<string, number>();
    const winCount = new Map<string, number>();
    for (const r of rows) {
      cell.set(`${r.variant_A}|${r.variant_B}`, r);
      winSum.set(r.variant_A, (winSum.get(r.variant_A) ?? 0) + r.p_A_wins);
      winCount.set(r.variant_A, (winCount.get(r.variant_A) ?? 0) + 1);
    }
    const avgWin = new Map<string, number>();
    for (const id of ids) avgWin.set(id, (winSum.get(id) ?? 0) / Math.max(1, winCount.get(id) ?? 1));
    return { ids, cell, avgWin };
  }, [db, condition]);

  const meta = useMemo(() => (db ? metadata(db) : null), [db]);

  const ordered = useMemo(() => {
    if (!grid) return [];
    const ids = [...grid.ids];
    if (sort === 'alpha') ids.sort();
    else if (sort === 'winrate') ids.sort((a, b) => (grid.avgWin.get(b) ?? 0) - (grid.avgWin.get(a) ?? 0));
    else ids.sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
    return ids;
  }, [grid, sort, weights]);

  if (error || dbError) return <div className="error-note">Could not load matchup data — {error ?? dbError}</div>;
  if (!grid) return <div className="loading">Loading matchup matrix (~18 MB)…</div>;

  return (
    <div>
      <h1>Matchup matrix</h1>
      <p className="subtitle">
        P(row beats column) in a simulated 1v1 Champions endgame, both sides on
        their modal set, {'≥'}20 seeded battles per cell (nash-d2 policy).
        Blue = row wins, red = row loses. Click a cell for detail.
      </p>
      <div className="controls">
        <ConditionSelect value={condition} onChange={setCondition} />
        <label>
          Sort{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="usage">by usage %</option>
            <option value="winrate">by average win rate</option>
            <option value="alpha">alphabetical</option>
          </select>
        </label>
      </div>
      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th className="matrix-corner" />
              {ordered.map((col) => (
                <th key={col} className="matrix-col-label" title={`${label(col)} — open Pokémon detail`}>
                  <Link to={`/pokemon/${col}`}><span>{label(col)}</span></Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((row) => (
              <tr key={row}>
                <th className="matrix-row-label" title={`${label(row)} — open Pokémon detail`}>
                  <Link to={`/pokemon/${row}`}>{label(row)}</Link>
                </th>
                {ordered.map((col) => {
                  if (row === col) return <td key={col} className="matrix-diag" />;
                  const r = grid.cell.get(`${row}|${col}`);
                  if (!r) return <td key={col} className="matrix-missing" title="not simulated" />;
                  const pct = Math.round(r.p_A_wins * 100);
                  return (
                    <td
                      key={col}
                      className="matrix-cell"
                      style={{ background: cellShade(r.p_A_wins), color: r.p_A_wins > 0.75 || r.p_A_wins < 0.25 ? '#fff' : '#222' }}
                      title={`${label(row)} beats ${label(col)}: ${pct}% (n=${r.n_simulated}, CI ${Math.round(r.ci_low * 100)}–${Math.round(r.ci_high * 100)})`}
                    >
                      <Link to={`/matchup/${row}/${col}`}>{pct}</Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && (
        <p className="footer-note">
          policy {meta.policy_id} v{meta.policy_version} — built {meta.built_at?.slice(0, 10)} —
          format {meta.format}
        </p>
      )}
    </div>
  );
}

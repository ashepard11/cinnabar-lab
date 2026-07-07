import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Database } from 'sql.js';
import {
  loadMatchupDb, rankByExpectedWinRate, metadata,
  CONDITION_IDS, type ConditionId,
} from '../lib/matchupDb';
import { useVariants } from '../lib/useVariants';
import ConditionSelect from '../components/ConditionSelect';

type SortKey = 'rank' | 'name' | 'winrate' | 'usage';
type SortDir = 'asc' | 'desc';
type MegaFilter = 'all' | 'mega' | 'non-mega';

interface Row {
  variant: string;
  name: string;
  rank: number;
  expected_win_rate: number;
  usage: number;
  is_mega: boolean;
}

/** Read the shareable condition from the URL, falling back to the default. */
function parseCondition(raw: string | null): ConditionId {
  return (CONDITION_IDS as readonly string[]).includes(raw ?? '')
    ? (raw as ConditionId)
    : 'fresh';
}

export default function RankingsPage() {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const { variants, error, label, weights, weightsNormalized, byId } = useVariants();
  const [searchParams, setSearchParams] = useSearchParams();
  const condition = parseCondition(searchParams.get('condition'));
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'winrate', dir: 'desc' });
  const [megaFilter, setMegaFilter] = useState<MegaFilter>('all');

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setDbError(String(e)));
  }, []);

  // Condition lives in the query param so a filtered view is a shareable link.
  const setCondition = (c: ConditionId) => {
    const next = new URLSearchParams(searchParams);
    next.set('condition', c);
    setSearchParams(next, { replace: true });
  };

  // Rank is fixed to the win-rate order (each variant's standing in the meta);
  // it stays attached to the variant even when the table is sorted by another
  // column, so you can see e.g. that the most-used mon ranks #14.
  const ranked = useMemo<Row[] | null>(() => {
    if (!db || !variants) return null;
    return rankByExpectedWinRate(db, condition, weightsNormalized).map((r, i) => ({
      variant: r.variant,
      name: label(r.variant),
      rank: i + 1,
      expected_win_rate: r.expected_win_rate,
      usage: weights.get(r.variant) ?? 0,
      is_mega: byId.get(r.variant)?.is_mega ?? false,
    }));
  }, [db, variants, condition, weightsNormalized, weights, label, byId]);

  const rows = useMemo(() => {
    if (!ranked) return [];
    const filtered = ranked.filter((r) =>
      megaFilter === 'all' ? true : megaFilter === 'mega' ? r.is_mega : !r.is_mega);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'name': return dir * a.name.localeCompare(b.name);
        case 'usage': return dir * (a.usage - b.usage);
        case 'rank': return dir * (a.rank - b.rank);
        case 'winrate':
        default: return dir * (a.expected_win_rate - b.expected_win_rate);
      }
    });
  }, [ranked, sort, megaFilter]);

  const meta = useMemo(() => (db ? metadata(db) : null), [db]);

  if (error || dbError) return <div className="error-note">Could not load matchup data — {error ?? dbError}</div>;
  if (!ranked) return <div className="loading">Loading matchup matrix (~18 MB)…</div>;

  const toggleSort = (key: SortKey) =>
    setSort((s) => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' });
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div>
      <h1>Metagame power rankings</h1>
      <p className="subtitle">
        Every variant ranked by its metagame-weighted win rate: the average chance
        it beats a random opponent drawn from the field by usage, in a simulated
        1v1 Champions endgame under the selected starting condition. The 50/50
        mirror is included. Switch the condition to see who rises — e.g. who's most
        dangerous in Trick Room.
      </p>
      <div className="controls">
        <ConditionSelect value={condition} onChange={setCondition} />
        <label>
          Show{' '}
          <select value={megaFilter} onChange={(e) => setMegaFilter(e.target.value as MegaFilter)}>
            <option value="all">all Pokémon</option>
            <option value="mega">Megas only</option>
            <option value="non-mega">non-Megas only</option>
          </select>
        </label>
      </div>
      <div className="rankings-scroll">
        <table className="rankings">
          <thead>
            <tr>
              <th className="rank-num sortable" onClick={() => toggleSort('rank')}>#{arrow('rank')}</th>
              <th className="sortable" onClick={() => toggleSort('name')}>Pokémon{arrow('name')}</th>
              <th className="rank-num sortable" onClick={() => toggleSort('winrate')}>Win rate{arrow('winrate')}</th>
              <th className="rank-num sortable" onClick={() => toggleSort('usage')}>Usage{arrow('usage')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variant}>
                <td className="rank-num">{r.rank}</td>
                <td>
                  <Link className="rank-variant" to={`/pokemon/${r.variant}`}>{r.name}</Link>
                </td>
                <td className="rank-num rank-winrate">{(r.expected_win_rate * 100).toFixed(1)}%</td>
                <td className="rank-num rank-usage">{(r.usage * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && (
        <p className="footer-note">
          Win rate = Σ over the field of usage-weight(V) × P(this variant beats V)
          under “{condition}”, weights normalized to the field and the mirror
          counted at 50%. Usage is the raw team-inclusion rate. policy{' '}
          {meta.policy_id} v{meta.policy_version} — built {meta.built_at?.slice(0, 10)}.
        </p>
      )}
    </div>
  );
}

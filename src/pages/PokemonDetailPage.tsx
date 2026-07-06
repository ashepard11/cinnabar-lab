import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Database } from 'sql.js';
import {
  loadMatchupDb, allVariantIds, rankOpponents,
  type ConditionId, type RankSort, type RankedOpponent,
} from '../lib/matchupDb';
import { useVariants } from '../lib/useVariants';
import Combobox from '../components/Combobox';
import ConditionSelect from '../components/ConditionSelect';
import MatchupCard from '../components/MatchupCard';

/** Rows per list (best and worst). */
const TOP_N = 5;

function MatchupList({
  title, rows, selected, db, label, expanded, onToggle,
}: {
  title: string;
  rows: RankedOpponent[];
  selected: string;
  db: Database;
  label: (id: string) => string;
  expanded: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="ranked-list">
      <h2>{title}</h2>
      <div className="weak-list">
        {rows.map((r) => (
          <div key={r.opponent} className="weak-row-wrap">
            <button
              className={`weak-row${expanded === r.opponent ? ' expanded' : ''}`}
              onClick={() => onToggle(r.opponent)}
              aria-expanded={expanded === r.opponent}
            >
              <span className="weak-opponent">{label(r.opponent)}</span>
              <span className={r.p >= 0.5 ? 'ranked-rate-win' : 'weak-rate'}>
                {Math.round(r.p * 100)}%
              </span>
              <span className="weak-caret">{expanded === r.opponent ? '▾' : '▸'}</span>
            </button>
            {expanded === r.opponent && (
              <MatchupCard
                db={db}
                A={selected}
                B={r.opponent}
                heading={`${label(selected)} vs ${label(r.opponent)} by starting condition`}
              >
                <p className="weak-card-meta">
                  Metagame weight of {label(r.opponent)}: {(r.weight * 100).toFixed(1)}% of teams
                </p>
              </MatchupCard>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PokemonDetailPage() {
  const { variantId } = useParams<{ variantId: string }>();
  const navigate = useNavigate();
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const { variants, error, label, weights, byId } = useVariants();
  const [condition, setCondition] = useState<ConditionId>('fresh');
  const [sort, setSort] = useState<RankSort>('weighted');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setDbError(String(e)));
  }, []);
  useEffect(() => setExpanded(null), [variantId, condition, sort]);

  const ids = useMemo(() => (db ? allVariantIds(db) : []), [db]);
  const selected = variantId && ids.includes(variantId) ? variantId : null;

  const ranked = useMemo(() => {
    if (!db || !selected || !variants) return null;
    return rankOpponents(db, selected, condition, weights, sort, TOP_N);
  }, [db, selected, condition, weights, sort, variants]);

  if (error || dbError) return <div className="error-note">Could not load matchup data — {error ?? dbError}</div>;
  if (!db || !variants) return <div className="loading">Loading matchup matrix (~18 MB)…</div>;

  const sorted = [...ids].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
  const meta = selected ? byId.get(selected) : undefined;

  return (
    <div>
      <h1>{selected ? label(selected) : 'Pokémon detail'}</h1>
      <p className="subtitle">
        {selected
          ? `Best and worst 1v1 endgame matchups for ${label(selected)}` +
            (meta ? ` (${meta.ability} · ${meta.nature})` : '') + ' against the metagame.'
          : 'Pick a Pokémon to see its best and worst 1v1 endgame matchups against the metagame.'}
      </p>

      <div className="core-picker">
        <Combobox
          options={sorted.filter((id) => id !== selected).map((id) => ({ id, label: label(id) }))}
          placeholder={selected ? `Switch Pokémon (current: ${label(selected)})…` : 'Select a Pokémon…'}
          onSelect={(id) => navigate(`/pokemon/${id}`)}
        />
      </div>

      {selected && (
        <div className="controls">
          <ConditionSelect value={condition} onChange={setCondition} />
          <label>
            Sort{' '}
            <select value={sort} onChange={(e) => setSort(e.target.value as RankSort)}>
              <option value="weighted">Metagame-weighted</option>
              <option value="raw">Raw win rate</option>
            </select>
          </label>
        </div>
      )}

      {ranked && selected && (
        <div className="ranked-columns">
          <MatchupList
            title="Best matchups"
            rows={ranked.best}
            selected={selected}
            db={db}
            label={label}
            expanded={expanded}
            onToggle={(id) => setExpanded(expanded === id ? null : id)}
          />
          <MatchupList
            title="Worst matchups"
            rows={ranked.worst}
            selected={selected}
            db={db}
            label={label}
            expanded={expanded}
            onToggle={(id) => setExpanded(expanded === id ? null : id)}
          />
        </div>
      )}

      {selected && (
        <p className="footer-note">
          Win rates are P({label(selected)} wins) in a simulated 1v1 endgame under the
          selected starting condition. "Metagame-weighted" ranks by usage ×
          win rate (best) / usage × loss rate (worst) — the same philosophy the
          team builder uses; "raw win rate" ignores usage.
        </p>
      )}
    </div>
  );
}

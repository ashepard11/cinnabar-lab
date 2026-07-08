import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Database } from 'sql.js';
import {
  loadMatchupDb, allVariantIds, suggestPartners, weakestMatchups, weakMatchupFor,
  CONDITION_IDS, type ConditionId, type WeakMatchup,
} from '../lib/matchupDb';
import { useVariants } from '../lib/useVariants';
import Combobox from '../components/Combobox';
import ConditionSelect from '../components/ConditionSelect';
import ConditionSensitivity from '../components/ConditionSensitivity';
import MatchupCard from '../components/MatchupCard';

/** Both team-builder lists show the same number of rows. */
const TOP_N = 20;

/** Mega variants carry `_mega` in their id (e.g. charizard_mega_y, froslass_mega). */
const isMega = (id: string) => /_mega(_|$)/.test(id);

type PartnerFilter = 'all' | 'mega' | 'non_mega';
const PARTNER_FILTER_LABELS: Record<PartnerFilter, string> = {
  all: 'All Pokémon',
  mega: 'Megas only',
  non_mega: 'Non-megas only',
};

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

  // Core and condition live in the URL query so the whole view is shareable:
  //   /team-builder?core=charizard_mega_y,floette_mega&condition=sun
  // condition defaults to (and is omitted for) fresh, matching prior behaviour.
  const [searchParams, setSearchParams] = useSearchParams();
  const core = useMemo(() => {
    const raw = searchParams.get('core');
    return raw ? raw.split(',').filter(Boolean).slice(0, 4) : [];
  }, [searchParams]);
  const conditionParam = searchParams.get('condition');
  const condition: ConditionId = (CONDITION_IDS as readonly string[]).includes(conditionParam ?? '')
    ? (conditionParam as ConditionId)
    : 'fresh';

  const setCore = (updater: string[] | ((prev: string[]) => string[])) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      const current = (p.get('core') ?? '').split(',').filter(Boolean);
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (next.length) p.set('core', next.join(',')); else p.delete('core');
      return p;
    }, { replace: true });
  };
  const setCondition = (c: ConditionId) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (c === 'fresh') p.delete('condition'); else p.set('condition', c);
      return p;
    }, { replace: true });
  };

  useEffect(() => {
    loadMatchupDb().then(setDb).catch((e) => setDbError(String(e)));
  }, []);

  const ids = useMemo(() => (db ? allVariantIds(db) : []), [db]);

  const [partnerFilter, setPartnerFilter] = useState<PartnerFilter>('all');

  // Full ranking (expensive) recomputes only on core/condition change; the
  // mega filter re-slices the cached result without re-scoring.
  const allSuggestions = useMemo(() => {
    if (!db || core.length === 0 || !variants) return null;
    return suggestPartners(db, core, condition, weights);
  }, [db, core, condition, variants, weights]);

  const suggestions = useMemo(() => {
    if (!allSuggestions) return null;
    const filtered = partnerFilter === 'all'
      ? allSuggestions
      : allSuggestions.filter((s) => isMega(s.variant) === (partnerFilter === 'mega'));
    return filtered.slice(0, TOP_N);
  }, [allSuggestions, partnerFilter]);

  const weakest = useMemo(() => {
    if (!db || core.length === 0 || !variants) return null;
    return weakestMatchups(db, core, condition, weights).slice(0, TOP_N);
  }, [db, core, condition, variants, weights]);

  // accordion: id of the one expanded weakest-matchup row (or null)
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setExpanded(null), [core, condition]);

  // "check specific matchup" probe: an arbitrary opponent, shown expanded
  const [probe, setProbe] = useState<string | null>(null);
  useEffect(() => setProbe(null), [core]);
  const probeMatchup = useMemo(() => {
    if (!db || !probe || core.length === 0 || !variants) return null;
    return weakMatchupFor(db, core, condition, weights, probe);
  }, [db, probe, core, condition, weights, variants]);

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

      {core.length > 0 && (
        <>
          <h2>Condition sensitivity</h2>
          <p className="footer-note" style={{ marginTop: 0 }}>
            The core's metagame-weighted average win rate under each starting
            condition (best core member vs each opponent, weighted by opponent
            usage). Bars sorted by shift from <code>fresh</code>; the dashed line
            marks the <code>fresh</code> baseline. This sweep is independent of
            the condition selector above.
          </p>
          <ConditionSensitivity db={db} core={core} weights={weights} />
        </>
      )}

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

      {weakest && (
        <>
          <h2>Check specific matchup</h2>
          <p className="footer-note" style={{ marginTop: 0 }}>
            Probe any opponent outside the weakest-N list: see how the core's
            best answer fares against it under each starting condition.
          </p>
          <div className="core-picker">
            <Combobox
              options={sorted.filter((id) => !core.includes(id)).map((id) => ({ id, label: label(id) }))}
              placeholder="Check specific matchup…"
              onSelect={(id) => setProbe(id)}
            />
            {probe && probeMatchup && (
              <div className="core-chips">
                <span className="core-chip">
                  vs {label(probe)}
                  <button
                    className="core-chip-remove"
                    aria-label={`Clear ${label(probe)} matchup`}
                    onClick={() => setProbe(null)}
                  >
                    ✕
                  </button>
                </span>
              </div>
            )}
          </div>
          {probe && probeMatchup && (
            <WeakMatchupCard db={db} weak={probeMatchup} condition={condition} label={label} />
          )}
        </>
      )}

      {suggestions && (
        <>
          <div className="section-head">
            <h2>Suggested partners</h2>
            <label className="partner-filter">
              Show{' '}
              <select
                value={partnerFilter}
                onChange={(e) => setPartnerFilter(e.target.value as PartnerFilter)}
              >
                {(Object.keys(PARTNER_FILTER_LABELS) as PartnerFilter[]).map((f) => (
                  <option key={f} value={f}>{PARTNER_FILTER_LABELS[f]}</option>
                ))}
              </select>
            </label>
          </div>
          {suggestions.length === 0 ? (
            <p className="ranked-empty">
              No {partnerFilter === 'mega' ? 'mega' : 'non-mega'} candidates improve this core's coverage.
            </p>
          ) : (
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
          )}
        </>
      )}
    </div>
  );
}

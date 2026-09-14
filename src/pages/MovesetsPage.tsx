import {useEffect, useMemo, useState} from 'react';
import {fetchJSON} from '../lib';
import type {Variant, VariantsData} from '../../lib/types';

/** A set whose four moves sum to under this is flagged low confidence. */
const LOW_CONFIDENCE_CUMULATIVE = 2.5;

interface ResolvedSet {
  variant: Variant;
  moves: Array<{name: string; usage: number}>;
  /** Sum of the chosen moves' usage. Under 250% means the set is a guess. */
  cumulative: number;
  lowConfidence: boolean;
  /** Moves ranked 5th and beyond, which an override might promote. */
  alternatives: Array<{name: string; usage: number}>;
}

/**
 * Movesets (SPEC-teambuilder.md Phase 1).
 *
 * Pikalytics reports per-move usage percentages, not four-move sets.
 * Converting one to the other needs a rule, the rule will sometimes be wrong,
 * and so it produces a reviewable artifact rather than a final answer. This
 * screen is that review.
 *
 * The usage numbers are real — they come from `defender-variants.json`. The
 * selection shown is the simple top-four, which is what the pipeline produces
 * today; Phase 2's corrections (near-substitute suppression, the Protect rule,
 * multiple sets per bucket) are not built yet, so this screen deliberately
 * shows the naive choice alongside the alternatives it passed over. That makes
 * the cases the rule will get wrong visible before the rule is written, which
 * is the point of reviewing it now.
 *
 * Edits are held in memory. Writing them to `data/moveset-overrides.json`
 * needs somewhere to write to — a static site cannot — so the export button
 * produces the file contents for now.
 */
export default function MovesetsPage() {
  const [data, setData] = useState<VariantsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [tierFilter, setTierFilter] = useState<'all' | 'core' | 'extended'>('core');

  useEffect(() => {
    fetchJSON<VariantsData>('defender-variants.json')
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  const sets: ResolvedSet[] = useMemo(() => {
    if (!data) return [];
    return data.variants
      .filter((v) => tierFilter === 'all' || v.tier === tierFilter)
      .map((variant) => {
        const ranked = [...variant.moves].sort((a, b) => b.usage - a.usage);
        const chosen = overrides[variant.id]
          ? overrides[variant.id].map((name) => ranked.find((m) => m.name === name) ?? {name, usage: 0})
          : ranked.slice(0, 4);
        const cumulative = chosen.reduce((s, m) => s + m.usage, 0);
        return {
          variant,
          moves: chosen,
          cumulative,
          lowConfidence: cumulative < LOW_CONFIDENCE_CUMULATIVE,
          alternatives: ranked.filter((m) => !chosen.some((c) => c.name === m.name)).slice(0, 6),
        };
      })
      // Low confidence first: the sets most likely to be wrong are the ones
      // worth a human's attention, and burying them under the obvious ones
      // wastes the review.
      .sort((a, b) => Number(b.lowConfidence) - Number(a.lowConfidence) || a.cumulative - b.cumulative);
  }, [data, overrides, tierFilter]);

  function swap(variantId: string, out: string, incoming: string) {
    setOverrides((o) => {
      const current = o[variantId] ?? sets.find((s) => s.variant.id === variantId)!.moves.map((m) => m.name);
      return {...o, [variantId]: current.map((m) => (m === out ? incoming : m))};
    });
  }

  function reset(variantId: string) {
    setOverrides((o) => {
      const next = {...o};
      delete next[variantId];
      return next;
    });
  }

  const overrideCount = Object.keys(overrides).length;
  const exportPayload = JSON.stringify(
    Object.fromEntries(
      Object.entries(overrides).map(([id, moves]) => [id, {moves, note: notes[id] ?? ''}])
    ),
    null,
    2
  );

  if (error) return <div className="page"><p className="error">Failed to load variants: {error}</p></div>;
  if (!data) return <div className="page"><p>Loading…</p></div>;

  return (
    <div className="page movesets-page">
      <header className="page-head">
        <h1>Movesets</h1>
        <p className="subtitle" title="Pikalytics publishes per-move usage, not four-move sets. The selection shown is the plain top four; Phase 2's corrections are not built yet.">
          Generated movesets against the usage they came from. Low confidence first.
        </p>
      </header>

      <div className="moveset-controls">
        <div className="sort-toggle" role="group" aria-label="Filter by tier">
          {(['core', 'extended', 'all'] as const).map((t) => (
            <button key={t} type="button" className={tierFilter === t ? 'active' : ''} onClick={() => setTierFilter(t)}>
              {t}
            </button>
          ))}
        </div>
        <span className="muted">
          {sets.length} sets · {sets.filter((s) => s.lowConfidence).length} low confidence ·{' '}
          {overrideCount} edited
        </span>
      </div>

      <ol className="moveset-list">
        {sets.map((set) => (
          <li key={set.variant.id} className={set.lowConfidence ? 'moveset low' : 'moveset'}>
            <div className="moveset-head">
              <div>
                <strong>{set.variant.species}</strong>{' '}
                <span className="muted">{set.variant.set_label ?? set.variant.item ?? 'No item'}</span>
                {set.lowConfidence && (
                  <span
                    className="badge-warn"
                    title={`The four chosen moves sum to ${(set.cumulative * 100).toFixed(0)}% cumulative usage. Under 250% means no four moves dominate, so the selection is a guess.`}
                  >
                    low confidence
                  </span>
                )}
                {overrides[set.variant.id] && <span className="badge-active">edited</span>}
              </div>
              <span className="moveset-cumulative">
                {(set.cumulative * 100).toFixed(0)}% cumulative
              </span>
            </div>

            <div className="moveset-body">
              <ul className="chosen-moves">
                {set.moves.map((m) => (
                  <li key={m.name}>
                    <span className="move-name">{m.name}</span>
                    <span className="move-usage">{(m.usage * 100).toFixed(0)}%</span>
                    <span className="move-bar" style={{width: `${Math.min(100, m.usage * 100)}%`}} />
                  </li>
                ))}
              </ul>

              <div className="alternatives">
                <span className="alt-label">Passed over</span>
                {set.alternatives.length === 0 && <span className="muted">nothing else recorded</span>}
                {set.alternatives.map((alt) => (
                  <div key={alt.name} className="alt-row">
                    <span className="move-name">{alt.name}</span>
                    <span className="move-usage">{(alt.usage * 100).toFixed(0)}%</span>
                    <select
                      value=""
                      aria-label={`Swap ${alt.name} in`}
                      onChange={(e) => e.target.value && swap(set.variant.id, e.target.value, alt.name)}
                    >
                      <option value="">swap in for…</option>
                      {set.moves.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {overrides[set.variant.id] && (
              <div className="moveset-note">
                <input
                  type="text"
                  placeholder="Why this override? (written to the file)"
                  value={notes[set.variant.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({...n, [set.variant.id]: e.target.value}))}
                />
                <button type="button" className="link" onClick={() => reset(set.variant.id)}>
                  Reset
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {overrideCount > 0 && (
        <section className="override-export">
          <h2 title="Overrides are version-controlled and survive a rescrape. A static site cannot write the file, so copy this in.">
            data/moveset-overrides.json
          </h2>
          <pre>{exportPayload}</pre>
        </section>
      )}
    </div>
  );
}

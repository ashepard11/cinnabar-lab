import {useState} from 'react';
import {
  CATEGORY_LABELS,
  SUPPORT_CATEGORIES,
  POSITIONING_CATEGORIES,
  type EffectCategory,
} from '../../../lib/teambuilder/types';

export type MegaFilter = 'all' | 'mega' | 'non-mega';

export interface FilterState {
  threats: string[];
  mega: MegaFilter;
  /** Candidate must supply something in this category. */
  supports: EffectCategory | '';
  query: string;
}

export const EMPTY_FILTERS: FilterState = {threats: [], mega: 'all', supports: '', query: ''};

/** Categories offered in the "supplies" filter, deduplicated across both lists. */
const FILTERABLE: EffectCategory[] = [
  ...SUPPORT_CATEGORIES,
  ...POSITIONING_CATEGORIES.filter((c) => !SUPPORT_CATEGORIES.includes(c)),
];

/**
 * The filter bar over the candidate universe.
 *
 * Filtering is how the full universe stays usable: ranking decides what floats
 * to the top, filtering decides what is in scope at all. "Handles these
 * threats" is the backward entry point — start from the problem rather than
 * from a Pokémon — and sits alongside the structural filters rather than above
 * them, because a user narrowing to non-Megas that bring speed control and
 * beat these three things is doing one thing, not three.
 */
export default function CandidateFilters({
  options,
  filters,
  onChange,
  threshold,
  matching,
  total,
}: {
  options: Array<{id: string; label: string}>;
  filters: FilterState;
  onChange: (next: FilterState) => void;
  threshold: number;
  matching: number;
  total: number;
}) {
  const [threatQuery, setThreatQuery] = useState('');
  const available = options.filter(
    (o) =>
      !filters.threats.includes(o.id) &&
      o.label.toLowerCase().includes(threatQuery.trim().toLowerCase())
  );

  const active =
    filters.threats.length > 0 || filters.mega !== 'all' || filters.supports !== '' || !!filters.query;

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <label className="filter">
          <span className="field-label">Mega</span>
          <div className="sort-toggle" role="group" aria-label="Filter by Mega">
            {(['all', 'mega', 'non-mega'] as MegaFilter[]).map((m) => (
              <button
                key={m}
                type="button"
                className={filters.mega === m ? 'active' : ''}
                onClick={() => onChange({...filters, mega: m})}
              >
                {m === 'non-mega' ? 'Non-Mega' : m === 'mega' ? 'Mega' : 'All'}
              </button>
            ))}
          </div>
        </label>

        <label className="filter">
          <span className="field-label">Supplies</span>
          <select
            value={filters.supports}
            onChange={(e) => onChange({...filters, supports: e.target.value as EffectCategory | ''})}
          >
            <option value="">Anything</option>
            {FILTERABLE.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="filter">
          <span className="field-label">Find a Pokémon</span>
          <input
            type="search"
            value={filters.query}
            placeholder="Species or set"
            onChange={(e) => onChange({...filters, query: e.target.value})}
          />
        </label>

        <span className="filter-count">
          <strong>{matching}</strong> of {total}
          {active && (
            <button type="button" className="link" onClick={() => onChange(EMPTY_FILTERS)}>
              clear
            </button>
          )}
        </span>
      </div>

      <div className="threat-filter">
        <div className="threat-filter-head">
          <span className="field-label">Handles these threats</span>
          <span className="muted">
            keeps only sets winning at least {Math.round(threshold * 100)}% against every one
          </span>
        </div>

        <div className="threat-chips">
          {filters.threats.map((id) => (
            <span key={id} className="threat-chip">
              {options.find((o) => o.id === id)?.label ?? id}
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onChange({...filters, threats: filters.threats.filter((t) => t !== id)})}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="search"
            className="threat-input"
            value={threatQuery}
            placeholder={filters.threats.length === 0 ? 'Add an opponent…' : 'Add another…'}
            onChange={(e) => setThreatQuery(e.target.value)}
          />
        </div>

        {threatQuery.trim() && (
          <ul className="threat-options">
            {available.slice(0, 8).map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({...filters, threats: [...filters.threats, o.id]});
                    setThreatQuery('');
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {available.length === 0 && <li className="muted">No match</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

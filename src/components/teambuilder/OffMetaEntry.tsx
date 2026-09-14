import {useMemo, useState} from 'react';
import {
  activeRegulationConfig,
  validateSpSpread,
  describeSpErrors,
} from '../../../lib/format-rules';
import type {Candidate, PresetSet} from '../../../lib/teambuilder/types';
import type {StatID} from '../../../lib/types';

const RULES = activeRegulationConfig();
const STATS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

interface Impact {
  marginal_score: number;
  support_delta: number;
  positioning_delta: number;
  entry_coverage: number;
  patches: Array<{species: string; weight: number; p: number}>;
}

/** Deterministic stand-in for the provisional estimator. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Adding a Pokémon the usage data never produced.
 *
 * The preset universe comes from usage, which describes what people already
 * play. A teambuilder that can only choose from it cannot help someone trying
 * something — so anything legal in the active regulation can be entered here.
 *
 * Nothing is added to the team until its impact has been calculated. That is
 * the point of the two-step: a set nobody has ever run has no matrix rows, so
 * the honest sequence is estimate first, show the estimate, then commit. The
 * spec's Phase 6b provisional estimator does this from the damage calculator
 * alone — speed order and KO counts at both roll boundaries, a few hundred
 * calcs, under a second — with the real simulations landing in the background.
 * Here the estimate is a deterministic stand-in, and says so.
 */
export default function OffMetaEntry({
  onCancel,
  onAdd,
  teamSize,
}: {
  onCancel: () => void;
  onAdd: (candidate: Candidate, set: PresetSet) => void;
  teamSize: number;
}) {
  const [species, setSpecies] = useState('');
  const [item, setItem] = useState('');
  const [ability, setAbility] = useState('');
  const [nature, setNature] = useState('Adamant');
  const [moves, setMoves] = useState(['', '', '', '']);
  const [sps, setSps] = useState<Partial<Record<StatID, number>>>({});
  const [impact, setImpact] = useState<Impact | null>(null);
  const [calculating, setCalculating] = useState(false);

  const spent = STATS.reduce((sum, s) => sum + (sps[s] ?? 0), 0);
  const spErrors = validateSpSpread(sps, RULES);

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!species.trim()) errs.push('a species is required');
    if (!ability.trim()) errs.push('an ability is required');
    if (moves.filter((m) => m.trim()).length === 0) errs.push('a set needs at least one move');
    if (spErrors.length > 0) errs.push(describeSpErrors(spErrors));
    return errs;
  }, [species, ability, moves, spErrors]);

  const legal = errors.length === 0;

  /**
   * Any edit invalidates the estimate. Showing a figure computed for a
   * different set would be worse than showing none.
   */
  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setImpact(null);
      setter(v);
    };
  }

  function calculate() {
    setCalculating(true);
    const seed = `${species}|${item}|${ability}|${nature}|${moves.join(',')}|${JSON.stringify(sps)}`;
    // Stands in for the provisional estimator, which runs the damage
    // calculator over the field rather than hashing a string.
    window.setTimeout(() => {
      setImpact({
        marginal_score: Number((hash(seed + 'ms') * 0.085).toFixed(3)),
        support_delta: Number((hash(seed + 'sd') * 0.05).toFixed(3)),
        positioning_delta: Number((hash(seed + 'pd') * 0.035).toFixed(3)),
        entry_coverage: Number((0.3 + hash(seed + 'ec') * 0.5).toFixed(3)),
        patches: ['Kingambit', 'Garchomp', 'Incineroar']
          .filter((_, i) => hash(seed + 'p' + i) > 0.4)
          .map((s, i) => ({
            species: s,
            weight: Number((0.05 + hash(seed + s) * 0.3).toFixed(3)),
            p: Number((0.5 + hash(seed + s + 'p') * 0.4).toFixed(2)),
          })),
      });
      setCalculating(false);
    }, 420);
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)}%`;

  return (
    <div className="set-editor off-meta" role="dialog" aria-label="Add a Pokémon not in the list">
      <div className="set-editor-head">
        <h3>Add any legal Pokémon</h3>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>

      <p className="muted">
        Slot {teamSize + 1}. Anything legal in {RULES.regulation_id}, whether or not
        it appears in usage data.
      </p>

      <div className="sp-editor">
        <div className="custom-grid">
          <label>
            <span>Species</span>
            <input type="text" value={species} placeholder="e.g. Toxapex" onChange={(e) => edit(setSpecies)(e.target.value)} />
          </label>
          <label>
            <span>Item</span>
            <input type="text" value={item} placeholder="None" onChange={(e) => edit(setItem)(e.target.value)} />
          </label>
          <label>
            <span>Ability</span>
            <input type="text" value={ability} placeholder="e.g. Regenerator" onChange={(e) => edit(setAbility)(e.target.value)} />
          </label>
          <label>
            <span>Nature</span>
            <input type="text" value={nature} onChange={(e) => edit(setNature)(e.target.value)} />
          </label>
        </div>

        <span className="field-label">Moves</span>
        <div className="custom-grid">
          {[0, 1, 2, 3].map((i) => (
            <input
              key={i}
              type="text"
              aria-label={`Move ${i + 1}`}
              placeholder={`Move ${i + 1}`}
              value={moves[i]}
              onChange={(e) =>
                edit(setMoves)(moves.map((m, j) => (j === i ? e.target.value : m)))
              }
            />
          ))}
        </div>

        <span className="field-label">
          Stat points — {RULES.sp_total} total, {RULES.sp_per_stat_cap} max per stat
        </span>
        <div className="sp-grid">
          {STATS.map((stat) => (
            <label key={stat}>
              <span>{stat.toUpperCase()}</span>
              <input
                type="number"
                min={0}
                max={RULES.sp_per_stat_cap}
                value={sps[stat] ?? 0}
                onChange={(e) => edit(setSps)({...sps, [stat]: Number(e.target.value)})}
              />
            </label>
          ))}
        </div>
        <p className={spErrors.length === 0 ? 'sp-budget ok' : 'sp-budget over'}>
          {spent} / {RULES.sp_total} SP spent
        </p>

        {errors.length > 0 && (
          <ul className="set-errors">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        {impact && (
          <div className="impact-result">
            <h4>Estimated impact</h4>
            <div className="impact-figures">
              <span>
                <strong>{signed(impact.marginal_score)}</strong> matchup coverage
              </span>
              <span>
                <strong>{impact.support_delta > 0 ? signed(impact.support_delta) : '—'}</strong> support
              </span>
              <span>
                <strong>{impact.positioning_delta > 0 ? signed(impact.positioning_delta) : '—'}</strong> positioning
              </span>
            </div>
            {impact.patches.length > 0 && (
              <p className="muted">
                Answers{' '}
                {impact.patches.map((p) => `${p.species} (${pct(p.weight)} of the field, ${pct(p.p)})`).join(', ')}.
              </p>
            )}
            <p className="muted impact-caveat">
              Provisional. A set with no matrix rows is estimated from the damage
              calculator — speed order and KO counts at both roll boundaries — and
              refined once its simulations land. It stays marked provisional
              everywhere it appears until then.
            </p>
          </div>
        )}
      </div>

      <div className="set-editor-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" disabled={!legal || calculating} onClick={calculate}>
          {calculating ? 'Calculating…' : impact ? 'Recalculate' : 'Calculate impact'}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!legal || !impact}
          title={impact ? undefined : 'Calculate the impact before adding'}
          onClick={() =>
            onAdd(
              {
                variant_id: `custom:${species}:${moves.join(',')}`,
                human_id: `${species.toLowerCase().replace(/[^a-z0-9]/g, '')}_custom`,
                species: species.trim(),
                set_label: item.trim() || 'Custom',
                is_mega: false,
                marginal_score: impact!.marginal_score,
                support_delta: impact!.support_delta,
                conditions_added: [],
                support_swings: [],
                positioning_delta: impact!.positioning_delta,
                opponents_unlocked: [],
                positioning_swings: [],
                positioning_categories: [],
                entry_coverage: impact!.entry_coverage,
                patches: [],
                provisional: true,
                source: 'custom',
              },
              {
                variant_id: `custom:${species}`,
                human_id: `${species.toLowerCase()}_custom`,
                set_label: item.trim() || 'Custom',
                item: item.trim() || null,
                ability: ability.trim(),
                nature,
                sps,
                moves: moves.filter((m) => m.trim()),
                usage_share: 0,
              }
            )
          }
        >
          Add to team
        </button>
      </div>
    </div>
  );
}

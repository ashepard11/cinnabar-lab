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

/**
 * Champions natures. A nature is the only stat alignment available — there are
 * no EVs to shift and no IVs to lower — so it is a required part of a set
 * rather than a detail.
 */
const NATURES: Array<{name: string; up?: StatID; down?: StatID}> = [
  {name: 'Hardy'},
  {name: 'Adamant', up: 'atk', down: 'spa'},
  {name: 'Jolly', up: 'spe', down: 'spa'},
  {name: 'Modest', up: 'spa', down: 'atk'},
  {name: 'Timid', up: 'spe', down: 'atk'},
  {name: 'Bold', up: 'def', down: 'atk'},
  {name: 'Impish', up: 'def', down: 'spa'},
  {name: 'Calm', up: 'spd', down: 'atk'},
  {name: 'Careful', up: 'spd', down: 'spa'},
  {name: 'Brave', up: 'atk', down: 'spe'},
  {name: 'Quiet', up: 'spa', down: 'spe'},
  {name: 'Relaxed', up: 'def', down: 'spe'},
  {name: 'Sassy', up: 'spd', down: 'spe'},
];

function natureLabel(n: {name: string; up?: StatID; down?: StatID}): string {
  if (!n.up || !n.down) return `${n.name} (neutral)`;
  return `${n.name} (+${n.up.toUpperCase()} −${n.down.toUpperCase()})`;
}

export interface ChosenSet {
  set: PresetSet;
  source: 'preset' | 'custom';
}

/**
 * Choosing the set for a picked candidate.
 *
 * Two paths. The preset path lists every set the pipeline knows for this
 * Pokémon with the one the candidate row represented pre-selected, because a
 * user who clicked "Assault Vest Kingambit" should land on that set and still
 * be able to see that a Swords Dance set exists.
 *
 * The custom path defines a whole set — item, ability, nature, four moves and
 * the SP spread — since those are what make a set a set. Everything validates
 * live against `lib/format-rules.ts`, the same code the pipeline uses, so an
 * illegal set is rejected here rather than after a simulation job is queued.
 */
export default function SetEditor({
  candidate,
  onCancel,
  onConfirm,
}: {
  candidate: Candidate;
  onCancel: () => void;
  onConfirm: (chosen: ChosenSet) => void;
}) {
  const presets = candidate.sets ?? [];
  const [mode, setMode] = useState<'preset' | 'custom'>(presets.length > 0 ? 'preset' : 'custom');
  // The set the candidate row stood for, pre-selected.
  const [selectedId, setSelectedId] = useState(presets[0]?.variant_id ?? '');

  const base = presets.find((p) => p.variant_id === selectedId) ?? presets[0];

  const [custom, setCustom] = useState<PresetSet>(() => ({
    variant_id: `custom:${candidate.human_id}`,
    human_id: `${candidate.human_id}_custom`,
    set_label: 'Custom',
    item: base?.item ?? null,
    ability: base?.ability ?? '',
    nature: base?.nature ?? 'Hardy',
    sps: base?.sps ?? {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0},
    moves: [...(base?.moves ?? []), '', '', '', ''].slice(0, 4),
    usage_share: 0,
  }));

  const spent = STATS.reduce((sum, s) => sum + (custom.sps[s] ?? 0), 0);
  const spErrors = validateSpSpread(custom.sps, RULES);

  const setErrors = useMemo(() => {
    const errs = spErrors.map((e) => describeSpErrors([e]));
    const moves = custom.moves.map((m) => m.trim()).filter(Boolean);
    if (moves.length === 0) errs.push('a set needs at least one move');
    if (new Set(moves.map((m) => m.toLowerCase())).size !== moves.length) {
      errs.push('duplicate moves');
    }
    if (!custom.ability.trim()) errs.push('an ability is required');
    return errs;
  }, [custom, spErrors]);

  const legal = setErrors.length === 0;

  function confirm() {
    if (mode === 'preset' && base) onConfirm({set: base, source: 'preset'});
    else onConfirm({set: {...custom, moves: custom.moves.filter((m) => m.trim())}, source: 'custom'});
  }

  return (
    <div className="set-editor" role="dialog" aria-label={`Choose a set for ${candidate.species}`}>
      <div className="set-editor-head">
        <h3>
          {candidate.species} <span className="muted">{candidate.set_label}</span>
        </h3>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>

      <div className="set-modes" role="group">
        <button
          type="button"
          className={mode === 'preset' ? 'active' : ''}
          disabled={presets.length === 0}
          onClick={() => setMode('preset')}
        >
          Preset {presets.length > 1 ? `(${presets.length})` : ''}
        </button>
        <button type="button" className={mode === 'custom' ? 'active' : ''} onClick={() => setMode('custom')}>
          Define my own
        </button>
      </div>

      {mode === 'preset' ? (
        <ul className="preset-list">
          {presets.map((p) => (
            <li key={p.variant_id}>
              <label className={p.variant_id === selectedId ? 'preset selected' : 'preset'}>
                <input
                  type="radio"
                  name="preset"
                  checked={p.variant_id === selectedId}
                  onChange={() => setSelectedId(p.variant_id)}
                />
                <span className="preset-head">
                  <strong>{p.set_label}</strong>
                  <span className="muted">
                    {p.ability} · {p.nature} · {Math.round(p.usage_share * 100)}% of this Pokémon
                  </span>
                </span>
                <span className="preset-moves">{p.moves.join(' / ')}</span>
                <span className="preset-sps">
                  {STATS.filter((s) => (p.sps[s] ?? 0) > 0)
                    .map((s) => `${p.sps[s]} ${s.toUpperCase()}`)
                    .join(' · ')}
                </span>
              </label>
            </li>
          ))}

        </ul>
      ) : (
        <div className="sp-editor">
          <div className="custom-grid">
            <label>
              <span>Item</span>
              <input
                type="text"
                value={custom.item ?? ''}
                placeholder="None"
                onChange={(e) => setCustom((c) => ({...c, item: e.target.value || null}))}
              />
            </label>
            <label>
              <span>Ability</span>
              <input
                type="text"
                value={custom.ability}
                onChange={(e) => setCustom((c) => ({...c, ability: e.target.value}))}
              />
            </label>
          </div>

          <label className="full" title="A nature is the only stat alignment Champions has — there are no EVs to shift and no IVs to lower.">
            <span>Nature</span>
            <select
              value={custom.nature}
              onChange={(e) => setCustom((c) => ({...c, nature: e.target.value}))}
            >
              {NATURES.map((n) => (
                <option key={n.name} value={n.name}>
                  {natureLabel(n)}
                </option>
              ))}
            </select>
          </label>

          <span className="field-label">Moves</span>
          <div className="custom-grid">
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                type="text"
                aria-label={`Move ${i + 1}`}
                placeholder={`Move ${i + 1}`}
                value={custom.moves[i] ?? ''}
                onChange={(e) =>
                  setCustom((c) => {
                    const moves = [...c.moves];
                    moves[i] = e.target.value;
                    return {...c, moves};
                  })
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
                  value={custom.sps[stat] ?? 0}
                  onChange={(e) =>
                    setCustom((c) => ({...c, sps: {...c.sps, [stat]: Number(e.target.value)}}))
                  }
                />
              </label>
            ))}
          </div>

          <p className={spErrors.length === 0 ? 'sp-budget ok' : 'sp-budget over'}>
            {spent} / {RULES.sp_total} SP spent
          </p>
          {setErrors.length > 0 && (
            <ul className="set-errors">
              {setErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="set-editor-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary"
          disabled={mode === 'custom' ? !legal : !base}
          onClick={confirm}
        >
          Add to team
        </button>
      </div>
    </div>
  );
}

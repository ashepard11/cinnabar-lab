import { useState } from 'react';
import Combobox from '../Combobox';
import { getSpecies, toID } from '../../../lib/evaluator/dex';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet, ParseFailure } from '../../../lib/evaluator/parse';
import { parseTeam } from '../../../lib/evaluator/parse';
import type { StatID } from '../../../lib/types';

const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABELS: Record<StatID, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

/** Display label for a roster chip: "Kingambit (Black Glasses)". */
export function setLabel(set: ParsedSet): string {
  if (set.isMega) return set.battleSpecies;
  return set.item ? `${set.species} (${set.item})` : set.species;
}

function SetEditor({
  dex, set, onChange,
}: {
  dex: EvaluatorDex;
  set: ParsedSet;
  onChange: (patch: Partial<ParsedSet>) => void;
}) {
  const speciesOptions = Object.values(dex.species)
    .filter((s) => !s.isMega) // megas are reached by holding the stone
    .map((s) => ({ id: toID(s.name), label: s.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const itemOptions = [
    { id: '', label: 'no item' },
    ...Object.entries(dex.items).map(([id, name]) => ({ id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const moveOptions = Object.values(dex.moves)
    .map((m) => ({ id: toID(m.name), label: m.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const spec = getSpecies(dex, set.species);
  const abilityOptions = spec?.abilities.length ? spec.abilities : Object.values(dex.abilities);

  return (
    <div className="set-editor">
      <div className="set-editor-row">
        <label>Species
          <Combobox
            options={speciesOptions}
            placeholder={set.species}
            onSelect={(id) => onChange({ species: dex.species[id].name })}
          />
        </label>
        <label>Item
          <Combobox
            options={itemOptions}
            placeholder={set.item ?? 'no item'}
            onSelect={(id) => onChange({ item: id ? dex.items[id] : null })}
          />
        </label>
        <label>Ability
          <select value={set.ability} onChange={(e) => onChange({ ability: e.target.value })}>
            {abilityOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            {!abilityOptions.includes(set.ability) && <option value={set.ability}>{set.ability}</option>}
          </select>
        </label>
        <label>Nature
          <select value={set.nature} onChange={(e) => onChange({ nature: e.target.value })}>
            {Object.values(dex.natures).map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}{n.plus ? ` (+${STAT_LABELS[n.plus]}/−${STAT_LABELS[n.minus!]})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="set-editor-row">
        {STAT_IDS.map((s) => (
          <label key={s} className="sp-input">{STAT_LABELS[s]}
            <input
              type="number" min={0} max={32} value={set.sps[s]}
              onChange={(e) => {
                const v = Math.max(0, Math.min(32, Number(e.target.value) || 0));
                onChange({ sps: { ...set.sps, [s]: v } });
              }}
            />
          </label>
        ))}
        <span className="sp-note">SP (0–32)</span>
      </div>
      <div className="set-editor-row">
        {[0, 1, 2, 3].map((i) => (
          <label key={i} className="move-slot">Move {i + 1}
            <Combobox
              options={moveOptions}
              placeholder={set.moves[i] ?? '—'}
              onSelect={(id) => {
                const moves = [...set.moves];
                moves[i] = dex.moves[id].name;
                onChange({ moves: moves.filter(Boolean).slice(0, 4) });
              }}
            />
            {set.moves[i] && (
              <button
                className="core-chip-remove" aria-label={`Clear move ${set.moves[i]}`}
                onClick={() => onChange({ moves: set.moves.filter((_, j) => j !== i) })}
              >✕</button>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function TeamInput({
  dex, sets, failures, onReplace, onExampleTeam,
}: {
  dex: EvaluatorDex;
  sets: ParsedSet[];
  failures: ParseFailure[];
  onReplace: (sets: ParsedSet[], failures: ParseFailure[]) => void;
  onExampleTeam: () => void;
}) {
  const [pasteOpen, setPasteOpen] = useState(sets.length === 0);
  const [pasteText, setPasteText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);

  const loadPaste = () => {
    const parsed = parseTeam(pasteText, dex);
    onReplace(parsed.sets, parsed.failures);
    setEditing(null);
    if (parsed.sets.length) setPasteOpen(false);
  };

  const patchSet = (index: number, patch: Partial<ParsedSet>) => {
    const next = sets.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onReplace(next, []);
  };

  const addBlank = () => {
    const first = Object.values(dex.species).filter((s) => !s.isMega)[0];
    const parsed = parseTeam(first.name, dex);
    onReplace([...sets, ...parsed.sets], []);
    setEditing(sets.length);
  };

  return (
    <div className="team-input">
      <div className="team-roster">
        {sets.map((set, i) => (
          <div key={i} className="roster-entry">
            <div className="roster-chip-row">
              <button
                className={`roster-chip${editing === i ? ' editing' : ''}`}
                onClick={() => setEditing(editing === i ? null : i)}
                aria-expanded={editing === i}
              >
                {setLabel(set)}
                {set.warnings.length > 0 && <span className="roster-warn" title={set.warnings.join('\n')}>⚠</span>}
              </button>
              <button
                className="core-chip-remove" aria-label={`Remove ${set.species}`}
                onClick={() => { onReplace(sets.filter((_, j) => j !== i), []); setEditing(null); }}
              >✕</button>
            </div>
            {set.invalidMoves.length > 0 && (
              <div className="roster-invalid">{set.invalidMoves.map((m) => <s key={m}>{m}</s>)}</div>
            )}
            {editing === i && <SetEditor dex={dex} set={set} onChange={(p) => patchSet(i, p)} />}
          </div>
        ))}
        {sets.length < 6 && (
          <button className="roster-add" onClick={addBlank}>+ add Pokémon</button>
        )}
      </div>

      {failures.length > 0 && (
        <div className="roster-failures">
          {failures.map((f, i) => (
            <div key={i} className="error-note roster-failure">
              <s>{f.raw.split('\n')[0]}</s> — {f.message}
            </div>
          ))}
        </div>
      )}

      {sets.length > 0 && sets.length < 4 && (
        <p className="footer-note">
          {sets.length} of 4–6 Pokémon — the evaluation assumes a full bring-4;
          add more for a representative read.
        </p>
      )}

      <div className="paste-controls">
        <button onClick={() => setPasteOpen(!pasteOpen)}>
          {pasteOpen ? 'Hide paste box' : 'Paste a team'}
        </button>
        <button onClick={onExampleTeam}>Load example team</button>
      </div>
      {pasteOpen && (
        <div className="paste-box">
          <textarea
            rows={10}
            placeholder={'Paste a team in Showdown export format:\n\nGarchomp @ Life Orb\nAbility: Rough Skin\nEVs: 4 HP / 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n…'}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button disabled={!pasteText.trim()} onClick={loadPaste}>
            Load team{sets.length > 0 ? ' (replaces current roster)' : ''}
          </button>
        </div>
      )}
    </div>
  );
}

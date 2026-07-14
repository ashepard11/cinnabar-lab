import { useState } from 'react';
import { TYPE_COLORS } from '../../lib';
import { defensiveMatrix, bucketOf } from '../../../lib/evaluator/typechart';
import type { DefensiveCell, DefensiveMatrix } from '../../../lib/evaluator/typechart';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet } from '../../../lib/evaluator/parse';
import type { TypeName } from '../../../lib/types';
import { setLabel } from './TeamInput';

const BUCKET_LABEL: Record<number, string> = { 0: '0', 0.25: '¼', 0.5: '½', 1: '', 2: '2', 4: '4' };

function bucketClass(mult: number): string {
  return `tm-${String(bucketOf(mult)).replace('.', '')}`;
}

function DefCell({ cell }: { cell: DefensiveCell }) {
  const title = cell.modified
    ? `raw ×${cell.raw} → effective ×${cell.effective}${cell.note ? ` — ${cell.note}` : ''}`
    : `×${cell.raw}`;
  return (
    <td className={`tm-cell ${bucketClass(cell.effective)}`} title={title}>
      {BUCKET_LABEL[bucketOf(cell.effective)] ?? `×${cell.effective}`}
      {cell.modified && <span className="tm-dot" aria-label="ability-modified" />}
    </td>
  );
}

// --- Team-level aggregate -------------------------------------------------

type TeamBucket = 'weak' | 'neutral' | 'resist' | 'immune';

/**
 * Team-level relationship to an attacking type (DECISIONS.md D38): compare
 * members taking super-effective damage against members resisting or immune.
 * Net weak → weakness; net resist → resistance (immunity when at least one
 * member is outright immune); balanced → neutral.
 */
function classifyType(s: { weak: number; resist: number; immune: number }): TeamBucket {
  const net = s.resist + s.immune - s.weak;
  if (net < 0) return 'weak';
  if (net > 0) return s.immune > 0 ? 'immune' : 'resist';
  return 'neutral';
}

const TEAM_BUCKETS: Array<{ id: TeamBucket; label: string }> = [
  { id: 'weak', label: 'weak to' },
  { id: 'neutral', label: 'neutral' },
  { id: 'resist', label: 'resists' },
  { id: 'immune', label: 'immune to' },
];

function chipTitle(def: DefensiveMatrix, ti: number, sets: ParsedSet[]): string {
  const rows: string[] = [];
  const list = (pred: (c: DefensiveCell) => boolean, name: string) => {
    const members = def.cells[ti]
      .map((c, si) => ({ c, si }))
      .filter(({ c }) => pred(c))
      .map(({ c, si }) => `${setLabel(sets[si])} (×${c.effective})`);
    if (members.length) rows.push(`${name}: ${members.join(', ')}`);
  };
  list((c) => c.effective >= 2, 'weak');
  list((c) => c.effective > 0 && c.effective <= 0.5, 'resists');
  list((c) => c.effective === 0, 'immune');
  return rows.join(' · ') || 'neutral across the team';
}

function DefenseSummary({ def, sets }: { def: DefensiveMatrix; sets: ParsedSet[] }) {
  const byBucket: Record<TeamBucket, number[]> = { weak: [], neutral: [], resist: [], immune: [] };
  def.types.forEach((_, ti) => byBucket[classifyType(def.summary[ti])].push(ti));
  // Most affected types first within each bucket.
  byBucket.weak.sort((a, b) => def.summary[b].weak - def.summary[a].weak);
  byBucket.resist.sort((a, b) =>
    (def.summary[b].resist + def.summary[b].immune) - (def.summary[a].resist + def.summary[a].immune));
  byBucket.immune.sort((a, b) => def.summary[b].immune - def.summary[a].immune);

  return (
    <div className="ts-summary">
      {TEAM_BUCKETS.map(({ id, label }) => (
        <div key={id} className={`ts-bucket ts-${id}`}>
          <div className="ts-head">
            <span className="ts-count">{byBucket[id].length}</span>
            <span className="ts-label">{label}</span>
          </div>
          <div className="ts-chips">
            {byBucket[id].map((ti) => {
              const t = def.types[ti] as TypeName;
              const s = def.summary[ti];
              const n = id === 'weak' ? s.weak : id === 'immune' ? s.immune : id === 'resist' ? s.resist + s.immune : 0;
              return (
                <span
                  key={t}
                  className="ts-chip"
                  style={{ background: TYPE_COLORS[t] }}
                  title={chipTitle(def, ti, sets)}
                >
                  {t}
                  {n > 1 && <span className="ts-chip-n">{n}</span>}
                </span>
              );
            })}
            {byBucket[id].length === 0 && <span className="ts-none">none</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Per-Pokémon grid (secondary view) ------------------------------------

function DefenseGrid({ def, sets }: { def: DefensiveMatrix; sets: ParsedSet[] }) {
  const [view, setView] = useState<'effective' | 'raw'>('effective');
  return (
    <div>
      <label className="tm-toggle">
        <select value={view} onChange={(e) => setView(e.target.value as 'effective' | 'raw')}>
          <option value="effective">ability-modified</option>
          <option value="raw">raw type chart</option>
        </select>
      </label>
      <table className="tm-table">
        <thead>
          <tr>
            <th />
            {sets.map((s, i) => <th key={i} className="tm-member">{setLabel(s)}</th>)}
          </tr>
        </thead>
        <tbody>
          {def.types.map((t, ti) => (
            <tr key={t}>
              <th className="tm-type" style={{ background: TYPE_COLORS[t] }}>{t}</th>
              {def.cells[ti].map((cell, si) => (
                view === 'effective'
                  ? <DefCell key={si} cell={cell} />
                  : (
                    <td key={si} className={`tm-cell ${bucketClass(cell.raw)}`} title={`×${cell.raw}`}>
                      {BUCKET_LABEL[bucketOf(cell.raw)] ?? `×${cell.raw}`}
                    </td>
                  )
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TypeMatrix({ dex, sets }: { dex: EvaluatorDex; sets: ParsedSet[] }) {
  const [showGrid, setShowGrid] = useState(false);
  const def = defensiveMatrix(dex, sets);

  return (
    <div className="typematrix">
      <DefenseSummary def={def} sets={sets} />
      <button className="tm-reveal" onClick={() => setShowGrid(!showGrid)} aria-expanded={showGrid}>
        {showGrid ? '▾' : '▸'} Per-Pokémon breakdown
      </button>
      {showGrid && <DefenseGrid def={def} sets={sets} />}
    </div>
  );
}

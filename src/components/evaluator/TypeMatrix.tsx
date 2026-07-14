import { useState } from 'react';
import { TYPE_COLORS } from '../../lib';
import { defensiveMatrix, offensiveMatrix, bucketOf } from '../../../lib/evaluator/typechart';
import type { DefensiveCell } from '../../../lib/evaluator/typechart';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet } from '../../../lib/evaluator/parse';
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

export default function TypeMatrix({ dex, sets }: { dex: EvaluatorDex; sets: ParsedSet[] }) {
  const [view, setView] = useState<'effective' | 'raw'>('effective');
  const def = defensiveMatrix(dex, sets);
  const off = offensiveMatrix(dex, sets);

  return (
    <div className="typematrix">
      <h3>
        Defensive — damage taken from each attacking type
        <label className="tm-toggle">
          <select value={view} onChange={(e) => setView(e.target.value as 'effective' | 'raw')}>
            <option value="effective">ability-modified</option>
            <option value="raw">raw type chart</option>
          </select>
        </label>
      </h3>
      <table className="tm-table">
        <thead>
          <tr>
            <th />
            {sets.map((s, i) => <th key={i} className="tm-member">{setLabel(s)}</th>)}
            <th className="tm-summary-head">team</th>
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
              <td className="tm-summary">
                {def.summary[ti].weak > 0 && <span className="tm-sum-weak">{def.summary[ti].weak} weak</span>}
                {def.summary[ti].immune > 0 && <span className="tm-sum-immune">{def.summary[ti].immune} imm</span>}
                {def.summary[ti].resist > 0 && <span className="tm-sum-resist">{def.summary[ti].resist} res</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Offensive — best hit into each defending type</h3>
      <p className="footer-note" style={{ marginTop: 0 }}>
        Best effectiveness of each Pokémon's damaging moves against a single-typed defender.
      </p>
      <table className="tm-table">
        <thead>
          <tr>
            <th />
            {sets.map((s, i) => <th key={i} className="tm-member">{setLabel(s)}</th>)}
          </tr>
        </thead>
        <tbody>
          {off.types.map((t, ti) => (
            <tr key={t}>
              <th className="tm-type" style={{ background: TYPE_COLORS[t] }}>{t}</th>
              {off.cells[ti].map((cell, si) => (
                cell.best === null
                  ? <td key={si} className="tm-cell tm-none" title="no damaging moves">—</td>
                  : (
                    <td
                      key={si}
                      className={`tm-cell ${bucketClass(cell.best)}`}
                      title={`${cell.bestMove} ×${cell.best}${cell.scrappy ? ' (Scrappy)' : ''}`}
                    >
                      {BUCKET_LABEL[bucketOf(cell.best)] ?? `×${cell.best}`}
                      {cell.scrappy && <span className="tm-dot" aria-label="Scrappy" />}
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

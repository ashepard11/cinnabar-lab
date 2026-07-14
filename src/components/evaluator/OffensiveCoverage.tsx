import { useMemo } from 'react';
import { TYPE_COLORS } from '../../lib';
import { offensiveMatrix } from '../../../lib/evaluator/typechart';
import type { OffensiveCell } from '../../../lib/evaluator/typechart';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet } from '../../../lib/evaluator/parse';
import { Tooltip, useTooltip } from '../Tooltip';
import { setLabel } from './TeamInput';

type CovBucket = 'se' | 'neutral' | 'resisted';

const BUCKET_META: Array<{ id: CovBucket; label: string; color: string }> = [
  { id: 'se', label: 'super-effective', color: '#2e7d5b' },
  { id: 'neutral', label: 'neutral at best', color: '#cfd4da' },
  { id: 'resisted', label: 'resisted or immune', color: '#b3423a' },
];

function bucketOfCell(cell: OffensiveCell): CovBucket {
  if (cell.best !== null && cell.best >= 2) return 'se';
  if (cell.best === 1) return 'neutral';
  return 'resisted';
}

interface CovRow {
  type: string;
  buckets: Record<CovBucket, Array<{ member: string; cell: OffensiveCell }>>;
}

function RowTooltip({ row }: { row: CovRow }) {
  return (
    <>
      <div className="tooltip-header">
        <span className="tooltip-chip" style={{ background: TYPE_COLORS[row.type] }} />
        into {row.type}
      </div>
      {BUCKET_META.map(({ id, label }) => (
        row.buckets[id].length > 0 && (
          <div key={id} className="tooltip-metric" style={{ marginBottom: 4 }}>
            <strong>{label}</strong>
            <ul className="tooltip-list">
              {row.buckets[id].map(({ member, cell }) => (
                <li key={member}>
                  <span className="who">{member}</span>
                  <span>{cell.best === null ? 'no damaging moves' : `${cell.bestMove} ×${cell.best}`}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      ))}
    </>
  );
}

export default function OffensiveCoverage({ dex, sets }: { dex: EvaluatorDex; sets: ParsedSet[] }) {
  const { tip, show, hide } = useTooltip();
  const rows = useMemo(() => {
    const off = offensiveMatrix(dex, sets);
    const built = off.types.map((type, ti): CovRow => {
      const buckets: CovRow['buckets'] = { se: [], neutral: [], resisted: [] };
      off.cells[ti].forEach((cell, si) => {
        buckets[bucketOfCell(cell)].push({ member: setLabel(sets[si]), cell });
      });
      return { type, buckets };
    });
    // Hardest-to-hit types first: fewest super-effective answers, then most resisted.
    return built.sort((a, b) =>
      a.buckets.se.length - b.buckets.se.length
      || b.buckets.resisted.length - a.buckets.resisted.length);
  }, [dex, sets]);

  return (
    <div className="cov">
      <div className="cov-legend">
        {BUCKET_META.map(({ id, label, color }) => (
          <span key={id} className="cov-key">
            <span className="cov-swatch" style={{ background: color }} />{label}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.type}
          className="cov-row"
          tabIndex={0}
          onMouseMove={(e) => show(e, <RowTooltip row={row} />)}
          onMouseLeave={hide}
          onFocus={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            show({ clientX: r.right, clientY: r.top }, <RowTooltip row={row} />);
          }}
          onBlur={hide}
        >
          <span className="ts-chip cov-type" style={{ background: TYPE_COLORS[row.type] }}>
            {row.type}
          </span>
          <span className="cov-bar">
            {BUCKET_META.map(({ id, color }) => (
              row.buckets[id].length > 0 && (
                <span
                  key={id}
                  className="cov-seg"
                  style={{ flexGrow: row.buckets[id].length, background: color }}
                />
              )
            ))}
          </span>
          <span className="cov-counts">
            {BUCKET_META.filter(({ id }) => row.buckets[id].length > 0)
              .map(({ id, label }) => `${row.buckets[id].length} ${label}`)
              .join(', ')}
          </span>
        </div>
      ))}
      <Tooltip tip={tip} />
    </div>
  );
}

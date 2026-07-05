import {useMemo} from 'react';
import {interpolateRdBu} from 'd3-scale-chromatic';
import type {Viz2Cell, Viz2Data} from '../lib';
import {pct, textOn} from '../lib';
import {Tooltip, useTooltip} from './Tooltip';

const CELL_W = 150;
const CELL_H = 30;
const ROW_LABEL_W = 90;
const HEADER_H = 26;
const GAP = 2;

/** Diverging scale around 1.0: blue (low) → white (1.0) → red (high),
 * domain [0.5, 1.5] clamped (interpolateRdBu reversed). */
function relColor(relative: number): string {
  const t = Math.max(0, Math.min(1, (relative - 0.5) / 1.0));
  return interpolateRdBu(1 - t);
}

function toHex(rgbStr: string): string {
  const m = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return rgbStr;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function CellTooltip({cell, average}: {cell: Viz2Cell; average: number}) {
  return (
    <>
      <div className="tooltip-header">
        <span className="tooltip-chip" style={{background: relColor(cell.relative)}} />
        {cell.type} · {cell.category}
      </div>
      <div className="tooltip-metric">
        <strong>{cell.relative.toFixed(2)}×</strong> average damage
        <br />
        Absolute: <strong>{pct(cell.weighted_damage)}</strong> of average defender HP
        (field average {pct(average)})
      </div>
      <ul className="tooltip-list">
        {cell.contributors.slice(0, 5).map((c) => (
          <li key={c.variant_id}>
            <span className="who">{c.species}</span>
            <span>{pct(c.damage, 0)} taken</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Heatmap({data}: {data: Viz2Data}) {
  const rows = useMemo(() => {
    const byType = new Map<string, {Physical?: Viz2Cell; Special?: Viz2Cell}>();
    for (const cell of data.cells) {
      const t = byType.get(cell.type) ?? {};
      t[cell.category] = cell;
      byType.set(cell.type, t);
    }
    // Row order: descending by max(phys, spec) — most threatening type on top.
    return [...byType.entries()]
      .map(([type, cells]) => ({
        type,
        cells,
        max: Math.max(cells.Physical?.relative ?? 0, cells.Special?.relative ?? 0),
      }))
      .sort((a, b) => b.max - a.max);
  }, [data]);

  const {tip, show, hide} = useTooltip();
  const width = ROW_LABEL_W + 2 * (CELL_W + GAP);
  const height = HEADER_H + rows.length * (CELL_H + GAP);

  return (
    <div className="chart-wrap" style={{maxWidth: width}}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Heatmap of relative damage by attack type and category"
      >
        {(['Physical', 'Special'] as const).map((cat, ci) => (
          <text
            key={cat}
            x={ROW_LABEL_W + ci * (CELL_W + GAP) + CELL_W / 2}
            y={HEADER_H - 10}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill="#5a6172"
          >
            {cat}
          </text>
        ))}
        {rows.map((row, ri) => {
          const y = HEADER_H + ri * (CELL_H + GAP);
          return (
            <g key={row.type}>
              <text
                x={ROW_LABEL_W - 10}
                y={y + CELL_H / 2 + 4}
                textAnchor="end"
                fontSize={12}
                fill="#1f2430"
              >
                {row.type}
              </text>
              {(['Physical', 'Special'] as const).map((cat, ci) => {
                const cell = row.cells[cat];
                if (!cell) return null;
                const fill = toHex(relColor(cell.relative));
                return (
                  <g key={cat}>
                    <rect
                      x={ROW_LABEL_W + ci * (CELL_W + GAP)}
                      y={y}
                      width={CELL_W}
                      height={CELL_H}
                      rx={4}
                      fill={fill}
                      stroke="#e3e6eb"
                      strokeWidth={0.5}
                      onMouseMove={(e) => show(e, <CellTooltip cell={cell} average={data.average_damage} />)}
                      onMouseLeave={hide}
                    />
                    <text
                      x={ROW_LABEL_W + ci * (CELL_W + GAP) + CELL_W / 2}
                      y={y + CELL_H / 2 + 4}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={600}
                      fill={textOn(fill)}
                      pointerEvents="none"
                    >
                      {cell.relative.toFixed(2)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

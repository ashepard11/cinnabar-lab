import {useMemo} from 'react';
import type {Viz1Cell, Viz1Data} from '../lib';
import {cellColor, pct, textOn} from '../lib';
import {Tooltip, useTooltip} from './Tooltip';

const WIDTH = 960;
const HEIGHT = 440;
const LABEL_MIN_COL_PX = 40;

interface Column {
  type: string;
  totalShare: number;
  x: number;
  width: number;
  physical: Viz1Cell | null;
  special: Viz1Cell | null;
  physHeight: number;
}

function layout(data: Viz1Data): Column[] {
  const byType = new Map<string, {physical?: Viz1Cell; special?: Viz1Cell}>();
  for (const cell of data.cells) {
    const t = byType.get(cell.type) ?? {};
    if (cell.category === 'Physical') t.physical = cell;
    else t.special = cell;
    byType.set(cell.type, t);
  }
  const cols = [...byType.entries()]
    .map(([type, {physical, special}]) => ({
      type,
      physical: physical ?? null,
      special: special ?? null,
      totalShare: (physical?.share ?? 0) + (special?.share ?? 0),
    }))
    .sort((a, b) => b.totalShare - a.totalShare);

  let x = 0;
  return cols.map((c) => {
    const width = WIDTH * c.totalShare;
    const physHeight = c.totalShare > 0 ? HEIGHT * ((c.physical?.share ?? 0) / c.totalShare) : 0;
    const col: Column = {...c, x, width, physHeight};
    x += width;
    return col;
  });
}

function CellTooltip({cell}: {cell: Viz1Cell}) {
  return (
    <>
      <div className="tooltip-header">
        <span className="tooltip-chip" style={{background: cellColor(cell.type, cell.category)}} />
        {cell.type} · {cell.category}
      </div>
      <div className="tooltip-metric">
        <strong>{pct(cell.share)}</strong> of expected damage
      </div>
      <ul className="tooltip-list">
        {cell.contributors.slice(0, 5).map((c) => (
          <li key={`${c.variant_id}-${c.move}`}>
            <span className="who">{c.species} — {c.move}</span>
            <span>{pct(c.share)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function Marimekko({data}: {data: Viz1Data}) {
  const cols = useMemo(() => layout(data), [data]);
  const {tip, show, hide} = useTooltip();

  return (
    <div className="chart-wrap">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT + 24}`}
        role="img"
        aria-label="Marimekko chart of expected damage share by attack type and category"
      >
        {cols.map((col) => {
          const cells: Array<{cell: Viz1Cell; y: number; h: number}> = [];
          if (col.physical) cells.push({cell: col.physical, y: 0, h: col.physHeight});
          if (col.special) cells.push({cell: col.special, y: col.physHeight, h: HEIGHT - col.physHeight});
          const showLabel = col.width >= LABEL_MIN_COL_PX;
          return (
            <g key={col.type}>
              {cells.map(({cell, y, h}) => {
                const fill = cellColor(cell.type, cell.category);
                return (
                  <rect
                    key={cell.category}
                    x={col.x + 1}
                    y={y + 1}
                    width={Math.max(col.width - 2, 0.5)}
                    height={Math.max(h - 2, 0.5)}
                    rx={3}
                    fill={fill}
                    onMouseMove={(e) => show(e, <CellTooltip cell={cell} />)}
                    onMouseLeave={hide}
                  />
                );
              })}
              {showLabel && (() => {
                // Put the % label in the taller of the two cells so it never
                // straddles the boundary or sits on the wrong background.
                const physTaller = col.physHeight >= HEIGHT - col.physHeight;
                const labelCat = physTaller ? 'Physical' : 'Special';
                const labelY = physTaller
                  ? col.physHeight / 2 + 4
                  : col.physHeight + (HEIGHT - col.physHeight) / 2 + 4;
                return (
                  <>
                    <text
                      x={col.x + col.width / 2}
                      y={HEIGHT + 16}
                      textAnchor="middle"
                      fontSize={11.5}
                      fill="#5a6172"
                    >
                      {col.type}
                    </text>
                    <text
                      x={col.x + col.width / 2}
                      y={labelY}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill={textOn(cellColor(col.type, labelCat))}
                      pointerEvents="none"
                    >
                      {pct(col.totalShare, 0)}
                    </text>
                  </>
                );
              })()}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

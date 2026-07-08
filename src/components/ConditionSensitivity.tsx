import { useMemo } from 'react';
import type { Database } from 'sql.js';
import { CONDITION_IDS, computeTeamBest, type ConditionId } from '../lib/matchupDb';

/**
 * One aggregate row: the core's metagame-weighted average win rate under a
 * single starting condition, and its shift from the `fresh` baseline.
 */
interface CondAgg {
  condition: ConditionId;
  /** Σ weight(V) × team_best(core, V | condition) / Σ weight(V), over opponents V. */
  value: number;
  /** value − value(fresh); 0 for fresh itself. */
  delta: number;
}

/**
 * For every condition, the field-weighted average of the core's best answer.
 * `team_best(core, V)` is the highest win rate any core member has against V;
 * we weight by opponent usage and renormalize by the total weight of the
 * opponents that actually have matchup data, so the bar reads as a true
 * average win rate in [0, 1] rather than an un-normalized sum. This is
 * scale-invariant in the weights, so raw team-inclusion weights and
 * distribution weights give the same answer.
 */
function conditionAggregates(
  db: Database,
  core: string[],
  weights: Map<string, number>,
): CondAgg[] {
  const perCond = CONDITION_IDS.map((condition) => {
    let wsum = 0;
    let acc = 0;
    for (const [V, { best }] of computeTeamBest(db, core, condition)) {
      const w = weights.get(V) ?? 0;
      wsum += w;
      acc += w * best;
    }
    return { condition, value: wsum > 0 ? acc / wsum : 0 };
  });
  const fresh = perCond.find((p) => p.condition === 'fresh')?.value ?? 0;
  // Most-beneficial conditions on top (delta descending); fresh lands at 0.
  return perCond
    .map((p) => ({ ...p, delta: p.value - fresh }))
    .sort((a, b) => b.delta - a.delta);
}

/**
 * Part A: "Condition sensitivity" — a horizontal bar of the core's aggregate
 * (metagame-weighted) win rate under each starting condition, with `fresh` as
 * the baseline (distinct bar + a vertical reference line at its value). Always
 * shows the full sweep across all conditions; deliberately independent of the
 * page's condition selector. Memoized on the core composition (the spec's
 * performance note) since each render walks every (member × opponent ×
 * condition) triple.
 */
export default function ConditionSensitivity({
  db,
  core,
  weights,
}: {
  db: Database;
  core: string[];
  weights: Map<string, number>;
}) {
  const rows = useMemo(
    () => conditionAggregates(db, core, weights),
    [db, core, weights],
  );
  const freshPct = Math.round(
    (rows.find((r) => r.condition === 'fresh')?.value ?? 0) * 100,
  );

  return (
    <div className="cond-sens">
      {rows.map((r) => {
        const pct = Math.round(r.value * 100);
        const delta = pct - freshPct; // consistent with the displayed rounded %s
        const isFresh = r.condition === 'fresh';
        return (
          <div key={r.condition} className={`cond-sens-row${isFresh ? ' is-fresh' : ''}`}>
            <div className="cond-sens-label">
              {r.condition}
              {isFresh && <span className="cond-sens-baseline"> baseline</span>}
            </div>
            <div className="cond-sens-track">
              <div className="cond-sens-bar" style={{ width: `${pct}%` }} />
              <div className="cond-sens-fresh-line" style={{ left: `${freshPct}%` }} />
            </div>
            <div className="cond-sens-value">
              {pct}%
              {!isFresh && (
                <span className={`cond-sens-delta ${delta >= 0 ? 'pos' : 'neg'}`}>
                  {' '}({delta >= 0 ? '+' : '−'}{Math.abs(delta)})
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

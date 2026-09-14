/**
 * lib/analysis/cell-cost.ts — how many simulations a matrix costs.
 *
 * Two facts about the matrix shape live here rather than being restated at
 * each call site, because both are easy to get subtly wrong and a mistake in
 * either produces a plausible number rather than an obvious failure:
 *
 *  - the matrix covers unordered pairs, so it is n(n-1)/2 per condition, not
 *    n² and not n(n-1);
 *  - every simulated cell writes two rows, the simulated one and its mirror
 *    (SPEC-sim.md Phase 4), so a row count is twice a cell count.
 *
 * Browser-safe: no Node imports and no dex access, so the data status screen
 * can cost a refresh from the sqlite file it already has open, rather than
 * carrying a second copy of this arithmetic (BACKLOG item 03).
 */

export interface CellCost {
  /** Cells a build from empty would simulate. */
  full: number;
  /** Cells already recorded and still usable. */
  reusable: number;
  /** Cells a refresh must simulate. */
  to_simulate: number;
}

/** Cells in a complete matrix over `n` variants across `conditions` conditions. */
export function fullCellCount(n: number, conditions: number): number {
  return ((n * (n - 1)) / 2) * conditions;
}

/** Simulated cells implied by a row count, which stores each cell in both orders. */
export function cellsFromRows(rows: number): number {
  return Math.floor(rows / 2);
}

/**
 * Cost a refresh: `reusableRows` is the number of stored rows whose pair is
 * still live under the run being extended.
 */
export function cellCost(n: number, conditions: number, reusableRows: number): CellCost {
  const full = fullCellCount(n, conditions);
  const reusable = Math.min(full, cellsFromRows(reusableRows));
  return { full, reusable, to_simulate: Math.max(0, full - reusable) };
}

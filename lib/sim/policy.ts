/**
 * lib/sim/policy.ts — move-selection policies (SPEC-sim.md Phase 1).
 *
 * Design rationale: docs/policy-design.md. Three implementations:
 *  - `random`      — uniform over legal moves (harness testing baseline)
 *  - `damage-max`  — highest expected damage this turn (biased baseline)
 *  - `nash-d2`     — depth-limited equilibrium search on the planning model
 *                    (the production policy for the matchup matrix)
 *
 * All policies implement the MovePolicy interface consumed by engine.ts and
 * are constructed via getPolicy(id) — swapping policies never touches the
 * engine or harness.
 */
import type { MovePolicy, PolicyContext } from './engine';
import {
  PlanMove, PlanState, extractState, legalActions, step, evaluate,
  terminalValue, stateKey, clearDamageCache,
} from './model';

export { clearDamageCache };

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

interface RequestMove {
  move: string;
  id: string;
  pp?: number;
  disabled?: boolean;
}

/** Legal move slot numbers (1-based) from the actual Showdown request. */
function legalRequestSlots(request: any): number[] {
  const moves: RequestMove[] = request.active?.[0]?.moves ?? [];
  const legal = moves
    .map((m, i) => ({ ...m, slot: i + 1 }))
    .filter((m) => !m.disabled && (m.pp === undefined || m.pp > 0));
  // A forced single move (recharge, locked two-turn move) arrives as a
  // 1-move array; Struggle likewise.
  return legal.length ? legal.map((m) => m.slot) : [1];
}

// ---------------------------------------------------------------------------
// random
// ---------------------------------------------------------------------------

export const randomPolicy: MovePolicy = {
  id: 'random',
  version: '1.0.0',
  choose(ctx: PolicyContext): string {
    const slots = legalRequestSlots(ctx.request);
    const pick = slots[ctx.prng.random(slots.length)];
    return `move ${pick}`;
  },
};

// ---------------------------------------------------------------------------
// damage-max
// ---------------------------------------------------------------------------

export const damageMaxPolicy: MovePolicy = {
  id: 'damage-max',
  version: '1.0.0',
  choose(ctx: PolicyContext): string {
    const slots = legalRequestSlots(ctx.request);
    const state = extractState(ctx.battle);
    const myIdx = ctx.sideId === 'p1' ? 0 : 1;
    const me = state.mons[myIdx];

    let bestSlot = slots[0];
    let bestDmg = -1;
    for (const slot of slots) {
      const reqMove: RequestMove = ctx.request.active[0].moves[slot - 1];
      const planMove = me.moves.find((m) => m.id === reqMove.id);
      if (!planMove || planMove.category === 'Status') continue;
      const dmg = expectedDamageFraction(state, myIdx, planMove);
      if (dmg > bestDmg) {
        bestDmg = dmg;
        bestSlot = slot;
      }
    }
    return `move ${bestSlot}`;
  },
};

/** Mean damage (fraction of defender max HP) × accuracy for one move. */
function expectedDamageFraction(state: PlanState, myIdx: number, move: PlanMove): number {
  // Reuse the step() machinery on a throwaway state where the opponent does
  // nothing threatening, and measure the opponent's HP loss.
  const opp = state.mons[1 - myIdx];
  const before = opp.hp;
  const oppNoop = { ...move, id: 'recharge', isRecharge: true } as PlanMove;
  const branches = myIdx === 0 ? step(state, move, oppNoop as any) : step(state, oppNoop as any, move);
  let exp = 0;
  for (const b of branches) {
    exp += b.p * (before - b.state.mons[1 - myIdx].hp);
  }
  return exp / opp.maxhp;
}

// ---------------------------------------------------------------------------
// nash-dN — depth-limited equilibrium search
// ---------------------------------------------------------------------------

const FP_ITERATIONS = 80;

/**
 * Fictitious play on a zero-sum matrix (payoffs to the row player).
 * Returns the row player's mixed strategy and the game value estimate.
 */
export function solveMatrix(Q: number[][]): { strategy: number[]; value: number } {
  const nA = Q.length;
  const nB = Q[0].length;
  if (nA === 1 && nB === 1) return { strategy: [1], value: Q[0][0] };

  const cntA = new Array(nA).fill(0);
  const valA = new Array(nA).fill(0); // cumulative payoff of each row vs col's empirical play
  const valB = new Array(nB).fill(0); // cumulative payoff of each col vs row's empirical play
  let ia = 0;
  let ib = 0;
  for (let t = 0; t < FP_ITERATIONS; t++) {
    cntA[ia]++;
    for (let i = 0; i < nA; i++) valA[i] += Q[i][ib];
    for (let j = 0; j < nB; j++) valB[j] += Q[ia][j];
    // best responses to the opponent's empirical mixture
    ia = argmax(valA);
    ib = argmin(valB);
  }
  const strategy = cntA.map((c) => c / FP_ITERATIONS);
  // Game value bracketed by best-response payoffs; take the midpoint.
  const vUpper = Math.max(...valA) / FP_ITERATIONS;
  const vLower = Math.min(...valB) / FP_ITERATIONS;
  return { strategy, value: (vUpper + vLower) / 2 };
}

function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}

function argmin(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[best]) best = i;
  return best;
}

class NashSearch {
  private transposition = new Map<string, number>();

  constructor(private depth: number) {}

  /** Value of a state (P(A wins)-like, [0,1]) at a given remaining depth. */
  value(state: PlanState, depth: number): number {
    const t = terminalValue(state);
    if (t !== null) return t;
    if (depth === 0) return evaluate(state);

    const key = `${depth}:${stateKey(state)}`;
    const cached = this.transposition.get(key);
    if (cached !== undefined) return cached;

    const { value } = this.solve(state, depth);
    this.transposition.set(key, value);
    return value;
  }

  solve(state: PlanState, depth: number): { value: number; strategyA: number[]; actionsA: PlanMove[] } {
    const actsA = legalActions(state, 0);
    const actsB = legalActions(state, 1);
    const Q: number[][] = [];
    for (const a of actsA) {
      const row: number[] = [];
      for (const b of actsB) {
        let v = 0;
        for (const branch of step(state, a, b)) {
          v += branch.p * this.value(branch.state, depth - 1);
        }
        row.push(v);
      }
      Q.push(row);
    }
    const { strategy, value } = solveMatrix(Q);
    return { value, strategyA: strategy, actionsA: actsA };
  }
}

export function makeNashPolicy(depth = 2): MovePolicy {
  return {
    id: `nash-d${depth}`,
    version: '1.0.0',
    choose(ctx: PolicyContext): string {
      const state = extractState(ctx.battle);
      const myIdx = ctx.sideId === 'p1' ? 0 : 1;

      // The matrix game is solved from A's (p1's) perspective; for p2 we
      // solve the same game and read off the column player's strategy by
      // re-solving with sides swapped (state is symmetric in structure).
      const search = new NashSearch(depth);
      const solvedState = myIdx === 0 ? state : swapSides(state);
      const { strategyA, actionsA } = search.solve(solvedState, depth);

      // Sample from the equilibrium mixture with the seeded policy PRNG.
      const chosen = sampleIndex(strategyA, ctx.prng);
      const move = actionsA[chosen];

      return toChoice(ctx, move);
    },
  };
}

function swapSides(state: PlanState): PlanState {
  return {
    mons: [state.mons[1], state.mons[0]],
    weather: state.weather,
    weatherTurns: state.weatherTurns,
    terrain: state.terrain,
    terrainTurns: state.terrainTurns,
    trickRoom: state.trickRoom,
    tailwind: [state.tailwind[1], state.tailwind[0]],
    screens: [state.screens[1], state.screens[0]],
  };
}

function sampleIndex(probs: number[], prng: PolicyContext['prng']): number {
  const r = prng.random();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (r < acc) return i;
  }
  return probs.length - 1;
}

/** Map a chosen planning move back to a request slot choice. */
function toChoice(ctx: PolicyContext, move: PlanMove): string {
  const reqMoves: RequestMove[] = ctx.request.active?.[0]?.moves ?? [];
  const slots = legalRequestSlots(ctx.request);
  // Forced single choice (recharge / locked move / struggle)
  if (reqMoves.length === 1) return 'move 1';
  const idx = reqMoves.findIndex((m) => m.id === move.id);
  if (idx >= 0 && slots.includes(idx + 1)) return `move ${idx + 1}`;
  // Planning picked something the request disallows (model drift): fall back
  // to the first legal slot.
  return `move ${slots[0]}`;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY = new Map<string, () => MovePolicy>([
  ['random', () => randomPolicy],
  ['damage-max', () => damageMaxPolicy],
  ['nash-d2', () => makeNashPolicy(2)],
  ['nash-d3', () => makeNashPolicy(3)],
]);

export function getPolicy(id: string): MovePolicy {
  const factory = REGISTRY.get(id);
  if (!factory) throw new Error(`unknown policy: ${id} (known: ${[...REGISTRY.keys()].join(', ')})`);
  return factory();
}

/** The policy used for the matchup matrix. Recorded in sqlite metadata. */
export const DEFAULT_POLICY_ID = 'nash-d2';

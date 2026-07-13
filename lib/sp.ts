/**
 * lib/sp.ts — EV → Champions SP conversion, mirroring the official damage-calc
 * UI. Lifted out of lib/pokemon.ts (which imports @smogon/calc at module top)
 * so browser-safe code (lib/evaluator/*) can convert pasted EV spreads without
 * pulling the calc into non-damage bundles. lib/pokemon.ts re-exports both
 * helpers, so existing imports are unaffected.
 */
import type {StatID, StatsTable} from './types';

const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** Convert one EV value to SP (SP = ceil(EV/8), special case EV 4 → SP 1). */
export function evToSp(ev: number): number {
  if (ev === 4) return 1;
  return Math.min(32, Math.ceil(ev / 8));
}

/** Convert an EV spread (0–252 per stat) to an SP spread (0–32 per stat). */
export function evsToSps(evs: Partial<StatsTable>): Partial<StatsTable> {
  const sps: Partial<StatsTable> = {};
  for (const stat of STAT_IDS) {
    const ev = evs[stat];
    if (ev !== undefined) sps[stat] = evToSp(ev);
  }
  return sps;
}

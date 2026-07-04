/**
 * Move catalog helpers: classify scraped moves for the viz-1 pipeline.
 *
 * Philosophy for "variable BP" moves (spec: "skip these or apply a reasonable
 * default and flag them"): our model is a single clean hit — full HP, no
 * boosts, no prior damage, no fainted teammates, field = attacker's auto
 * weather. Within that model the calc resolves most "variable" BP exactly:
 * Weather Ball uses the auto-set weather, Acrobatics knows the attacker's
 * item, Grass Knot / Heavy Slam know both weights, Water Spout / Eruption are
 * at full HP, Facade is unstatused. Moves whose BP depends on state our model
 * says is zero (Last Respects, Rage Fist, Stored Power...) use their base BP
 * — an undercount, flagged in the build log and README.
 */
import {GEN, toID} from './pokemon';

/** OHKO moves — excluded entirely (spec). */
const OHKO_MOVES = new Set(['Sheer Cold', 'Fissure', 'Horn Drill', 'Guillotine']);

/** Weight-based BP moves — excluded because the synthetic target has no
 * meaningful weight (see classifyMove). */
const WEIGHT_BASED_MOVES = new Set(['Grass Knot', 'Low Kick', 'Heavy Slam', 'Heat Crash']);

/**
 * Damaging moves whose BP depends on battle state that our one-clean-hit
 * model fixes at zero. They are INCLUDED at the calc's in-model BP but
 * flagged as undercounted (real games have fainted allies, taken hits, etc.).
 */
export const STATE_DEPENDENT_BP_MOVES = new Set([
  'Last Respects', 'Rage Fist', 'Stored Power', 'Power Trip', 'Punishment',
  'Avalanche', 'Payback', 'Assurance', 'Revenge', 'Facade', 'Hex',
  'Infernal Parade', 'Barb Barrage',
]);

export interface MoveClassification {
  include: boolean;
  reason?: string;
  flagged?: boolean;
}

/** Decide whether a scraped move belongs in the viz-1 damage table. */
export function classifyMove(name: string): MoveClassification {
  if (name === 'Other') return {include: false, reason: 'aggregate "Other" row'};
  const data = GEN.moves.get(toID(name));
  if (!data) return {include: false, reason: 'not in Champions dex'};
  if (OHKO_MOVES.has(data.name)) return {include: false, reason: 'OHKO move'};
  if (data.category === 'Status' || !data.category) {
    return {include: false, reason: 'status move'};
  }
  if (WEIGHT_BASED_MOVES.has(data.name)) {
    // The calc CAN resolve these, but the BP would come from the stand-in
    // body's weight (Snorlax, 460 kg → max BP) — an artifact, because the
    // spec's synthetic target has no defined weight. Skipped and flagged.
    return {include: false, reason: 'weight-based BP vs weightless synthetic target'};
  }
  if (!data.basePower || data.basePower === 0) {
    // Fixed/esoteric damage (Seismic Toss, Counter, ...) — not modelable as BP.
    return {include: false, reason: 'no base power (fixed/esoteric damage)'};
  }
  if (!data.type) return {include: false, reason: 'broken dex entry (no type)'};
  if (STATE_DEPENDENT_BP_MOVES.has(data.name)) {
    return {include: true, flagged: true, reason: 'state-dependent BP, using in-model base BP'};
  }
  return {include: true};
}

/** Weather auto-set by an ability (spec Phase 3, step 3). */
export const WEATHER_ABILITIES: Record<string, 'Sun' | 'Rain' | 'Sand' | 'Snow' | 'Harsh Sunshine' | 'Heavy Rain'> = {
  'Drought': 'Sun',
  'Drizzle': 'Rain',
  'Sand Stream': 'Sand',
  'Snow Warning': 'Snow',
  'Primordial Sea': 'Heavy Rain',
  'Desolate Land': 'Harsh Sunshine',
};

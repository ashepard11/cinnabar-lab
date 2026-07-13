/**
 * lib/evaluator/bst.ts — total relevant BST (SPEC-team-evaluator.md Phase 3,
 * as revised in D36): per-member base-stat sums excluding stats the set
 * demonstrably doesn't use, reported as a *team average* — with and without
 * Speed when a Trick Room setter is present.
 */
import {getMove, getSpecies, isDamaging, toID} from './dex';
import type {DexMove, EvaluatorDex} from './dex';
import type {ParsedSet} from './parse';
import {hasFullSecondary} from './tags';
import type {StatID} from '../types';

/**
 * D36 utility-attack rule: a damaging move with BP ≤ 60 and a guaranteed
 * (100%-chance) secondary is clicked for its effect, not its damage — it does
 * not establish attack-stat usage. Low-BP moves without a rider (Aqua Jet)
 * still count. The override lists handle edge cases; additions go through
 * DECISIONS.md.
 */
const UTILITY_BP_MAX = 60;
const UTILITY_OVERRIDES_IN = new Set<string>([]);   // force-classify as utility
const UTILITY_OVERRIDES_OUT = new Set<string>([]);  // force-classify as attacking

export function isUtilityAttack(move: DexMove): boolean {
  if (!isDamaging(move)) return false;
  if (UTILITY_OVERRIDES_IN.has(toID(move.name))) return true;
  if (UTILITY_OVERRIDES_OUT.has(toID(move.name))) return false;
  return move.basePower <= UTILITY_BP_MAX && hasFullSecondary(move);
}

/** Physical moves that don't scale with the user's Atk stat. */
const NO_OWN_ATK = new Set(['bodypress', 'foulplay']);

export interface StatEntry {
  value: number;
  included: boolean;
  note?: string;
}

export interface MemberBst {
  perStat: Record<StatID, StatEntry>;
  totalWithSpeed: number;
  totalWithoutSpeed: number;
  notes: string[];
}

export interface BstReport {
  members: MemberBst[];
  averageWithSpeed: number;
  averageWithoutSpeed: number;
  /** True when a member carries Trick Room — show both averages. */
  hasTrickRoomSetter: boolean;
}

const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function memberBst(dex: EvaluatorDex, set: ParsedSet): MemberBst {
  const spec = getSpecies(dex, set.battleSpecies) ?? getSpecies(dex, set.species);
  const base = spec?.baseStats ?? {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
  const moves = set.moves.map((m) => getMove(dex, m)).filter((m): m is DexMove => !!m);
  const notes: string[] = [];

  const usage = (category: 'Physical' | 'Special'): {included: boolean; note?: string} => {
    const damaging = moves.filter((m) => m.category === category && isDamaging(m));
    const scaling = damaging.filter((m) => !(category === 'Physical' && NO_OWN_ATK.has(toID(m.name))));
    const attacking = scaling.filter((m) => !isUtilityAttack(m));
    if (attacking.length > 0) return {included: true};
    const utility = scaling.filter(isUtilityAttack);
    if (utility.length > 0) {
      return {included: false, note: `utility attacks only (${utility.map((m) => m.name).join(', ')})`};
    }
    if (damaging.some((m) => toID(m.name) === 'bodypress')) {
      notes.push('Body Press: Def is doing double duty (attacks off Def)');
    }
    if (damaging.some((m) => toID(m.name) === 'foulplay')) {
      notes.push("Foul Play uses the target's Atk");
    }
    return {included: false};
  };

  const atkUse = usage('Physical');
  const spaUse = usage('Special');

  const perStat: Record<StatID, StatEntry> = {
    hp: {value: base.hp, included: true},
    atk: {value: base.atk, included: atkUse.included, note: atkUse.note},
    def: {value: base.def, included: true},
    spa: {value: base.spa, included: spaUse.included, note: spaUse.note},
    spd: {value: base.spd, included: true},
    spe: {value: base.spe, included: true},
  };

  const sum = (withSpeed: boolean) => STAT_IDS
    .filter((s) => perStat[s].included && (withSpeed || s !== 'spe'))
    .reduce((acc, s) => acc + perStat[s].value, 0);

  return {perStat, totalWithSpeed: sum(true), totalWithoutSpeed: sum(false), notes};
}

export function relevantBst(dex: EvaluatorDex, sets: ParsedSet[]): BstReport {
  const members = sets.map((set) => memberBst(dex, set));
  const mean = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  const hasTrickRoomSetter = sets.some((set) =>
    set.moves.some((m) => getMove(dex, m)?.pseudoWeather === 'trickroom'));
  return {
    members,
    averageWithSpeed: mean(members.map((m) => m.totalWithSpeed)),
    averageWithoutSpeed: mean(members.map((m) => m.totalWithoutSpeed)),
    hasTrickRoomSetter,
  };
}

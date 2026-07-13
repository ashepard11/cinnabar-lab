/**
 * lib/evaluator/rng.ts — RNG exposure scan (SPEC-team-evaluator.md Phase 5).
 *
 * Locked approach (D35): bucketed tallies + per-interaction probabilities
 * derived from move metadata; deliberately NO team-level scalar score —
 * summing flinch chances, miss chances, and crit rates has no defensible
 * semantics.
 */
import {getMove, isDamaging, secondariesOf, toID} from './dex';
import type {DexMove, DexSecondary, EvaluatorDex} from './dex';
import type {ParsedSet} from './parse';
import type {StatID} from '../types';

export interface RngEntry {
  memberIndex: number;
  source: string;
  kind: 'move' | 'ability' | 'item';
  /** Human-readable probability/effect, e.g. "30% flinch", "acc 90". */
  detail: string;
  /** Sheer Force traded this secondary away — render struck-through. */
  struck?: boolean;
}

export interface RngReport {
  favorable: {
    crits: RngEntry[];
    /** Wanted secondaries in (0, 100)% chance. */
    secondaries: RngEntry[];
    sleep: RngEntry[];
  };
  unfavorable: {
    accUnder80: RngEntry[];
    acc80to89: RngEntry[];
    acc90to99: RngEntry[];
    crash: RngEntry[];
    ohko: RngEntry[];
    selfLock: RngEntry[];
  };
  /** Team-level notes (No Guard's two-way exemption, Sheer Force trades). */
  notes: string[];
}

// Curated RNG tables (validated; expected drops asserted in tests).
const CRIT_ABILITIES: Array<{name: string; detail: string}> = [
  {name: 'Super Luck', detail: '+1 crit stage'},
  {name: 'Sniper', detail: 'crits deal ×2.25'},
  {name: 'Merciless', detail: 'always crits poisoned targets'},
];
const CRIT_ITEMS: Array<{name: string; detail: string}> = [
  {name: 'Scope Lens', detail: '+1 crit stage'},
  {name: 'Razor Claw', detail: '+1 crit stage'},
];
/** Doubles secondary chances; a Champions dex gap today — kept so the
 * validation gate flags it if the gap closes. */
const SECONDARY_ABILITIES = ['Serene Grace'];

export const RNG_EXPECTED_DROPS = ['Razor Claw', 'Serene Grace'];

export function validateRngCurated(dex: EvaluatorDex): string[] {
  const missing = new Set<string>();
  for (const a of [...CRIT_ABILITIES.map((x) => x.name), ...SECONDARY_ABILITIES]) {
    if (!(toID(a) in dex.abilities)) missing.add(a);
  }
  for (const i of CRIT_ITEMS) if (!(toID(i.name) in dex.items)) missing.add(i.name);
  return [...missing].sort();
}

const STATUS_LABEL: Record<string, string> = {
  brn: 'burn', par: 'paralysis', psn: 'poison', tox: 'toxic poison',
  slp: 'sleep', frz: 'freeze',
};
const VOLATILE_LABEL: Record<string, string> = {
  flinch: 'flinch', confusion: 'confusion',
};
const STAT_LABELS: Record<StatID, string> = {hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe'};

function describeSecondary(sec: DexSecondary): string | null {
  const parts: string[] = [];
  if (sec.status && STATUS_LABEL[sec.status]) parts.push(STATUS_LABEL[sec.status]);
  if (sec.volatileStatus && VOLATILE_LABEL[sec.volatileStatus]) parts.push(VOLATILE_LABEL[sec.volatileStatus]);
  if (sec.boosts) {
    for (const [stat, v] of Object.entries(sec.boosts)) {
      parts.push(`${STAT_LABELS[stat as StatID]} ${v > 0 ? '+' : ''}${v}`);
    }
  }
  if (sec.selfBoosts) {
    for (const [stat, v] of Object.entries(sec.selfBoosts)) {
      parts.push(`${v > 0 ? '+' : ''}${v} ${STAT_LABELS[stat as StatID]} (self)`);
    }
  }
  return parts.length ? parts.join(', ') : null;
}

export function rngExposure(dex: EvaluatorDex, sets: ParsedSet[]): RngReport {
  const report: RngReport = {
    favorable: {crits: [], secondaries: [], sleep: []},
    unfavorable: {accUnder80: [], acc80to89: [], acc90to99: [], crash: [], ohko: [], selfLock: []},
    notes: [],
  };

  sets.forEach((set, memberIndex) => {
    const hasNoGuard = toID(set.ability) === toID('No Guard');
    const hasSheerForce = toID(set.ability) === toID('Sheer Force');
    if (hasNoGuard) {
      report.notes.push(
        `${set.species} has No Guard: its moves never miss — but incoming moves are sure-hit too.`,
      );
    }
    if (hasSheerForce) {
      report.notes.push(
        `${set.species} has Sheer Force: listed secondaries are traded for power (shown struck through).`,
      );
    }

    for (const a of CRIT_ABILITIES) {
      if (toID(a.name) in dex.abilities && toID(a.name) === toID(set.ability)) {
        report.favorable.crits.push({memberIndex, source: a.name, kind: 'ability', detail: a.detail});
      }
    }
    if (set.item) {
      for (const it of CRIT_ITEMS) {
        if (toID(it.name) in dex.items && toID(it.name) === toID(set.item)) {
          report.favorable.crits.push({memberIndex, source: it.name, kind: 'item', detail: it.detail});
        }
      }
    }

    const moves = set.moves.map((m) => getMove(dex, m)).filter((m): m is DexMove => !!m);
    for (const move of moves) {
      const entry = (detail: string, struck?: boolean): RngEntry =>
        ({memberIndex, source: move.name, kind: 'move', detail, struck});

      // favorable: enhanced crit
      if (isDamaging(move) && move.critRatio > 1) {
        report.favorable.crits.push(entry(`high crit ratio (${move.critRatio})`));
      }
      if (move.volatileStatus === 'focusenergy' || move.selfVolatile === 'focusenergy') {
        report.favorable.crits.push(entry('+2 crit stages'));
      }

      // favorable: wanted secondaries with real chance
      if (isDamaging(move)) {
        for (const sec of secondariesOf(move)) {
          if (sec.chance <= 0 || sec.chance >= 100) continue;
          const desc = describeSecondary(sec);
          if (desc) report.favorable.secondaries.push(entry(`${sec.chance}% ${desc}`, hasSheerForce || undefined));
        }
      }

      // favorable: sleep infliction (multi-turn duration RNG even at 100 acc)
      if (move.category === 'Status' && move.status === 'slp') {
        report.favorable.sleep.push(entry(
          move.accuracy === true || move.accuracy >= 100 ? 'sleep 1–3 turns' : `acc ${move.accuracy}, sleep 1–3 turns`,
        ));
      }

      // unfavorable: accuracy (No Guard exempts the whole set)
      if (!hasNoGuard && typeof move.accuracy === 'number' && move.accuracy < 100 && !move.ohko) {
        const e = entry(`acc ${move.accuracy}`);
        if (move.accuracy < 80) report.unfavorable.accUnder80.push(e);
        else if (move.accuracy < 90) report.unfavorable.acc80to89.push(e);
        else report.unfavorable.acc90to99.push(e);
      }
      if (move.hasCrashDamage) {
        report.unfavorable.crash.push(entry('crashes on miss (½ max HP)'));
      }
      if (move.ohko) {
        report.unfavorable.ohko.push(entry(`OHKO move (acc ${move.accuracy === true ? '—' : move.accuracy})`));
      }
      if (move.selfVolatile === 'lockedmove') {
        report.unfavorable.selfLock.push(entry('locks in 2–3 turns, ends confused'));
      }
    }
  });

  return report;
}

/** True when the favorable side is completely empty (the "no proactive RNG
 * upside" callout — a real UI state per spec, not an empty table). */
export function noFavorableRng(report: RngReport): boolean {
  return report.favorable.crits.length === 0 &&
    report.favorable.secondaries.filter((e) => !e.struck).length === 0 &&
    report.favorable.sleep.length === 0;
}

/**
 * lib/format-rules.ts — regulation-driven format rules (BACKLOG item 10,
 * SPEC-teambuilder.md Phase 0).
 *
 * Regulations roll over every three to four months and each changes the legal
 * Pokémon pool, the legal item list, the Mega Evolution list and occasionally
 * per-species move legality. Before this module, two format ids were hardcoded
 * — `battledataregmbs3` in lib/scrape.ts and `gen9championsbssregmb` in
 * lib/sim/engine.ts — so a rollover meant a code change in two places and a
 * silent mismatch everywhere else.
 *
 * The split here mirrors lib/evaluator/dex.ts:
 *
 *   - This module is the *declarative* half and must stay browser-safe: no
 *     Node imports, no pokemon-showdown, no @smogon/calc. It holds the facts
 *     that are not derivable from Showdown's data (dates, clause values, which
 *     mod carries which regulation, the Pikalytics format id) plus the pure
 *     validators the search and the loaders need.
 *   - scripts/build-format-rules.ts is the *resolved* half. It reads the
 *     vendored Showdown mod named here and emits data/format-rules-<id>.json
 *     with the legality sets. `FormatRules` is the two halves joined.
 *
 * Sourcing legality rather than hardcoding it is the whole point: switching
 * regulations is a configuration change, and an earlier regulation stays
 * queryable for backtesting (BACKLOG item 15).
 */
import type {StatID, StatsTable} from './types';

/** Showdown-style normalized id: lowercase alphanumerics only. */
export type SpeciesId = string;
export type ItemId = string;
export type MoveId = string;

export type RegulationId = 'M-A' | 'M-B' | 'M-C';

/**
 * The hand-maintained half of a regulation's rules — the facts Showdown's data
 * does not carry. Everything here is checked against the regulation
 * announcement, not inferred.
 */
export interface RegulationConfig {
  regulation_id: RegulationId;
  /** ISO date the regulation became legal. */
  active_from: string;
  /** ISO date it stopped being legal, or null while it is current. */
  active_until: string | null;
  /**
   * Showdown mod carrying this regulation's legality tables, or null when the
   * vendored build predates the regulation. See `isSourceable`.
   */
  showdown_mod: string | null;
  /**
   * Showdown format id that defines *legality* — the VGC doubles format, since
   * that is the format this project analyses. Null when unsourceable.
   *
   * This is deliberately not `sim_format`. The two differ in exactly the way
   * that matters: `Flat Rules` resolves `Picked Team Size = Auto` by game
   * type, so the VGC doubles format reports bring-4 and the BSS singles format
   * reports bring-3. Sourcing clauses from the harness's format would silently
   * describe a different game.
   */
  legality_format: string | null;
  /**
   * Showdown format id the 1v1 harness runs battles in, or null when
   * unsourceable. BSS (singles) rather than VGC (doubles) because the doubles
   * engine cannot start a battle with one Pokémon per side, and for a strict
   * 1v1 the two are mechanically identical — see DECISIONS.md D20–D21. This
   * is an implementation detail of the simulator and says nothing about
   * legality.
   */
  sim_format: string | null;
  /**
   * Pikalytics API format id for usage scraping (lib/scrape.ts), or null when
   * this project has never confirmed one. Only M-B's is known good — it is
   * what produced every usage file in data/. Guessing an id is worse than
   * admitting ignorance: the API answers an unrecognised format with an empty
   * array rather than a 404, so a wrong id scrapes zero Pokémon and reports
   * success.
   */
  pikalytics_format: string | null;
  level: 50;
  /** Champions gives every Pokémon 66 Stat Points to distribute. */
  sp_total: 66;
  /** …with no more than 32 in any one stat. */
  sp_per_stat_cap: 32;
  /**
   * Bring-6 pick-4. Both are declared here so browser code has them without
   * fetching the resolved JSON, and both are verified against the VGC
   * format's rule table by scripts/build-format-rules.ts, which fails the
   * build on a mismatch rather than letting a regulation change slip through.
   */
  team_size: 6;
  bring_count: 4;
  open_team_lists: boolean;
  /** No two Pokémon on a team may hold the same item. */
  item_clause: boolean;
  /**
   * Species clause keys on National Pokédex number, so alternate forms
   * collide: Heat Rotom and Wash Rotom cannot share a team.
   */
  species_clause_key: 'national_dex_number';
  max_megas_per_team: number;
}

/** A regulation's config joined with the legality sets resolved from Showdown. */
export interface FormatRules extends RegulationConfig {
  legal_species: Set<SpeciesId>;
  legal_items: Set<ItemId>;
  /** Species that can Mega Evolve → the stone that does it. */
  mega_capable: Map<SpeciesId, ItemId>;
  /** Per-species move bans from balance patches. Global bans are not this. */
  banned_moves: Map<SpeciesId, Set<MoveId>>;
  /** Species → National Pokédex number, for the species clause. */
  national_dex: Map<SpeciesId, number>;
}

/**
 * Every regulation this project knows about.
 *
 * `showdown_mod: null` means the vendored pokemon-showdown build predates the
 * regulation, so its legality cannot be resolved. That is not an error in
 * itself — the entry still carries the dates and clauses, and
 * `resolveFormatRules` fails with an explanation rather than a missing-mod
 * crash. Re-vendoring Showdown is what fills it in, and that bumps
 * SIM_ENGINE_VERSION, which invalidates the matchup matrix.
 */
export const REGULATIONS: Record<RegulationId, RegulationConfig> = {
  'M-A': {
    regulation_id: 'M-A',
    active_from: '2026-01-06',
    active_until: '2026-05-05',
    showdown_mod: 'championsregma',
    legality_format: 'gen9championsvgc2026regma',
    sim_format: 'gen9championsbssregma',
    // Never scraped by this project; the M-A season predates it.
    pikalytics_format: null,
    level: 50,
    sp_total: 66,
    sp_per_stat_cap: 32,
    team_size: 6,
    bring_count: 4,
    open_team_lists: true,
    item_clause: true,
    species_clause_key: 'national_dex_number',
    max_megas_per_team: 1,
  },
  'M-B': {
    regulation_id: 'M-B',
    active_from: '2026-05-06',
    active_until: '2026-09-08',
    showdown_mod: 'champions',
    legality_format: 'gen9championsvgc2026regmb',
    sim_format: 'gen9championsbssregmb',
    pikalytics_format: 'battledataregmbs3',
    level: 50,
    sp_total: 66,
    sp_per_stat_cap: 32,
    team_size: 6,
    bring_count: 4,
    open_team_lists: true,
    item_clause: true,
    species_clause_key: 'national_dex_number',
    max_megas_per_team: 1,
  },
  /**
   * Current as of 2026-09-09. The vendored Showdown build (e440c4a, ~July
   * 2026) ships only the `champions` (M-B) and `championsregma` (M-A) mods, so
   * M-C legality is not resolvable yet and the entry is deliberately
   * unsourceable. The species and item counts quoted in SPEC-teambuilder.md
   * (260 and 166, up from 224 and 148) are spec prose with nothing to verify
   * them against — do not encode them here as if they were data.
   *
   * The Pikalytics id is unknown for the same reason. `battledataregmcs1` is
   * the obvious extrapolation from M-B's `battledataregmbs3`, but a probe on
   * 2026-09-13 was inconclusive (the API returns `[]` for every
   * month-and-format pair, including ones known to hold data), so it stays
   * null until a real scrape confirms it.
   */
  'M-C': {
    regulation_id: 'M-C',
    active_from: '2026-09-09',
    active_until: '2026-12-02',
    showdown_mod: null,
    legality_format: null,
    sim_format: null,
    pikalytics_format: null,
    level: 50,
    sp_total: 66,
    sp_per_stat_cap: 32,
    team_size: 6,
    bring_count: 4,
    open_team_lists: true,
    item_clause: true,
    species_clause_key: 'national_dex_number',
    max_megas_per_team: 1,
  },
};

/**
 * The regulation everything defaults to.
 *
 * This is M-B, not the current M-C, and that is a deliberate lie about the
 * calendar: every committed artifact in data/ is M-B, and pointing the default
 * at a regulation with no vendored legality and no scraped usage would break
 * the pipeline rather than update it. Move it to M-C in the same change that
 * re-vendors Showdown and re-scrapes usage. See README "Regulation status".
 */
export const DEFAULT_REGULATION: RegulationId = 'M-B';

export function isRegulationId(value: string): value is RegulationId {
  return value in REGULATIONS;
}

/** True when the vendored Showdown build can supply this regulation's legality. */
export function isSourceable(config: RegulationConfig): boolean {
  return (
    config.showdown_mod !== null &&
    config.legality_format !== null &&
    config.sim_format !== null
  );
}

/**
 * Resolve the active regulation id from configuration.
 *
 * `override` is the configuration value — Node callers pass
 * `process.env.CHAMPIONS_REGULATION`, the frontend passes the regulation
 * selector's value. Unset falls through to the default; set-but-unknown throws
 * rather than silently falling back, since a typo'd regulation that quietly
 * builds M-B data is worse than a failed build.
 */
export function activeRegulationId(override?: string | null): RegulationId {
  if (override === undefined || override === null || override === '') {
    return DEFAULT_REGULATION;
  }
  if (!isRegulationId(override)) {
    const known = Object.keys(REGULATIONS).join(', ');
    throw new Error(`Unknown regulation "${override}". Known regulations: ${known}.`);
  }
  return override;
}

export function regulationConfig(id: RegulationId): RegulationConfig {
  return REGULATIONS[id];
}

/**
 * The config for the active regulation, reading process.env when it exists.
 * Guarded so the module stays importable in the browser.
 */
export function activeRegulationConfig(): RegulationConfig {
  const env =
    typeof process !== 'undefined' && process.env
      ? process.env.CHAMPIONS_REGULATION
      : undefined;
  return regulationConfig(activeRegulationId(env));
}

// --- SP budget validation (BACKLOG item 09) ---------------------------------

const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export interface SpValidationError {
  kind: 'total' | 'cap' | 'negative' | 'fractional';
  stat?: StatID;
  value: number;
  limit: number;
}

/**
 * Check an SP spread against the regulation's budget.
 *
 * Champions has no EVs and no IVs: every Pokémon is Level 50 with perfect
 * stats, and investment is `sp_total` points with a per-stat cap, each point
 * worth exactly 1 to the final stat. A scraped spread that breaks the budget
 * is a parsing error, not an exotic set, so callers should reject rather than
 * clamp — see `assertSpBudget`.
 *
 * Spending fewer than `sp_total` points is legal (and real sets do it), so
 * only the upper bound is enforced.
 */
export function validateSpSpread(
  sps: Partial<StatsTable>,
  rules: Pick<RegulationConfig, 'sp_total' | 'sp_per_stat_cap'>
): SpValidationError[] {
  const errors: SpValidationError[] = [];
  let total = 0;

  for (const stat of STAT_IDS) {
    const value = sps[stat];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      errors.push({kind: 'fractional', stat, value, limit: rules.sp_per_stat_cap});
      continue;
    }
    if (value < 0) {
      errors.push({kind: 'negative', stat, value, limit: 0});
      continue;
    }
    if (value > rules.sp_per_stat_cap) {
      errors.push({kind: 'cap', stat, value, limit: rules.sp_per_stat_cap});
    }
    total += value;
  }

  if (total > rules.sp_total) {
    errors.push({kind: 'total', value: total, limit: rules.sp_total});
  }
  return errors;
}

export function describeSpErrors(errors: SpValidationError[]): string {
  return errors
    .map((e) => {
      switch (e.kind) {
        case 'total':
          return `${e.value} SP total exceeds the ${e.limit}-point budget`;
        case 'cap':
          return `${e.value} SP in ${e.stat} exceeds the ${e.limit}-per-stat cap`;
        case 'negative':
          return `${e.value} SP in ${e.stat} is negative`;
        case 'fractional':
          return `${e.value} SP in ${e.stat} is not a whole number`;
      }
    })
    .join('; ');
}

/** Throw if a spread breaks the budget. `label` identifies the offender. */
export function assertSpBudget(
  sps: Partial<StatsTable>,
  rules: Pick<RegulationConfig, 'sp_total' | 'sp_per_stat_cap'>,
  label: string
): void {
  const errors = validateSpSpread(sps, rules);
  if (errors.length > 0) {
    throw new Error(`Illegal SP spread for ${label}: ${describeSpErrors(errors)}`);
  }
}

// --- Team-level clauses -----------------------------------------------------

/** The minimum a team member must expose for the clause checks to run. */
export interface TeamMemberRef {
  /** Identifier used in error messages — a variant slug or a species name. */
  label: string;
  species: SpeciesId;
  item: ItemId | null;
  is_mega: boolean;
}

export interface ClauseViolation {
  clause: 'item' | 'species' | 'mega_limit' | 'team_size' | 'legality';
  message: string;
}

/**
 * Check a team against the regulation's clauses.
 *
 * `national_dex` and the legality sets come from the resolved FormatRules;
 * pass a partial when only some checks are wanted (the set editor validates
 * legality before a team exists, Phase 6b).
 */
export function validateTeam(
  members: TeamMemberRef[],
  rules: RegulationConfig & Partial<Pick<FormatRules, 'national_dex' | 'legal_species' | 'legal_items'>>
): ClauseViolation[] {
  const violations: ClauseViolation[] = [];

  if (members.length > rules.team_size) {
    violations.push({
      clause: 'team_size',
      message: `${members.length} Pokémon exceeds the ${rules.team_size}-slot team`,
    });
  }

  if (rules.item_clause) {
    const seen = new Map<ItemId, string>();
    for (const m of members) {
      if (!m.item) continue;
      const clash = seen.get(m.item);
      if (clash) {
        violations.push({
          clause: 'item',
          message: `${m.label} and ${clash} both hold ${m.item}`,
        });
      } else {
        seen.set(m.item, m.label);
      }
    }
  }

  if (rules.national_dex) {
    const seen = new Map<number, string>();
    for (const m of members) {
      const dex = rules.national_dex.get(m.species);
      if (dex === undefined) {
        violations.push({
          clause: 'legality',
          message: `${m.label}: no National Pokédex number for ${m.species}`,
        });
        continue;
      }
      const clash = seen.get(dex);
      if (clash) {
        violations.push({
          clause: 'species',
          message: `${m.label} and ${clash} share National Pokédex #${dex}`,
        });
      } else {
        seen.set(dex, m.label);
      }
    }
  }

  const megas = members.filter((m) => m.is_mega).length;
  if (megas > rules.max_megas_per_team) {
    violations.push({
      clause: 'mega_limit',
      message: `${megas} Mega Evolutions exceeds the limit of ${rules.max_megas_per_team}`,
    });
  }

  if (rules.legal_species) {
    for (const m of members) {
      if (!rules.legal_species.has(m.species)) {
        violations.push({
          clause: 'legality',
          message: `${m.label}: ${m.species} is not legal in ${rules.regulation_id}`,
        });
      }
    }
  }

  if (rules.legal_items) {
    for (const m of members) {
      if (m.item && !rules.legal_items.has(m.item)) {
        violations.push({
          clause: 'legality',
          message: `${m.label}: ${m.item} is not legal in ${rules.regulation_id}`,
        });
      }
    }
  }

  return violations;
}

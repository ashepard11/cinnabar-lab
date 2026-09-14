/**
 * Pikalytics scraper for Pokémon Champions VGC ranked battle data.
 *
 * Pikalytics pages are client-rendered from a JSON API, so we hit the API
 * directly instead of parsing HTML (discovered during Phase 1; see
 * DECISIONS.md D6/D7):
 *
 *   GET /api/l/{date}/{format}-{cutoff}          → leaderboard list
 *   GET /api/p/{date}/{format}-{cutoff}/{name}   → per-Pokémon detail
 *
 * where {date} is a stats month like "2026-05", {format} is e.g.
 * "battledataregmbs3" (Reg M-B Season 3 ranked battle data) and {cutoff} is a
 * Glicko rating cutoff (1760 is the site default).
 *
 * Usage % is not present in this format's API. We derive it from per-Pokémon
 * game counts: usage(P) = games(P) / (Σ games / TEAM_SIZE), i.e. the fraction
 * of teams that include P assuming 6-Pokémon teams. This reproduces the
 * spec's worked examples (Garchomp ≈ 40%, Charizardite Y at 95% of Charizard
 * items).
 *
 * Spreads in this API are SP-denominated already (0–32 per stat, field name
 * "ev", order hp/atk/def/spa/spd/spe). Natures are a separate ranked list —
 * spreads carry no nature, so the modal set combines modal spread + modal
 * nature + modal ability + modal item.
 */
import axios from 'axios';
import {activeRegulationConfig} from './format-rules';
import type {ModalSet, PokemonUsage, StatsTable, UsageData, UsageEntry} from './types';

const BASE = 'https://pikalytics.com';
/**
 * The two Pikalytics feeds for the active regulation (BACKLOG item 10).
 *
 * Usage weights come from the tournament feed and build data — moves, items,
 * abilities, natures, spreads — from the ladder feed, because the tournament
 * feed publishes no spreads at all. Both are resolved from configuration; set
 * CHAMPIONS_REGULATION to switch. A regulation whose ids this project has
 * never confirmed throws here rather than scraping zero Pokémon and reporting
 * success — the API answers an unrecognised format with `[]`, not a 404, so a
 * wrong id looks like a quiet metagame collapse.
 */
function requireFormat(kind: 'usage' | 'build'): string {
  const cfg = activeRegulationConfig();
  const id = kind === 'usage' ? cfg.pikalytics_usage_format : cfg.pikalytics_build_format;
  if (id === null) {
    throw new Error(
      `No confirmed Pikalytics ${kind} format id for regulation ${cfg.regulation_id}. ` +
        `Find it against the live API and record it in lib/format-rules.ts ` +
        `before scraping.`
    );
  }
  return id;
}

export const USAGE_FORMAT = requireFormat('usage');
export const BUILD_FORMAT = requireFormat('build');
/** Back-compat alias: the feed a single-format caller means is the usage one. */
export const FORMAT = USAGE_FORMAT;
export const RATING_CUTOFF = 1760;
const TEAM_SIZE = 6;
const REQUEST_DELAY_MS = 1000;
/** Inclusion threshold from the spec: keep Pokémon with ≥ 1% usage. */
export const USAGE_THRESHOLD = 0.01;

const http = axios.create({
  baseURL: BASE,
  timeout: 30_000,
  headers: {
    'User-Agent':
      'pokemon-champions-viz research scraper (github.com/ashepard11/cinnabar-lab)',
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET with backoff on 429. The API rate-limits well before the politeness
 * delay would suggest, and a mid-scrape 429 otherwise throws away every
 * Pokémon fetched so far.
 */
async function getWithRetry(url: string, tries = 4): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await http.get(url)).data;
    } catch (err: any) {
      const status = err?.response?.status;
      if (attempt >= tries || (status !== 429 && status !== 503)) throw err;
      await sleep(attempt * 5000);
    }
  }
}

// --- Raw API shapes (only the fields we consume) ---

interface ApiListEntry {
  name: string;
  rank: string;
  games: number;
  /**
   * Usage share as a percent string ("48.87"), present on the tournament and
   * doubles-ladder feeds and absent on the older `battledata*` singles feed.
   * When present it is authoritative; see `usageOf`.
   */
  percent?: string | null;
}

interface ApiPercentEntry {
  percent: string; // "89.4" = 89.4%
}

interface ApiPokemon {
  name: string;
  moves?: Array<ApiPercentEntry & {move: string; type: string}>;
  abilities?: Array<ApiPercentEntry & {ability: string}>;
  items?: Array<ApiPercentEntry & {item: string}>;
  natures?: Array<ApiPercentEntry & {nature: string}> | null;
  spreads?: Array<ApiPercentEntry & {nature: string; ev: string}> | null;
}

/**
 * Find the newest stats month with data, starting from the current month and
 * probing backwards. The site's "current month" rolls forward and briefly has
 * no data, so a fixed date would break the weekly cron.
 */
export async function discoverDataDate(
  format = FORMAT,
  cutoff = RATING_CUTOFF,
  now = new Date()
): Promise<string> {
  for (let back = 0; back < 6; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    try {
      const list = await fetchLeaderboard(date, format, cutoff);
      if (Array.isArray(list) && list.length > 0) return date;
    } catch {
      // fall through to previous month
    }
    await sleep(REQUEST_DELAY_MS);
  }
  throw new Error(`No Pikalytics data found for ${format} in the last 6 months`);
}

export async function fetchLeaderboard(
  date: string,
  format = FORMAT,
  cutoff = RATING_CUTOFF
): Promise<ApiListEntry[]> {
  const data = await getWithRetry(`/api/l/${date}/${format}-${cutoff}`);
  if (!Array.isArray(data)) throw new Error(`Unexpected leaderboard payload for ${date}`);
  return data;
}

export async function fetchPokemonDetail(
  date: string,
  name: string,
  format = FORMAT,
  cutoff = RATING_CUTOFF
): Promise<ApiPokemon> {
  return getWithRetry(
    `/api/p/${date}/${format}-${cutoff}/${encodeURIComponent(name.toLowerCase())}`
  );
}

const pct = (s: string | undefined): number => {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? n / 100 : 0;
};

const toUsageEntries = <K extends string>(
  rows: Array<ApiPercentEntry & Record<K, string>> | undefined,
  key: K
): UsageEntry[] => (rows ?? []).map((r) => ({name: r[key], usage: pct(r.percent)}));

/**
 * The base species a Mega forme builds from: "Charizard-Mega-Y" -> "Charizard".
 *
 * The two feeds model Mega Evolution differently. The tournament feed makes
 * each Mega a first-class entry with its own usage — 25 of the 70 Pokémon above
 * the threshold, 28% of all usage weight — while the ladder feed has none at
 * all, carrying the stone as an item on the base species instead. Joining on
 * the raw name therefore loses every Mega; falling back to the base species
 * resolves all of them (70/70 for M-B, 72/72 for M-C, verified 2026-09-14).
 *
 * Taking a Mega's spread from its base form is not a compromise forced by the
 * join — `lib/variants.ts` already does exactly this, because Pikalytics has
 * never published Mega-specific spreads.
 */
export function baseSpeciesName(name: string): string {
  return name.replace(/-Mega(-[XYZ])?$/i, '');
}

/** Parse "2/32/0/0/0/32" (hp/atk/def/spa/spd/spe, SP-denominated) into a table. */
export function parseSpread(ev: string): StatsTable | null {
  const parts = ev.split('/').map((x) => parseInt(x, 10));
  if (parts.length !== 6 || parts.some((x) => !Number.isFinite(x) || x < 0 || x > 32)) {
    return null;
  }
  const [hp, atk, def, spa, spd, spe] = parts;
  return {hp, atk, def, spa, spd, spe};
}

/**
 * Usage share for a leaderboard entry, as a fraction of teams containing it.
 *
 * Two feeds, two answers. The tournament and doubles-ladder feeds carry a
 * `percent` field that matches what the site displays, and it is authoritative.
 * The older `battledata*` singles feed carries no such field, so usage is
 * derived from game counts: games(P) x 6 / total games, i.e. the share of
 * 6-slot teams containing P.
 *
 * Mixing these up is silent and severe. Deriving from games on a feed that has
 * `percent` puts Rillaboom at 7.6% where the site says 48.9%, and reorders the
 * whole metagame — the derivation assumes every entry's games are counted the
 * same way, which does not hold across feeds.
 */
export function usageOf(entry: ApiListEntry, totalGames: number): number {
  if (entry.percent !== undefined && entry.percent !== null && entry.percent !== '') {
    const pctValue = parseFloat(entry.percent);
    if (Number.isFinite(pctValue)) return pctValue / 100;
  }
  if (totalGames <= 0) return 0;
  return ((entry.games || 0) * TEAM_SIZE) / totalGames;
}

function buildModalSet(detail: ApiPokemon, warn: (msg: string) => void): ModalSet | null {
  const ability = detail.abilities?.[0]?.ability;
  const item = detail.items?.[0]?.item;
  const nature = detail.natures?.[0]?.nature || 'Hardy';
  const spreadRow = detail.spreads?.[0];
  const sps = spreadRow ? parseSpread(spreadRow.ev) : null;
  if (!ability || !item) {
    warn(`${detail.name}: missing modal ability/item; skipping modal_set`);
    return null;
  }
  if (!sps) {
    // Spec fallback: default spread = max attacking stat (handled by the
    // variant builder, which knows which attacking stat is bigger).
    warn(`${detail.name}: unparseable modal spread ${spreadRow?.ev ?? '(none)'}; falling back to default spread downstream`);
  }
  return {ability, item, nature, sps};
}

export interface ScrapeOptions {
  /** Usage-weight feed. Defaults to the active regulation's tournament id. */
  format?: string;
  /** Build-data feed (moves/items/abilities/natures/spreads). */
  buildFormat?: string;
  cutoff?: number;
  /** Skip the politeness delay (tests only). */
  delayMs?: number;
  log?: (msg: string) => void;
}

/**
 * Full scrape: tournament leaderboard for weights, ladder feed for builds.
 *
 * The two feeds are joined on species name. A Pokémon brought at events but
 * absent from the ladder feed has a weight and no build, which is reported
 * rather than silently defaulted — a roster of invented spreads would produce
 * plausible numbers that trace back to nothing.
 */
export async function scrapeUsage(opts: ScrapeOptions = {}): Promise<UsageData> {
  const usageFormat = opts.format ?? USAGE_FORMAT;
  const buildFormat = opts.buildFormat ?? BUILD_FORMAT;
  const cutoff = opts.cutoff ?? RATING_CUTOFF;
  const delayMs = opts.delayMs ?? REQUEST_DELAY_MS;
  const log = opts.log ?? ((msg: string) => console.log(msg));

  const date = await discoverDataDate(usageFormat, cutoff);
  log(`Using stats month ${date}`);
  log(`  weights from ${usageFormat}-${cutoff}`);
  log(`  builds  from ${buildFormat}-${cutoff}`);

  const list = await fetchLeaderboard(date, usageFormat, cutoff);
  if (list.length === 0) {
    throw new Error(
      `Usage feed ${usageFormat} returned no entries for ${date}. The API answers ` +
        `an unrecognised format with [], so this is either a wrong format id or a ` +
        `genuinely empty month — it is never a reason to write an empty usage file.`
    );
  }
  const totalGames = list.reduce((a, e) => a + (e.games || 0), 0);
  const derived = list.every((e) => e.percent === undefined || e.percent === null);
  if (derived && totalGames <= 0) throw new Error('Leaderboard has no game counts and no percent field');
  log(`  usage source: ${derived ? 'derived from game counts' : 'percent field'}`);

  const withUsage = list
    .map((e) => ({name: e.name, games: e.games || 0, usage: usageOf(e, totalGames)}))
    .sort((a, b) => b.usage - a.usage);

  const included = withUsage.filter((e) => e.usage >= USAGE_THRESHOLD);
  log(`${list.length} Pokémon in the usage feed; ${included.length} at ≥${USAGE_THRESHOLD * 100}% usage`);
  if (included.length === 0) {
    throw new Error(`No Pokémon cleared the ${USAGE_THRESHOLD * 100}% threshold — refusing to write an empty roster`);
  }

  const pokemon: PokemonUsage[] = [];
  const noBuild: string[] = [];
  const noSpread: string[] = [];
  for (const entry of included) {
    await sleep(delayMs);
    // Moves, items and abilities come from the usage feed: it is Mega-aware,
    // so a Mega forme's movepool is its own rather than its base form's.
    const build = await fetchPokemonDetail(date, entry.name, usageFormat, cutoff);
    if (!build || typeof build !== 'object') {
      noBuild.push(entry.name);
      continue;
    }
    // Spreads and natures come from the build feed, looked up by base species
    // because the tournament feed has Mega entries and the ladder feed does not.
    // When a regulation uses one feed for both halves (M-B), the fetch above
    // already has them — refetching would only double the rate-limit pressure.
    let merged: ApiPokemon = build;
    if (buildFormat !== usageFormat) {
      await sleep(delayMs);
      const spreadSrc = await fetchPokemonDetail(date, baseSpeciesName(entry.name), buildFormat, cutoff);
      merged = {
        ...build,
        spreads: (spreadSrc && typeof spreadSrc === 'object' ? spreadSrc.spreads : undefined) ?? [],
        natures: (spreadSrc && typeof spreadSrc === 'object' ? spreadSrc.natures : undefined) ?? [],
      };
    }
    const modal = buildModalSet(merged, (m) => log(`WARN ${m}`));
    if (!modal || modal.sps === null) noSpread.push(entry.name);
    pokemon.push({
      name: entry.name,
      usage: entry.usage,
      moves: toUsageEntries(build.moves, 'move'),
      abilities: toUsageEntries(build.abilities, 'ability'),
      items: toUsageEntries(build.items, 'item'),
      modal_set: modal,
    });
    log(`  scraped ${entry.name} (${(entry.usage * 100).toFixed(1)}%)`);
  }

  if (noBuild.length > 0) {
    log(`WARN ${noBuild.length} Pokémon had usage but no build data in ${usageFormat}: ${noBuild.join(', ')}`);
  }
  // A handful of missing spreads is ordinary long-tail thinness. A roster-wide
  // absence means the build feed has not published spreads for this regulation
  // yet, and every variant would silently take the default spread — which is
  // the failure mode this scrape exists to avoid.
  const spreadless = noSpread.length + noBuild.length;
  if (included.length > 0 && spreadless >= included.length) {
    throw new Error(
      `No Pokémon in ${buildFormat} carry an SP spread (${spreadless}/${included.length}). ` +
        `Every variant would fall back to a default spread. The tournament feeds never ` +
        `publish spreads, and a ladder feed for a young regulation may not yet — ` +
        `check the feed before treating this as a data problem.`
    );
  }
  if (noSpread.length > 0) {
    log(`WARN ${noSpread.length} Pokémon have no parseable spread; they take the default: ${noSpread.join(', ')}`);
  }

  return {
    scraped_at: new Date().toISOString(),
    format: usageFormat,
    build_format: buildFormat,
    pokemon,
  };
}

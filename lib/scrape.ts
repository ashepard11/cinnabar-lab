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
import type {ModalSet, PokemonUsage, StatsTable, UsageData, UsageEntry} from './types';

const BASE = 'https://pikalytics.com';
export const FORMAT = 'battledataregmbs3';
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

// --- Raw API shapes (only the fields we consume) ---

interface ApiListEntry {
  name: string;
  rank: string;
  games: number;
}

interface ApiPercentEntry {
  percent: string; // "89.4" = 89.4%
}

interface ApiPokemon {
  name: string;
  moves?: Array<ApiPercentEntry & {move: string; type: string}>;
  abilities?: Array<ApiPercentEntry & {ability: string}>;
  items?: Array<ApiPercentEntry & {item: string}>;
  natures?: Array<ApiPercentEntry & {nature: string}>;
  spreads?: Array<ApiPercentEntry & {nature: string; ev: string}>;
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
  const res = await http.get(`/api/l/${date}/${format}-${cutoff}`);
  if (!Array.isArray(res.data)) throw new Error(`Unexpected leaderboard payload for ${date}`);
  return res.data;
}

export async function fetchPokemonDetail(
  date: string,
  name: string,
  format = FORMAT,
  cutoff = RATING_CUTOFF
): Promise<ApiPokemon> {
  const res = await http.get(
    `/api/p/${date}/${format}-${cutoff}/${encodeURIComponent(name.toLowerCase())}`
  );
  return res.data;
}

const pct = (s: string | undefined): number => {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? n / 100 : 0;
};

const toUsageEntries = <K extends string>(
  rows: Array<ApiPercentEntry & Record<K, string>> | undefined,
  key: K
): UsageEntry[] => (rows ?? []).map((r) => ({name: r[key], usage: pct(r.percent)}));

/** Parse "2/32/0/0/0/32" (hp/atk/def/spa/spd/spe, SP-denominated) into a table. */
export function parseSpread(ev: string): StatsTable | null {
  const parts = ev.split('/').map((x) => parseInt(x, 10));
  if (parts.length !== 6 || parts.some((x) => !Number.isFinite(x) || x < 0 || x > 32)) {
    return null;
  }
  const [hp, atk, def, spa, spd, spe] = parts;
  return {hp, atk, def, spa, spd, spe};
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
  format?: string;
  cutoff?: number;
  /** Skip the politeness delay (tests only). */
  delayMs?: number;
  log?: (msg: string) => void;
}

/** Full scrape: leaderboard → filter ≥1% usage → per-Pokémon details. */
export async function scrapeUsage(opts: ScrapeOptions = {}): Promise<UsageData> {
  const format = opts.format ?? FORMAT;
  const cutoff = opts.cutoff ?? RATING_CUTOFF;
  const delayMs = opts.delayMs ?? REQUEST_DELAY_MS;
  const log = opts.log ?? ((msg: string) => console.log(msg));

  const date = await discoverDataDate(format, cutoff);
  log(`Using stats month ${date} for ${format}-${cutoff}`);

  const list = await fetchLeaderboard(date, format, cutoff);
  const totalGames = list.reduce((a, e) => a + (e.games || 0), 0);
  if (totalGames <= 0) throw new Error('Leaderboard has no game counts');

  const withUsage = list
    .map((e) => ({name: e.name, games: e.games || 0, usage: ((e.games || 0) * TEAM_SIZE) / totalGames}))
    .sort((a, b) => b.usage - a.usage);

  const included = withUsage.filter((e) => e.usage >= USAGE_THRESHOLD);
  log(`${list.length} Pokémon on leaderboard; ${included.length} at ≥${USAGE_THRESHOLD * 100}% usage`);

  const pokemon: PokemonUsage[] = [];
  for (const entry of included) {
    await sleep(delayMs);
    const detail = await fetchPokemonDetail(date, entry.name, format, cutoff);
    pokemon.push({
      name: entry.name,
      usage: entry.usage,
      moves: toUsageEntries(detail.moves, 'move'),
      abilities: toUsageEntries(detail.abilities, 'ability'),
      items: toUsageEntries(detail.items, 'item'),
      modal_set: buildModalSet(detail, (m) => log(`WARN ${m}`)),
    });
    log(`  scraped ${entry.name} (${(entry.usage * 100).toFixed(1)}%)`);
  }

  return {
    scraped_at: new Date().toISOString(),
    format,
    pokemon,
  };
}

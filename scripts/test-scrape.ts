/**
 * scripts/test-scrape.ts — Pikalytics feed handling (BACKLOG item 10).
 *
 * Run: npm run test-scrape
 *
 * Hermetic: runs against trimmed live payloads captured in
 * data/fixtures/pikalytics-feeds.json, not the network. What it guards is the
 * pair of facts that make the two-feed split necessary and that fail silently
 * when got wrong — which feed carries usage percentages, and how Mega formes
 * join across feeds.
 */
import * as fs from 'fs';
import * as path from 'path';
import {usageOf, baseSpeciesName, parseSpread} from '../lib/scrape';
import {REGULATIONS} from '../lib/format-rules';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const section = (s: string) => console.log(`\n${s}\n`);

interface Entry {name: string; rank: string; games: number; percent?: string | null}
const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'fixtures', 'pikalytics-feeds.json'), 'utf8')
) as {
  captured_at: string;
  month: string;
  feeds: Record<string, {entries: number; sample: Entry[]}>;
};

const tour = fixture.feeds['championstournamentsregmb'];
const ladder = fixture.feeds['gen9championsvgc2026regmb'];
const tourMc = fixture.feeds['championstournaments'];

// ---------------------------------------------------------------------------
section('Usage semantics');

check('the tournament feed carries a percent field',
  tour.sample.every((e) => e.percent !== undefined && e.percent !== null),
  `${tour.entries} entries`);
check('the singles-ladder feed does not',
  ladder.sample.every((e) => e.percent === undefined || e.percent === null),
  'usage must be derived from game counts there');

{
  const e = tour.sample[0];
  const total = tour.sample.reduce((a, x) => a + (x.games || 0), 0);
  const fromPercent = usageOf(e, total);
  const fromGames = ((e.games || 0) * 6) / total;
  check('percent wins when present',
    Math.abs(fromPercent - parseFloat(e.percent!) / 100) < 1e-9,
    `${e.name} ${(fromPercent * 100).toFixed(2)}%`);
  // The whole reason the distinction is load-bearing: on a percent-carrying
  // feed the games derivation is not a rounding difference, it is a different
  // number and a different ranking.
  check('the games derivation disagrees materially on that feed',
    Math.abs(fromGames - fromPercent) > 0.05,
    `derived ${(fromGames * 100).toFixed(2)}% vs stated ${(fromPercent * 100).toFixed(2)}%`);
}

{
  const e: Entry = {name: 'X', rank: '1', games: 100};
  check('games derivation is used when percent is absent',
    Math.abs(usageOf(e, 600) - 1.0) < 1e-9, '100 games of 600 total = 1.0 of 6-slot teams');
  check('an empty percent string falls through to games',
    Math.abs(usageOf({...e, percent: ''}, 600) - 1.0) < 1e-9);
  check('a null percent falls through to games',
    Math.abs(usageOf({...e, percent: null}, 600) - 1.0) < 1e-9);
  check('zero total games yields zero rather than NaN',
    usageOf({name: 'X', rank: '1', games: 0}, 0) === 0);
}

// ---------------------------------------------------------------------------
section('Mega joins across feeds');

check('the tournament feed makes Mega formes first-class entries',
  tourMc.sample.some((e) => /-Mega/.test(e.name)) ||
    tour.sample.some((e) => /-Mega/.test(e.name)),
  'so they carry their own usage');
check('base species strips the Mega suffix',
  baseSpeciesName('Charizard-Mega-Y') === 'Charizard' &&
    baseSpeciesName('Garchomp-Mega') === 'Garchomp' &&
    baseSpeciesName('Absol-Mega-Z') === 'Absol' &&
    baseSpeciesName('Raichu-Mega-Y') === 'Raichu');
check('non-Mega names are untouched',
  baseSpeciesName('Kingambit') === 'Kingambit' &&
    baseSpeciesName('Indeedee-F') === 'Indeedee-F' &&
    baseSpeciesName('Ninetales-Alola') === 'Ninetales-Alola');
check('a species that merely contains "mega" is not truncated',
  baseSpeciesName('Meganium') === 'Meganium' && baseSpeciesName('Yanmega') === 'Yanmega',
  'the suffix is anchored to the end');

// ---------------------------------------------------------------------------
section('Spread parsing');

check('a valid SP spread parses',
  JSON.stringify(parseSpread('2/32/0/0/0/32')) ===
    JSON.stringify({hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32}));
check('a spread over the 32 cap is rejected', parseSpread('0/33/0/0/0/0') === null,
  'rejecting beats clamping: a clamped spread produces plausible wrong damage');
check('a short spread is rejected', parseSpread('2/32/0') === null);
check('a non-numeric spread is rejected', parseSpread('a/b/c/d/e/f') === null);

// ---------------------------------------------------------------------------
section('Regulation feed ids');

for (const [id, cfg] of Object.entries(REGULATIONS)) {
  check(`${id} declares both feeds`,
    typeof cfg.pikalytics_usage_format === 'string' &&
      typeof cfg.pikalytics_build_format === 'string',
    `${cfg.pikalytics_usage_format} / ${cfg.pikalytics_build_format}`);
}
// The split exists to work around a feed that lacks spreads, so it is required
// only where that is true. M-B's single feed carries both halves and stays on
// it; splitting it would rescrape into different content ids and invalidate the
// matrix for no gain.
check('M-C splits its feeds, because the tournament feed has no spreads',
  REGULATIONS['M-C'].pikalytics_usage_format !== REGULATIONS['M-C'].pikalytics_build_format);
check('M-B stays on the single proven feed',
  REGULATIONS['M-B'].pikalytics_usage_format === 'battledataregmbs3' &&
    REGULATIONS['M-B'].pikalytics_build_format === 'battledataregmbs3',
  'so the weekly refresh keeps producing comparable numbers');
check('the current regulation uses the unsuffixed tournament id',
  REGULATIONS['M-C'].pikalytics_usage_format === 'championstournaments',
  'Pikalytics archives the previous regulation under a suffix, like Showdown does');
check('archived regulations use suffixed tournament ids where they use them',
  REGULATIONS['M-A'].pikalytics_usage_format === 'championstournamentsregma');

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILURES`}`);
process.exit(failures > 0 ? 1 : 0);

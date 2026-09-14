/**
 * scripts/test-effects.ts — the shared effect taxonomy (BACKLOG item 11).
 *
 * Run: npm run test-effects
 *
 * Item 11 existed because one taxonomy had three hand-maintained copies and
 * they had already diverged. Deleting the copies is the fix; this suite is what
 * stops them growing back, by asserting the properties a caller would otherwise
 * be tempted to re-implement locally — total coverage of categories by display
 * groups, the Wide/Quick Guard placement rule, and the teambuilder subset being
 * a genuine subset rather than a parallel list.
 *
 * Dex-free and hermetic. The curated tables' agreement with the Champions dex
 * is the separate taxonomy-rot gate in scripts/test-evaluator.ts, which needs
 * the dex loaded.
 */
import {
  CATEGORY_IDS, CATEGORY_META, CATEGORY_LABELS,
  DISPLAY_GROUPS, TEAMBUILDER_CATEGORIES,
  SUPPORT_CATEGORIES, POSITIONING_CATEGORIES,
  displayGroupFor, displayGroupLabel, validateCurated,
  EXPECTED_CURATED_DROPS,
  SPEED_ABILITIES, OPTION_ABILITIES, HEALING_ITEMS,
} from '../lib/effects';
import {
  CATEGORY_LABELS as TB_LABELS,
  DISPLAY_GROUPS as TB_GROUPS,
  displayGroupFor as tbDisplayGroupFor,
} from '../lib/teambuilder/types';
import type {EffectCategory} from '../lib/effects';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const section = (s: string) => console.log(`\n${s}\n`);

// ---------------------------------------------------------------------------
section('Categories');

check('ten categories, no duplicates',
  CATEGORY_IDS.length === 10 && new Set(CATEGORY_IDS).size === 10,
  CATEGORY_IDS.join(', '));
check('every category has a label and a description',
  CATEGORY_META.every((c) => c.label.length > 0 && c.description.length > 0));
check('labels are derived from the metadata, not listed twice',
  CATEGORY_IDS.every((id) => CATEGORY_LABELS[id] === CATEGORY_META.find((c) => c.id === id)!.label));

// ---------------------------------------------------------------------------
section('Display grouping');

check('five display groups, no duplicate ids',
  DISPLAY_GROUPS.length === 5 && new Set(DISPLAY_GROUPS.map((g) => g.id)).size === 5,
  DISPLAY_GROUPS.map((g) => g.id).join(', '));

const grouped = DISPLAY_GROUPS.flatMap((g) => g.sources);
check('every category belongs to a display group',
  CATEGORY_IDS.every((id) => grouped.includes(id)),
  CATEGORY_IDS.filter((id) => !grouped.includes(id)).join(', ') || 'all covered');
check('no category belongs to two display groups',
  grouped.length === new Set(grouped).size,
  `${grouped.length} sources, ${new Set(grouped).size} distinct`);
check('display groups reference no category that does not exist',
  grouped.every((c) => CATEGORY_IDS.includes(c)));
check('displayGroupFor resolves every category',
  CATEGORY_IDS.every((id) => typeof displayGroupFor(id) === 'string'));
check('displayGroupFor throws on an unknown category rather than guessing',
  (() => {
    try { displayGroupFor('nonsense' as EffectCategory); return false; } catch { return true; }
  })(),
  'a silent fallback is how the two copies disagreed without anyone noticing');
check('displayGroupLabel matches the group table',
  DISPLAY_GROUPS.every((g) => displayGroupLabel(g.id) === g.label));

// The one case where the row is not a pure function of the category (D38.3),
// and the one the teambuilder's hand-mirrored copy had lost.
check('Wide/Quick Guard display as Protects, not Option control',
  displayGroupFor('option', 'guards') === 'protect');
check('option control otherwise stays in Option control',
  displayGroupFor('option', 'Encore-class') === 'option' &&
    displayGroupFor('option', 'abilities') === 'option' &&
    displayGroupFor('option') === 'option');
check('the guards rule does not leak into other categories',
  displayGroupFor('mitigation', 'guards') === 'defense' &&
    displayGroupFor('protect', 'guards') === 'protect');

// ---------------------------------------------------------------------------
section('Teambuilder subset');

check('the teambuilder set is a subset of the full taxonomy',
  TEAMBUILDER_CATEGORIES.every((c) => CATEGORY_IDS.includes(c)),
  `${TEAMBUILDER_CATEGORIES.length} of ${CATEGORY_IDS.length}`);
check('priority is the only category the teambuilder omits',
  CATEGORY_IDS.filter((c) => !TEAMBUILDER_CATEGORIES.includes(c)).join(',') === 'priority',
  'damage priority is already inside a Pokémon’s matchup numbers');
check('support and positioning categories are all real',
  [...SUPPORT_CATEGORIES, ...POSITIONING_CATEGORIES].every((c) => CATEGORY_IDS.includes(c)));
check('support and positioning overlap only on mitigation and weather',
  SUPPORT_CATEGORIES.filter((c) => POSITIONING_CATEGORIES.includes(c)).sort().join(',')
    === 'mitigation,weather',
  'both are conditions in their own right and cut a teammate’s entry cost');
check('every teambuilder category is reachable from support or positioning',
  TEAMBUILDER_CATEGORIES.every(
    (c) => SUPPORT_CATEGORIES.includes(c) || POSITIONING_CATEGORIES.includes(c)),
  TEAMBUILDER_CATEGORIES.filter(
    (c) => !SUPPORT_CATEGORIES.includes(c) && !POSITIONING_CATEGORIES.includes(c)).join(', ')
    || 'all reachable');

// ---------------------------------------------------------------------------
section('One taxonomy, not two');

// lib/teambuilder/types.ts re-exports rather than redefining. These assert
// identity, not equality — a future copy-paste would fail here.
check('the teambuilder re-exports the shared labels',
  TB_LABELS === CATEGORY_LABELS, 'same object, not a copy');
check('the teambuilder re-exports the shared display groups',
  TB_GROUPS === DISPLAY_GROUPS, 'same object, not a copy');
check('the teambuilder re-exports the shared grouping function',
  tbDisplayGroupFor === displayGroupFor &&
    tbDisplayGroupFor('option', 'guards') === 'protect',
  'and therefore inherits the Wide/Quick Guard rule it used to lack');

// ---------------------------------------------------------------------------
section('Curated tables');

const allCurated = [
  ...SPEED_ABILITIES.map((a) => a.name),
  ...OPTION_ABILITIES.map((a) => a.name),
  ...HEALING_ITEMS.map((i) => i.name),
];
check('curated entries carry names', allCurated.every((n) => n.length > 0));
check('no duplicate names within a curated table',
  new Set(SPEED_ABILITIES.map((a) => a.name)).size === SPEED_ABILITIES.length &&
    new Set(OPTION_ABILITIES.map((a) => a.name)).size === OPTION_ABILITIES.length &&
    new Set(HEALING_ITEMS.map((i) => i.name)).size === HEALING_ITEMS.length);
check('Prankster is not speed control (D36)',
  !SPEED_ABILITIES.some((a) => a.name === 'Prankster'),
  'status-move priority is not board-level speed control');

// validateCurated is dex-shaped but dex-free to test: feed it lookups.
check('validateCurated reports everything against an empty dex',
  validateCurated({hasAbility: () => false, hasMove: () => false, hasItem: () => false}).length > 0);
check('validateCurated reports nothing against a complete dex',
  validateCurated({hasAbility: () => true, hasMove: () => true, hasItem: () => true}).length === 0);
check('the expected-drops list is sorted and deduped',
  JSON.stringify(EXPECTED_CURATED_DROPS) === JSON.stringify([...new Set(EXPECTED_CURATED_DROPS)].sort()),
  `${EXPECTED_CURATED_DROPS.length} entries`);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILURES`}`);
process.exit(failures > 0 ? 1 : 0);

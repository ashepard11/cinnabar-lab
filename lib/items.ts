/**
 * Item bucketing: Mega Stones, damage-boosting items, and everything else.
 */
import {MEGA_STONES} from '@smogon/calc';

/**
 * Damage-boosting item allowlist (spec: "the Reg M-A allowlist ... this is the
 * standard set"). Each of these gets its own variant bucket when it clears the
 * usage threshold.
 */
export const DAMAGE_BOOSTING_ITEMS = new Set<string>([
  'Life Orb',
  'Choice Band',
  'Choice Specs',
  'Expert Belt',
  'Muscle Band',
  'Wise Glasses',
  // Type-boosting items
  'Charcoal',
  'Mystic Water',
  'Miracle Seed',
  'Magnet',
  'Soft Sand',
  'Sharp Beak',
  'Poison Barb',
  'Silver Powder',
  'Spell Tag',
  'Twisted Spoon',
  'Black Belt',
  'Black Glasses',
  'Metal Coat',
  'Hard Stone',
  'Never-Melt Ice',
  'Dragon Fang',
  'Pixie Plate',
  'Silk Scarf',
]);

/**
 * If `item` is a Mega Stone usable by `species`, return the Mega forme's
 * species name (e.g. ("Charizardite Y", "Charizard") → "Charizard-Mega-Y").
 * Returns null for non-stones AND for stones that don't match the holder
 * (mis-recorded data like Staraptor holding Skarmorite — such a stone does
 * nothing and is treated as a non-damage-boosting item).
 */
export function megaSpeciesFor(item: string, species: string): string | null {
  const mapping = (MEGA_STONES as Record<string, Record<string, string>>)[item];
  return mapping?.[species] ?? null;
}

export function isMegaStone(item: string): boolean {
  return item in (MEGA_STONES as Record<string, unknown>);
}

export function isDamageBoostingItem(item: string): boolean {
  return DAMAGE_BOOSTING_ITEMS.has(item);
}

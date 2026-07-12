/**
 * lib/variant-cid.ts — content-addressed variant IDs (BACKLOG item 02).
 *
 * A variant's cid is a hash of its *resolved battle set* — exactly the fields
 * variantToSet feeds the simulator (species, item, ability, nature, level,
 * SP spread, IVs, and the resolved top-4 moveset) — so two variants with the
 * same cid are battle-identical by construction, and usage-weight drift,
 * move-usage reordering within the same top 4, or slug renames do not change
 * it. The human-readable `Variant.id` slug remains the display/URL name;
 * matchup rows and caches key on cids (see scripts/build-matchups.ts).
 */
import { createHash } from 'node:crypto';
import { variantToSet } from './sim/sets';
import type { Variant, StatsTable } from './types';

/** Fixed key order so JSON.stringify is canonical. */
function canonicalStats(s: StatsTable) {
  return { hp: s.hp, atk: s.atk, def: s.def, spa: s.spa, spd: s.spd, spe: s.spe };
}

/**
 * The canonical spec that gets hashed. Exported so tests (and later the
 * custom-set pipeline, BACKLOG item 05) can inspect what identity means.
 */
export function canonicalSpec(variant: Variant) {
  const s = variantToSet(variant);
  return {
    species: s.species,
    item: s.item || null,
    ability: s.ability,
    nature: s.nature,
    level: s.level,
    sps: canonicalStats(s.evs),   // champions SP, carried in SimSet.evs (D2/D20)
    ivs: canonicalStats(s.ivs),
    moves: [...s.moves].sort(),   // order never affects battle mechanics
  };
}

/** 64-bit hex content id, e.g. "3f9a0c2d1b4e8a71". */
export function variantCid(variant: Variant): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalSpec(variant)))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Variant selection: convert scraped per-Pokémon usage into the list of
 * attacker/defender variants used by both visualizations (and, later, by the
 * battle-sim project — keep this file free of viz-specific coupling).
 *
 * Algorithm (SPEC-damageviz.md Phase 2):
 * 1. Bucket every item: each Mega Stone → its own bucket; each damage-boosting
 *    item → its own bucket; everything else (incl. unlisted long-tail mass) →
 *    one aggregate "no item" bucket.
 * 2. Include every Mega bucket regardless of weight; include any other bucket
 *    with usage(P) × within_share ≥ 1%; if nothing qualifies, fall back to the
 *    modal bucket.
 */
import {GEN, canonicalSpecies, toID} from './pokemon';
import {isDamageBoostingItem, megaSpeciesFor} from './items';
import type {PokemonSpec, PokemonUsage, StatsTable, Variant} from './types';

export const USAGE_PRODUCT_THRESHOLD = 0.01;

/**
 * The synthetic defender for viz 1: base 100 HP / 80 defenses, no investment,
 * neutral nature, no item, inert ability (defined here per the spec so every
 * consumer uses the same target).
 *
 * Typing is `???` — neutral to every attack type. The spec leaves the target's
 * typing unspecified; any real typing would zero out a whole column via
 * immunity (e.g. a Normal-typed target takes 0 from all Ghost moves, erasing
 * Sinistcha's 31%-usage STAB from viz 1). See DECISIONS.md D15.
 */
export const STANDARD_TARGET: PokemonSpec = {
  // Stand-in body; stats and typing fully overridden. Must be a species that
  // exists in the Champions dex (Mew, for example, is not in it).
  species: 'Snorlax',
  nature: 'Hardy',
  sps: {},
  ability: 'Insomnia',
  overrides: {
    baseStats: {hp: 100, atk: 80, def: 80, spa: 80, spd: 80, spe: 80},
    types: ['???'],
  },
};

interface Bucket {
  /** "no item", or the item name (Mega Stone / damage-boosting item). */
  name: string;
  /** Within-Pokémon usage share, 0–1. */
  share: number;
  /** Mega species name when this bucket is a matching Mega Stone. */
  megaSpecies: string | null;
}

/**
 * Bucket a Pokémon's items. Truncated long-tail mass (the API lists only the
 * top items; sums run 72–100%) is added to the "no item" bucket — every
 * unlisted item is individually rarer than the rarest listed one, so treating
 * the residual as non-damage-boosting cannot hide a bucket that would have
 * cleared the 1% product threshold.
 */
export function bucketItems(p: PokemonUsage): Bucket[] {
  const species = canonicalSpecies(p.name);
  const buckets: Bucket[] = [];
  let noItemShare = 0;
  let listedTotal = 0;

  for (const item of p.items) {
    listedTotal += item.usage;
    const mega = megaSpeciesFor(item.name, species);
    if (mega) {
      buckets.push({name: item.name, share: item.usage, megaSpecies: mega});
    } else if (isDamageBoostingItem(item.name)) {
      buckets.push({name: item.name, share: item.usage, megaSpecies: null});
    } else {
      noItemShare += item.usage;
    }
  }

  noItemShare += Math.max(0, 1 - listedTotal); // unlisted long tail
  buckets.push({name: 'no item', share: noItemShare, megaSpecies: null});
  return buckets;
}

/** Default spread fallback: max SP in the larger attacking stat + matching positive nature. */
function defaultSpread(species: string): {sps: StatsTable; nature: string} {
  const data = GEN.species.get(toID(species))!;
  const physical = data.baseStats.atk >= data.baseStats.spa;
  return {
    sps: {hp: 0, atk: physical ? 32 : 0, def: 0, spa: physical ? 0 : 32, spd: 0, spe: 0},
    nature: physical ? 'Adamant' : 'Modest',
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function variantId(species: string, bucketName: string): string {
  return `${slug(species)}_${bucketName === 'no item' ? 'no_item' : slug(bucketName)}`;
}

function buildVariant(p: PokemonUsage, bucket: Bucket): Variant {
  const baseSpecies = canonicalSpecies(p.name);
  const isMega = bucket.megaSpecies !== null;
  const species = isMega ? bucket.megaSpecies! : baseSpecies;

  // Modal ability; for Megas, the Mega forme's own ability replaces it.
  let ability: string;
  if (isMega) {
    const megaData = GEN.species.get(toID(species));
    ability = (megaData?.abilities as {0?: string} | undefined)?.[0] ?? p.modal_set?.ability ?? '';
  } else {
    ability = p.modal_set?.ability ?? p.abilities[0]?.name ?? '';
  }

  // Modal spread + nature; Pikalytics has no Mega-specific spreads, so Megas
  // inherit the base form's modal spread (spec: "close enough").
  let sps = p.modal_set?.sps ?? null;
  let nature = p.modal_set?.nature ?? 'Hardy';
  if (!sps) {
    const fallback = defaultSpread(species);
    sps = fallback.sps;
    nature = fallback.nature;
  }

  // The Mega variant is keyed by its Mega species (which already implies the
  // stone), so the variant id comes from the species name for Megas
  // (e.g. "charizard_mega_y").
  return {
    id: isMega ? slug(species) : variantId(baseSpecies, bucket.name),
    species,
    is_mega: isMega,
    ...(isMega ? {mega_stone: bucket.name} : {}),
    item: bucket.name === 'no item' ? null : bucket.name,
    ability,
    nature,
    sps,
    weight: p.usage * bucket.share,
    moves: p.moves,
  };
}

/** Select the variants for one Pokémon per the spec's algorithm. */
export function selectVariants(p: PokemonUsage): Variant[] {
  const buckets = bucketItems(p);
  const variants: Variant[] = [];

  for (const bucket of buckets) {
    if (bucket.megaSpecies) {
      variants.push(buildVariant(p, bucket)); // Megas always included
    } else if (p.usage * bucket.share >= USAGE_PRODUCT_THRESHOLD) {
      variants.push(buildVariant(p, bucket));
    }
  }

  if (variants.length === 0) {
    const modal = buckets.reduce((a, b) => (b.share > a.share ? b : a));
    variants.push(buildVariant(p, modal));
  }

  return variants;
}

/** Build the full variant list for the metagame. */
export function buildAllVariants(pokemon: PokemonUsage[]): Variant[] {
  return pokemon.flatMap((p) => selectVariants(p));
}

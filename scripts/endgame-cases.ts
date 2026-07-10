/**
 * scripts/endgame-cases.ts — known-hard 1v1 endgame test cases (BACKLOG item 01).
 *
 * Each case pits a setup/stall Pokémon (side A, the expected winner under
 * correct play) against an opponent whose counterplay the current policy must
 * navigate. Expected outcomes are damage-math consensus judgments, documented
 * per-case in `rationale` and reviewed in DECISIONS.md — they describe optimal
 * play, NOT what the current policy achieves. The suite reports the delta.
 *
 * Every side is a frozen synthetic Variant (some copied from
 * data/defender-variants.json as of 2026-07-09) so that weekly metagame data
 * refreshes cannot silently change what this suite measures. Cresselia is not
 * in the Champions dex (nonstandard: Past) but the engine simulates off-dex
 * species fine — same precedent as sim-sanity's synthetic Amoonguss.
 *
 * SP budget: 66 total, max 32 per stat (matches all real variants).
 */
import type { Variant } from '../lib/types';

function syn(
  id: string, species: string, ability: string, nature: string,
  item: string | null, sps: Variant['sps'], moves: string[],
): Variant {
  return {
    id, species, is_mega: false, item, ability, nature, sps, weight: 0,
    // Descending synthetic usage so pickMoves keeps exactly this order.
    moves: moves.map((name, i) => ({ name, usage: 1 - i * 0.05 })),
  };
}

/* ---------------------------- setup attackers ---------------------------- */

const AZUMARILL = syn('azumarill_bd_sitrus', 'Azumarill', 'Huge Power', 'Adamant',
  'Sitrus Berry', { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 },
  ['Belly Drum', 'Aqua Jet', 'Play Rough', 'Protect']);

const CERULEDGE = syn('ceruledge_bulkup', 'Ceruledge', 'Flash Fire', 'Adamant',
  'Leftovers', { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 },
  ['Bulk Up', 'Bitter Blade', 'Shadow Sneak', 'Protect']);

const GYARADOS = syn('gyarados_dd', 'Gyarados', 'Intimidate', 'Adamant',
  'Leftovers', { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  ['Dragon Dance', 'Waterfall', 'Crunch', 'Protect']);

const SNORLAX = syn('snorlax_curse', 'Snorlax', 'Thick Fat', 'Careful',
  'Leftovers', { hp: 32, atk: 0, def: 14, spa: 0, spd: 20, spe: 0 },
  ['Curse', 'Body Slam', 'Rest', 'Protect']);

// Off-dex (nonstandard: Past) — named by BACKLOG item 01; engine runs it fine.
const CRESSELIA = syn('cresselia_cm', 'Cresselia', 'Levitate', 'Bold',
  'Leftovers', { hp: 32, atk: 0, def: 22, spa: 0, spd: 12, spe: 0 },
  ['Calm Mind', 'Stored Power', 'Moonblast', 'Moonlight']);

const ANNIHILAPE = syn('annihilape_bulkup', 'Annihilape', 'Vital Spirit', 'Adamant',
  'Leftovers', { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 },
  ['Bulk Up', 'Drain Punch', 'Rage Fist', 'Protect']);

const DRAGONITE = syn('dragonite_dd', 'Dragonite', 'Multiscale', 'Adamant',
  'Leftovers', { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  ['Dragon Dance', 'Extreme Speed', 'Earthquake', 'Roost']);

/* ------------------------------ stall walls ------------------------------ */

const TOXAPEX_ID_REST = syn('toxapex_idrest', 'Toxapex', 'Regenerator', 'Bold',
  'Leftovers', { hp: 32, atk: 0, def: 20, spa: 0, spd: 14, spe: 0 },
  ['Iron Defense', 'Rest', 'Surf', 'Sludge Bomb']);

const TOXAPEX_HAZE = syn('toxapex_haze', 'Toxapex', 'Regenerator', 'Bold',
  'Leftovers', { hp: 32, atk: 0, def: 20, spa: 0, spd: 14, spe: 0 },
  ['Haze', 'Rest', 'Sludge Bomb', 'Surf']);

/* -------------------------------- opponents ------------------------------ */
// Frozen copies of data/defender-variants.json sets (2026-07-09).

const GARCHOMP = syn('garchomp_frozen', 'Garchomp', 'Rough Skin', 'Jolly',
  null, { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  ['Dragon Claw', 'Rock Slide', 'Earthquake', 'Protect']);

const INCINEROAR = syn('incineroar_frozen', 'Incineroar', 'Intimidate', 'Careful',
  null, { hp: 32, atk: 0, def: 14, spa: 0, spd: 20, spe: 0 },
  ['Fake Out', 'Parting Shot', 'Flare Blitz', 'Throat Chop']);

const ROTOM_WASH = syn('rotom_wash_frozen', 'Rotom-Wash', 'Levitate', 'Modest',
  null, { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
  ['Hydro Pump', 'Will-O-Wisp', 'Thunderbolt', 'Protect']);

const SNEASLER = syn('sneasler_frozen', 'Sneasler', 'Unburden', 'Jolly',
  null, { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  ['Close Combat', 'Fake Out', 'Dire Claw', 'Protect']);

const KINGAMBIT = syn('kingambit_frozen', 'Kingambit', 'Defiant', 'Adamant',
  'Black Glasses', { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 },
  ['Sucker Punch', 'Kowtow Cleave', 'Iron Head', 'Protect']);

// Copy of sim-sanity's synthetic (below the scrape's usage cutoff; off-dex).
const AMOONGUSS = syn('amoonguss_frozen', 'Amoonguss', 'Regenerator', 'Calm',
  null, { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0 },
  ['Spore', 'Pollen Puff', 'Giga Drain', 'Protect']);

/* ----------------------- purpose-built synthetic foes --------------------- */

const CORVIKNIGHT = syn('corviknight_wall', 'Corviknight', 'Pressure', 'Impish',
  'Leftovers', { hp: 32, atk: 0, def: 20, spa: 0, spd: 14, spe: 0 },
  ['Body Press', 'Iron Defense', 'Roost', 'Brave Bird']);

const SYLVEON_CM = syn('sylveon_cm', 'Sylveon', 'Pixilate', 'Modest',
  'Leftovers', { hp: 32, atk: 0, def: 2, spa: 32, spd: 0, spe: 0 },
  ['Calm Mind', 'Hyper Voice', 'Draining Kiss', 'Protect']);

/* --------------------------------- cases --------------------------------- */

export interface EndgameCase {
  id: string;
  /** Short human-readable matchup name. */
  label: string;
  side_A: Variant;
  side_B: Variant;
  /** Consensus: under correct play, P(A wins) should be at least this. */
  expected_p_min: number;
  /** Damage-math justification for the consensus verdict. */
  rationale: string;
}

export const ENDGAME_CASES: EndgameCase[] = [
  {
    id: 'bd-azumarill-vs-garchomp',
    label: 'Belly Drum Azumarill vs Garchomp',
    side_A: AZUMARILL, side_B: GARCHOMP, expected_p_min: 0.85,
    rationale:
      'Chomp cannot OHKO 32 HP Azumarill; after Belly Drum, Sitrus restores 25% ' +
      'and +6 Huge Power Aqua Jet (priority) KOs Garchomp before any second hit. ' +
      'The line is BD turn 1, Aqua Jet turn 2 — two-turn horizon, near-deterministic.',
  },
  {
    id: 'bd-azumarill-vs-incineroar',
    label: 'Belly Drum Azumarill vs Incineroar',
    side_A: AZUMARILL, side_B: INCINEROAR, expected_p_min: 0.85,
    rationale:
      'Belly Drum sets Atk to +6 regardless of Intimidate. Incineroar chips with ' +
      'Fake Out/Throat Chop but resists nothing Azumarill throws; +6 water STAB is ' +
      'super-effective and Incineroar has no recovery.',
  },
  {
    id: 'bulkup-ceruledge-vs-amoonguss',
    label: 'Bulk Up Ceruledge vs Amoonguss',
    side_A: CERULEDGE, side_B: AMOONGUSS, expected_p_min: 0.85,
    rationale:
      'Amoonguss cannot hurt Ceruledge (Pollen Puff 4x resisted, Giga Drain 2x ' +
      'resisted) while Bitter Blade is super-effective and heals. Spore delays but ' +
      'cannot win; correct play attacks through sleep turns and never loses.',
  },
  {
    id: 'bulkup-ceruledge-vs-corviknight',
    label: 'Bulk Up Ceruledge vs Iron Defense Corviknight',
    side_A: CERULEDGE, side_B: CORVIKNIGHT, expected_p_min: 0.85,
    rationale:
      'Body Press is Fighting — Ceruledge is immune; Corviknight only damages with ' +
      'Brave Bird (neutral, recoil). Bulk Up + super-effective Bitter Blade healing ' +
      'out-sustains Roost stalling. Long-horizon: win needs many boost/attack turns.',
  },
  {
    id: 'dd-gyarados-vs-incineroar',
    label: 'Dragon Dance Gyarados vs Incineroar',
    side_A: GYARADOS, side_B: INCINEROAR, expected_p_min: 0.80,
    rationale:
      'Mutual Intimidate; Gyarados restores its Atk with Dragon Dance and Waterfall ' +
      'is super-effective. Incineroar has no recovery and Throat Chop is neutral ' +
      'chip; boosted Gyarados closes before Flare Blitz volume matters.',
  },
  {
    id: 'curse-snorlax-vs-rotom-wash',
    label: 'Curse + Rest Snorlax vs Rotom-Wash',
    side_A: SNORLAX, side_B: ROTOM_WASH, expected_p_min: 0.80,
    rationale:
      'Observed numbers: Thunderbolt does ~23%/turn while a Rest loop restores ' +
      '~33%/turn net — Snorlax is indefinitely sustainable, holds a decisive PP ' +
      'advantage (Rotom has ~50 attacking turns and no recovery), and closes with ' +
      'Curse-boosted Body Slam (30% paralysis). Crit streams during sleep are ' +
      'Rotom\'s main out.',
  },
  {
    id: 'cm-cresselia-vs-rotom-wash',
    label: 'Calm Mind Cresselia vs Rotom-Wash',
    side_A: CRESSELIA, side_B: ROTOM_WASH, expected_p_min: 0.85,
    rationale:
      'Cresselia out-bulks Rotom trivially; Calm Mind raises SpD past Hydro Pump ' +
      'while Moonlight + Leftovers out-heal chip, and boosted Stored Power ends it. ' +
      'Burn is irrelevant to a special attacker. Rotom has no recovery.',
  },
  {
    id: 'idrest-toxapex-vs-sneasler',
    label: 'Iron Defense + Rest Toxapex vs Sneasler',
    side_A: TOXAPEX_ID_REST, side_B: SNEASLER, expected_p_min: 0.85,
    rationale:
      'Toxapex resists both Sneasler STABs (Close Combat, Dire Claw); Iron Defense ' +
      'plus Rest makes physical chip unwinnable. Surf/Sludge Bomb whittle a mon with ' +
      'no recovery. Dire Claw status rolls are the only variance.',
  },
  {
    // NOT vs Garchomp: in Champions math its Earthquake does ~69% per hit to
    // this Toxapex (observed), so even optimal Iron Defense/Rest sequencing
    // loses — Gen-9 wall intuition does not transfer (same lesson as D24).
    id: 'idrest-toxapex-vs-incineroar',
    label: 'Iron Defense + Rest Toxapex vs Incineroar',
    side_A: TOXAPEX_ID_REST, side_B: INCINEROAR, expected_p_min: 0.85,
    rationale:
      'Uninvested Incineroar chips with resisted Flare Blitz (plus recoil) and ' +
      'neutral Throat Chop; Iron Defense + Rest makes that unwinnable while ' +
      'super-effective Surf whittles a mon with no recovery.',
  },
  {
    id: 'haze-toxapex-vs-cm-sylveon',
    label: 'Haze Toxapex vs Calm Mind Sylveon',
    side_A: TOXAPEX_HAZE, side_B: SYLVEON_CM, expected_p_min: 0.70,
    rationale:
      'Anti-setup check. Observed numbers: unboosted resisted Hyper Voice ~22%, ' +
      'at +2 already ~40% — Toxapex must Haze on every boost cycle, then grind ' +
      'out super-effective Sludge Bomb (~17% + 12.5%/turn poison) against ' +
      'Leftovers + weak resisted Draining Kiss. Optimal play wins the long game; ' +
      'floor 0.70 allows early-burst/crit variance.',
  },
  {
    id: 'bulkup-annihilape-vs-incineroar',
    label: 'Bulk Up Annihilape vs Incineroar',
    side_A: ANNIHILAPE, side_B: INCINEROAR, expected_p_min: 0.80,
    rationale:
      'Intimidate starts Annihilape at -1 but Bulk Up recovers it; Drain Punch is ' +
      'super-effective and heals, and Rage Fist grows as Incineroar chips. Throat ' +
      'Chop (2x vs Ghost, 0.5x vs Fighting) is net neutral. No Incineroar recovery.',
  },
  {
    id: 'dd-dragonite-vs-kingambit',
    label: 'Dragon Dance Dragonite vs Kingambit',
    side_A: DRAGONITE, side_B: KINGAMBIT, expected_p_min: 0.55,
    rationale:
      'Priority mind-game endgame: Sucker Punch fails against Dragon Dance/Roost, ' +
      'Extreme Speed out-prioritizes it, Multiscale buffers the first hit, and ' +
      'Earthquake is 2x. Dragonite is favored under correct play but Kowtow Cleave ' +
      'pressure keeps it close — floor set at 0.55, band verified empirically.',
  },
];

/**
 * src/lib/teamToSets.ts — turn a team under construction into the shape the
 * team evaluator's components already consume.
 *
 * SPEC-teambuilder.md says the teambuilder's team detail should embed the
 * evaluator's panels rather than build parallel ones, and BACKLOG item 08 says
 * the same from the other side. That only works if the two speak the same
 * type, so this converts rather than reimplementing: `ParsedSet` is what
 * `lib/evaluator/*` takes, and every evaluator section works unchanged once a
 * team is expressed in it.
 */
import type {ParsedSet} from '../../lib/evaluator/parse';
import type {PresetSet} from '../../lib/teambuilder/types';
import type {StatsTable} from '../../lib/types';

/**
 * Champions has no IVs — every Pokémon has perfect stats and they cannot be
 * lowered. `ParsedSet` carries the field because it also parses Showdown
 * pastes from other formats, so it is filled with the only value Champions
 * ever has.
 */
const PERFECT_IVS: StatsTable = {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};

const ZERO: StatsTable = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};

export interface TeamMember {
  species: string;
  /** Mega forme name when the set holds the stone, else the base species. */
  battleSpecies?: string;
  isMega?: boolean;
  set: PresetSet;
}

export function memberToParsedSet(member: TeamMember): ParsedSet {
  const {set} = member;
  return {
    species: member.species,
    battleSpecies: member.battleSpecies ?? member.species,
    isMega: member.isMega ?? false,
    item: set.item,
    ability: set.ability,
    nature: set.nature,
    sps: {...ZERO, ...set.sps},
    ivs: PERFECT_IVS,
    moves: set.moves.filter(Boolean),
    invalidMoves: [],
    warnings: [],
  };
}

export function teamToParsedSets(team: TeamMember[]): ParsedSet[] {
  return team.map(memberToParsedSet);
}

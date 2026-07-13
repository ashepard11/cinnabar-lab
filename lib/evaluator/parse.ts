/**
 * lib/evaluator/parse.ts — Showdown export-format team parser for the team
 * evaluator (SPEC-team-evaluator.md Phase 1).
 *
 * Hand-rolled for the browser (the vendored pokemon-showdown Teams.import is
 * Node-oriented and never shipped); scripts/test-evaluator.ts asserts
 * field-level parity against Teams.import on fixture pastes, keeping the
 * vendored parser as the semantics oracle.
 *
 * Champions notes: pasted EVs convert to SP via evsToSps (lib/sp.ts); levels,
 * genders, shininess, happiness, Tera lines are accepted and discarded (level
 * is cosmetic in Champions). A held Mega Stone matching the species resolves
 * the set to the mega forme, mirroring the variant builder.
 */
import {evsToSps} from '../sp';
import {getMove, getSpecies, megaFormeFor, toID} from './dex';
import type {EvaluatorDex} from './dex';
import type {StatID, StatsTable} from '../types';

/** One successfully parsed set. Fields are canonical dex display names. */
export interface ParsedSet {
  species: string;
  /** Mega forme name when the held stone matches, else === species. */
  battleSpecies: string;
  isMega: boolean;
  item: string | null;
  ability: string;
  nature: string;
  /** Champions SP (0–32 per stat), converted from pasted EVs. */
  sps: StatsTable;
  ivs: StatsTable;
  /** Dex-valid moves only (1–4); unknown moves land in `invalidMoves`. */
  moves: string[];
  invalidMoves: string[];
  /** Human-readable validation notes for the roster UI. */
  warnings: string[];
}

/** A paste block that could not become a set (unknown species, no species). */
export interface ParseFailure {
  raw: string;
  message: string;
}

export interface ParsedTeam {
  sets: ParsedSet[];
  failures: ParseFailure[];
}

const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_ALIASES: Record<string, StatID> = {
  hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe',
  attack: 'atk', defense: 'def', spatk: 'spa', spdef: 'spd', speed: 'spe',
  spattack: 'spa', spdefense: 'spd', spczatk: 'spa',
  'sp.atk': 'spa', 'sp.def': 'spd', 'sp.atk.': 'spa', 'sp.def.': 'spd',
};

function statsTable(fill: number, partial: Partial<StatsTable> = {}): StatsTable {
  const out = {hp: fill, atk: fill, def: fill, spa: fill, spd: fill, spe: fill};
  for (const k of STAT_IDS) if (partial[k] !== undefined) out[k] = partial[k]!;
  return out;
}

/** Parse an "EVs: 4 HP / 252 Atk" style line into a partial stat table. */
function parseStatLine(rest: string): Partial<StatsTable> {
  const out: Partial<StatsTable> = {};
  for (const part of rest.split('/')) {
    const m = part.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const stat = STAT_ALIASES[m[2].trim().toLowerCase().replace(/\s+/g, '')];
    if (stat) out[stat] = Number(m[1]);
  }
  return out;
}

/**
 * Parse the header line: "Nickname (Species) (M) @ Item" and simpler forms.
 * Returns raw species/item strings (not yet dex-validated).
 */
export function parseHeaderLine(line: string): {species: string; item: string | null} {
  let head = line;
  let item: string | null = null;
  const at = head.indexOf('@');
  if (at >= 0) {
    item = head.slice(at + 1).trim() || null;
    head = head.slice(0, at).trim();
  }
  // strip trailing gender marker
  head = head.replace(/\s*\((M|F)\)\s*$/i, '').trim();
  // nickname form: "Nickname (Species)" — take the LAST parenthesized group
  const nick = head.match(/^.*\(([^()]+)\)\s*$/);
  if (nick) head = nick[1].trim();
  return {species: head, item};
}

/** Split a paste into per-Pokémon blocks on blank lines. */
function splitBlocks(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function parseBlock(block: string, dex: EvaluatorDex): ParsedSet | ParseFailure {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const header = parseHeaderLine(lines[0]);
  if (!header.species) return {raw: block, message: 'no species on the first line'};

  const spec = getSpecies(dex, header.species);
  if (!spec) return {raw: block, message: `unknown species "${header.species}" (not in the Champions dex)`};

  const warnings: string[] = [];
  let item: string | null = null;
  if (header.item) {
    const id = toID(header.item);
    if (id in dex.items) {
      item = dex.items[id];
    } else {
      warnings.push(`unknown item "${header.item}" — treated as no item`);
    }
  }

  let ability = '';
  let nature = '';
  let evs: Partial<StatsTable> = {};
  let ivs: Partial<StatsTable> = {};
  const moves: string[] = [];
  const invalidMoves: string[] = [];

  for (const line of lines.slice(1)) {
    if (line.startsWith('-')) {
      const raw = line.slice(1).trim();
      if (!raw) continue;
      const move = getMove(dex, raw);
      if (move && moves.length < 4 && !moves.includes(move.name)) {
        moves.push(move.name);
      } else if (!move) {
        invalidMoves.push(raw);
        warnings.push(`unknown move "${raw}" — excluded from evaluation`);
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z .]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1].trim().toLowerCase();
      const rest = kv[2].trim();
      if (key === 'ability') ability = rest;
      else if (key === 'evs') evs = parseStatLine(rest);
      else if (key === 'ivs') ivs = parseStatLine(rest);
      else if (key === 'nature') nature = rest;
      // level / shiny / happiness / tera type / gender: accepted, discarded
      continue;
    }
    const natureLine = line.match(/^(\w+)\s+Nature\b/i);
    if (natureLine) nature = natureLine[1];
  }

  // A held Mega Stone resolves the battle forme; the Mega forme's own ability
  // replaces the pasted one, mirroring the variant builder (lib/variants.ts).
  const megaForme = megaFormeFor(dex, item, spec.name);
  const battleSpec = megaForme ? getSpecies(dex, megaForme) ?? spec : spec;

  if (megaForme && battleSpec.abilities.length) {
    ability = battleSpec.abilities[0];
  } else if (ability) {
    const id = toID(ability);
    if (id in dex.abilities) {
      ability = dex.abilities[id];
      if (battleSpec.abilities.length && !battleSpec.abilities.includes(ability)) {
        warnings.push(`${ability} is not a listed ability slot for ${battleSpec.name}`);
      }
    } else {
      warnings.push(`unknown ability "${ability}" — using ${battleSpec.abilities[0] ?? 'none'}`);
      ability = battleSpec.abilities[0] ?? '';
    }
  } else {
    ability = battleSpec.abilities[0] ?? '';
    if (ability) warnings.push(`no ability line — defaulting to ${ability}`);
  }

  if (nature) {
    const id = toID(nature);
    if (id in dex.natures) {
      nature = dex.natures[id].name;
    } else {
      warnings.push(`unknown nature "${nature}" — defaulting to Hardy`);
      nature = 'Hardy';
    }
  } else {
    nature = 'Hardy';
    warnings.push('no nature line — defaulting to Hardy (neutral)');
  }

  if (moves.length === 0) warnings.push('no valid moves — most sections need at least one');

  return {
    species: spec.name,
    battleSpecies: megaForme ?? spec.name,
    isMega: !!megaForme || spec.isMega,
    item,
    ability,
    nature,
    sps: statsTable(0, evsToSps(evs)),
    ivs: statsTable(31, ivs),
    moves,
    invalidMoves,
    warnings,
  };
}

/** Parse a full Showdown-format team paste. Accepts 1–6 blocks. */
export function parseTeam(text: string, dex: EvaluatorDex): ParsedTeam {
  const sets: ParsedSet[] = [];
  const failures: ParseFailure[] = [];
  for (const block of splitBlocks(text).slice(0, 6)) {
    const result = parseBlock(block, dex);
    if ('message' in result) failures.push(result);
    else sets.push(result);
  }
  return {sets, failures};
}

/** Re-emit a set in Showdown export format (SP shown as EVs × 8). */
export function exportSet(set: ParsedSet): string {
  const lines: string[] = [];
  lines.push(set.item ? `${set.species} @ ${set.item}` : set.species);
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  const evParts = STAT_IDS.filter((s) => set.sps[s] > 0)
    .map((s) => `${set.sps[s] * 8} ${({hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe'})[s]}`);
  if (evParts.length) lines.push(`EVs: ${evParts.join(' / ')}`);
  lines.push(`${set.nature} Nature`);
  for (const m of set.moves) lines.push(`- ${m}`);
  return lines.join('\n');
}

export function exportTeam(sets: ParsedSet[]): string {
  return sets.map(exportSet).join('\n\n');
}

// ---------------------------------------------------------------------------
// URL serialization: compact JSON → base64url for the ?team= query param.
// ---------------------------------------------------------------------------

type Packed = [string, string | null, string, string, number[], string[]];

// btoa/atob exist in every browser and in Node ≥ 16, so one code path serves
// both the app and the tsx test scripts.
function toBase64Url(s: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeTeam(sets: ParsedSet[]): string {
  const packed: Packed[] = sets.map((s) => [
    s.species, s.item, s.ability, s.nature, STAT_IDS.map((k) => s.sps[k]), s.moves,
  ]);
  return toBase64Url(JSON.stringify(packed));
}

/**
 * Decode a ?team= value back into sets, re-validating against the dex (a
 * stale URL survives dex refreshes: broken entries degrade with warnings,
 * exactly like a fresh paste).
 */
export function decodeTeam(encoded: string, dex: EvaluatorDex): ParsedTeam {
  let packed: Packed[];
  try {
    packed = JSON.parse(fromBase64Url(encoded)) as Packed[];
    if (!Array.isArray(packed)) throw new Error('not an array');
  } catch {
    return {sets: [], failures: [{raw: encoded, message: 'unreadable ?team= parameter'}]};
  }
  const text = packed.slice(0, 6).map(([species, item, ability, nature, sps, moves]) => {
    const lines = [item ? `${species} @ ${item}` : String(species)];
    if (ability) lines.push(`Ability: ${ability}`);
    const evLine = STAT_IDS
      .map((k, i) => ({k, v: Number(sps?.[i] ?? 0)}))
      .filter(({v}) => v > 0)
      .map(({k, v}) => `${v * 8} ${({hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe'})[k]}`);
    if (evLine.length) lines.push(`EVs: ${evLine.join(' / ')}`);
    if (nature) lines.push(`${nature} Nature`);
    for (const m of moves ?? []) lines.push(`- ${m}`);
    return lines.join('\n');
  }).join('\n\n');
  return parseTeam(text, dex);
}

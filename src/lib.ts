/**
 * Frontend-side shared helpers: canonical Pokémon type colors, data fetching,
 * formatting. (Kept separate from lib/ — that folder is the Node pipeline.)
 */

export interface Viz1Contributor {
  variant_id: string;
  species: string;
  move: string;
  expected_damage: number;
  share: number;
}
export interface Viz1Cell {
  type: string;
  category: 'Physical' | 'Special';
  share: number;
  contributors: Viz1Contributor[];
}
export interface Viz1Data {
  generated_at: string;
  cells: Viz1Cell[];
}

export interface Viz2Contributor {
  variant_id: string;
  species: string;
  damage: number;
  weighted_contribution: number;
}
export interface Viz2Cell {
  type: string;
  category: 'Physical' | 'Special';
  weighted_damage: number;
  relative: number;
  contributors: Viz2Contributor[];
}
export interface Viz2Data {
  generated_at: string;
  average_damage: number;
  cells: Viz2Cell[];
}

/** Canonical Pokémon type colors. */
export const TYPE_COLORS: Record<string, string> = {
  Normal: '#A8A77A',
  Fire: '#EE8130',
  Water: '#6390F0',
  Electric: '#F7D02C',
  Grass: '#7AC74C',
  Ice: '#96D9D6',
  Fighting: '#C22E28',
  Poison: '#A33EA1',
  Ground: '#E2BF65',
  Flying: '#A98FF3',
  Psychic: '#F95587',
  Bug: '#A6B91A',
  Rock: '#B6A136',
  Ghost: '#735797',
  Dragon: '#6F35FC',
  Dark: '#705746',
  Steel: '#B7B7CE',
  Fairy: '#D685AD',
};

/** Shade a hex color: amount < 0 darkens, > 0 lightens (toward white). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const r = ch((n >> 16) & 0xff);
  const g = ch((n >> 8) & 0xff);
  const b = ch(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Physical = darker shade, Special = lighter shade (spec Phase 5). */
export function cellColor(type: string, category: 'Physical' | 'Special'): string {
  const base = TYPE_COLORS[type] ?? '#888888';
  return category === 'Physical' ? shade(base, -0.25) : shade(base, 0.25);
}

/** Black or white text for contrast against a hex background. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  // Relative luminance (sRGB, linearized)
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.4 ? '#1a1a1a' : '#ffffff';
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

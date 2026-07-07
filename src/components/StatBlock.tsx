import type { VariantMeta } from '../lib/useVariants';

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;

/**
 * Client mirror of lib/sim/sets.ts EXCLUDED_MOVES (v1 scope): field-state
 * setters and ally-targeted moves the sim never clicks. Kept in sync by hand —
 * the Node source can't be imported into the browser bundle (it pulls in
 * pokemon-showdown). See DECISIONS.md.
 */
const EXCLUDED_MOVES = new Set(
  [
    'Sunny Day', 'Rain Dance', 'Sandstorm', 'Snowscape', 'Hail', 'Chilly Reception',
    'Electric Terrain', 'Grassy Terrain', 'Misty Terrain', 'Psychic Terrain',
    'Trick Room', 'Tailwind', 'Reflect', 'Light Screen', 'Aurora Veil', 'Safeguard',
    'Wide Guard', 'Quick Guard', 'Mist', 'Lucky Chant',
    'Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web',
    'Follow Me', 'Rage Powder', 'Ally Switch', 'Helping Hand', 'Coaching',
    'Aromatic Mist', 'Decorate', 'Instruct', 'Heal Pulse', 'Life Dew',
    'Beat Up',
  ].map((m) => m.toLowerCase()),
);

/** The exact moveset the sim uses: top-4 eligible moves by usage (pickMoves). */
export function simMoves(v: VariantMeta): Array<{ name: string; usage: number }> {
  return v.moves
    .filter((m) => !EXCLUDED_MOVES.has(m.name.toLowerCase()))
    .slice()
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 4);
}

/**
 * Compact set block — species@item, ability/nature, SP spread, and the exact
 * top-4 eligible moves the simulator plays. Shared by the matchup-detail page
 * ("Sets used") and the Pokémon detail page.
 */
export default function StatBlock({ v }: { v: VariantMeta }) {
  return (
    <div className="stat-block">
      <h3>{v.species}{v.item ? ` @ ${v.item}` : ''}</h3>
      <p>{v.ability} · {v.nature}</p>
      <table>
        <tbody>
          <tr>{STAT_KEYS.map((s) => <th key={s}>{s.toUpperCase()}</th>)}</tr>
          <tr>{STAT_KEYS.map((s) => <td key={s}>{v.sps[s] ?? 0}</td>)}</tr>
        </tbody>
      </table>
      <p className="stat-block-moves">
        {simMoves(v).map((m) => `${m.name} (${Math.round(m.usage * 100)}%)`).join(' · ')}
      </p>
    </div>
  );
}

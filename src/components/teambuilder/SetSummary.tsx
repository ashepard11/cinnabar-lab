import type {PresetSet} from '../../../lib/teambuilder/types';
import type {StatID} from '../../../lib/types';

const STATS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** "32 HP / 32 Atk / 2 SpD" — only the stats that carry investment. */
export function spreadSummary(sps: Partial<Record<StatID, number>>): string {
  const parts = STATS.filter((s) => (sps[s] ?? 0) > 0).map(
    (s) => `${sps[s]} ${s === 'hp' ? 'HP' : s[0].toUpperCase() + s.slice(1)}`
  );
  return parts.length > 0 ? parts.join(' / ') : 'no investment';
}

/**
 * What the set actually is — item, ability, nature, spread and moves.
 *
 * On both the team strip and the candidate list, because "Kingambit (Assault
 * Vest)" does not say whether it is the Swords Dance set or the bulky one, and
 * that is the difference a user is choosing between.
 */
export default function SetSummary({set, compact}: {set: PresetSet; compact?: boolean}) {
  return (
    <div className={compact ? 'set-summary compact' : 'set-summary'}>
      <div className="set-summary-line">
        <span className="set-item">{set.item ?? 'No item'}</span>
        <span className="set-sep">·</span>
        <span>{set.ability}</span>
        <span className="set-sep">·</span>
        <span>{set.nature}</span>
      </div>
      <div className="set-summary-line muted">{spreadSummary(set.sps)}</div>
      <div className="set-moves">
        {set.moves.filter(Boolean).map((m) => (
          <span key={m} className="set-move">
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

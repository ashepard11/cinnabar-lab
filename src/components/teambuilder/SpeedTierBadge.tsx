import type {SpeedTierSpec} from '../../../lib/teambuilder/types';

const DESCRIPTIONS: Record<string, string> = {
  '0': 'Free — no action needed. The condition is up before anything else happens.',
  '1': 'Fast — costs an action, but resolves before the opponent can respond.',
  '2': 'Slow — costs an action and resolves after the opponent acts. The team absorbs a turn of pressure first.',
  computed:
    'Depends on the opponent. A non-priority setter is fast against half the field and slow against the other half, so the tier is a speed comparison made per matchup.',
};

/**
 * How fast an enabler arrives.
 *
 * The spec reports the tier without pricing it into the score by default, and
 * one of Phase 1's open questions is whether users read this as a qualitative
 * badge or expect it to move the numbers. That answer decides whether Phase 4's
 * speed penalty stays advisory — so this is rendered prominently rather than
 * tucked into a tooltip, and the question is asked directly on the Build
 * screen.
 */
export default function SpeedTierBadge({tier}: {tier: SpeedTierSpec}) {
  const key = String(tier);
  const label = tier === 'computed' ? 'tier ?' : `tier ${tier}`;
  return (
    <span className={`tier-badge tier-${key}`} title={DESCRIPTIONS[key]}>
      {label}
    </span>
  );
}

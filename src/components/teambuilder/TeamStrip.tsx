import type {Candidate} from '../../../lib/teambuilder/types';

/**
 * The partial team across the top of the Build screen.
 *
 * Six slots, always all six, so the shape of what is still missing is visible
 * rather than inferred from a count. Filled slots are removable — the spec's
 * "back up" control undoes the last pick, but users explore alternatives at
 * slot 3 without wanting to restart, and removing slot 3 directly is the
 * cheaper affordance.
 */
export default function TeamStrip({
  team,
  teamSize,
  onRemove,
}: {
  team: Candidate[];
  teamSize: number;
  onRemove: (variantId: string) => void;
}) {
  const slots = Array.from({length: teamSize}, (_, i) => team[i] ?? null);
  return (
    <ol className="team-strip">
      {slots.map((member, i) => (
        <li key={member?.variant_id ?? `empty-${i}`} className={member ? 'team-slot filled' : 'team-slot'}>
          {member ? (
            <>
              <span className="slot-index">{i + 1}</span>
              <span className="slot-species">{member.species}</span>
              <span className="slot-set">{member.set_label}</span>
              <button
                type="button"
                className="slot-remove"
                aria-label={`Remove ${member.species}`}
                onClick={() => onRemove(member.variant_id)}
              >
                ×
              </button>
            </>
          ) : (
            <>
              <span className="slot-index">{i + 1}</span>
              <span className="slot-empty">empty</span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

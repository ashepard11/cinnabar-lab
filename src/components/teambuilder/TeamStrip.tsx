import type {Candidate, PresetSet} from '../../../lib/teambuilder/types';
import {spreadSummary} from './SetSummary';

export interface TeamSlotMember {
  candidate: Candidate;
  set: PresetSet;
}

/**
 * The partial team across the top of the Build screen.
 *
 * Six slots, always all six, so what is still missing is a shape rather than a
 * count. Three states, not two: filled, the slot currently being chosen for,
 * and not yet reached. The middle one matters because the candidate list below
 * is ranked *for that slot*, and without it the connection between the two
 * halves of the screen is left to be inferred.
 *
 * Each filled slot shows the set, not just the species — "Kingambit (Assault
 * Vest)" does not say whether it is the Swords Dance set or the bulky one.
 */
export default function TeamStrip({
  team,
  teamSize,
  onRemove,
}: {
  team: TeamSlotMember[];
  teamSize: number;
  onRemove: (variantId: string) => void;
}) {
  const slots = Array.from({length: teamSize}, (_, i) => team[i] ?? null);
  const considering = team.length < teamSize ? team.length : -1;

  return (
    <ol className="team-strip">
      {slots.map((member, i) => {
        const state = member ? 'filled' : i === considering ? 'considering' : 'pending';
        return (
          <li key={member?.candidate.variant_id ?? `empty-${i}`} className={`team-slot ${state}`}>
            <span className="slot-index">{i + 1}</span>
            {member ? (
              <>
                <span className="slot-species">{member.candidate.species}</span>
                <span className="slot-set">{member.set.item ?? 'No item'}</span>
                <span className="slot-detail">
                  {member.set.ability} · {member.set.nature}
                </span>
                <span className="slot-detail">{spreadSummary(member.set.sps)}</span>
                <ul className="slot-moves">
                  {member.set.moves.filter(Boolean).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="slot-remove"
                  aria-label={`Remove ${member.candidate.species}`}
                  onClick={() => onRemove(member.candidate.variant_id)}
                >
                  ×
                </button>
              </>
            ) : i === considering ? (
              <span className="slot-considering">choosing now</span>
            ) : (
              <span className="slot-empty">empty</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

import {Link} from 'react-router-dom';
import type {Candidate} from '../../../lib/teambuilder/types';
import SpeedTierBadge from './SpeedTierBadge';

export type SortKey = 'marginal_score' | 'conditions_added' | 'positioning_delta';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)}%`;

/**
 * One candidate for the next slot.
 *
 * A candidate can earn its slot in three different ways, so all three are on
 * the card at equal visual weight: direct matchup coverage, conditions it adds
 * that the team could not previously supply, and how much it improves existing
 * members' ability to reach their good matchups. A list sorted only by
 * marginal score hides two thirds of what matters — a redirection user with no
 * winning matchups and no conditions has to be able to surface here.
 *
 * `highlight` marks the dimension the list is currently sorted by, so the
 * reason a candidate is where it is stays visible. Whether three dimensions
 * side by side are comprehensible at all, or whether users need to pick one
 * and sort by it, is one of the questions this build exists to answer.
 */
export default function CandidateCard({
  candidate,
  rank,
  highlight,
  onPick,
}: {
  candidate: Candidate;
  rank: number;
  highlight: SortKey;
  onPick: (candidate: Candidate) => void;
}) {
  const {conditions_added: conditions, patches} = candidate;

  return (
    <li className="candidate-card">
      <div className="candidate-head">
        <span className="candidate-rank">{rank}</span>
        <div className="candidate-name">
          <Link to={`/build/variant/${encodeURIComponent(candidate.human_id)}`}>
            {candidate.species}
          </Link>
          <span className="candidate-set">{candidate.set_label}</span>
          {candidate.provisional && (
            <span className="provisional-badge" title="Ranked from the damage calculator while its simulations run">
              provisional
            </span>
          )}
        </div>
        <button type="button" className="candidate-pick" onClick={() => onPick(candidate)}>
          Add to team
        </button>
      </div>

      <div className="candidate-dimensions">
        <div className={highlight === 'marginal_score' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label">Matchup coverage</span>
          <span className="dimension-value">{signed(candidate.marginal_score)}</span>
          <span className="dimension-note">
            {patches.length > 0
              ? `answers ${patches.map((p) => p.species).join(', ')}`
              : 'patches nothing the team was missing'}
          </span>
        </div>

        <div className={highlight === 'conditions_added' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label">Conditions added</span>
          <span className="dimension-value">{conditions.length || '—'}</span>
          <span className="dimension-note">
            {conditions.length > 0 ? (
              conditions.map((c) => (
                <span key={c.condition} className="condition-chip">
                  {c.condition}
                  {c.enablers.map((e) => (
                    <SpeedTierBadge key={e.mechanism} tier={e.speed_tier} />
                  ))}
                </span>
              ))
            ) : (
              'none the team cannot already supply'
            )}
          </span>
        </div>

        <div className={highlight === 'positioning_delta' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label">Positioning</span>
          <span className="dimension-value">{signed(candidate.positioning_delta)}</span>
          <span className="dimension-note">
            {candidate.positioning_delta > 0
              ? 'helps teammates get in'
              : candidate.positioning_delta < 0
                ? 'costs teammates entry room'
                : 'no effect on teammates'}
            {` · enters on ${pct(candidate.entry_coverage)} of the field`}
          </span>
        </div>
      </div>
    </li>
  );
}

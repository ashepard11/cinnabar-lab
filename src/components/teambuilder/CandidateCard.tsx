import {useState} from 'react';
import {Link} from 'react-router-dom';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  SUPPORT_CATEGORIES,
  type Candidate,
  type EffectCategory,
  type SuppliedCondition,
  type TeambuilderConditionId,
  type ValueSwing,
} from '../../../lib/teambuilder/types';
import {spreadSummary} from './SetSummary';

export type SortKey = 'marginal_score' | 'support_delta' | 'positioning_delta';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const whole = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)}%`;

const mechanismName = (m: string) => m.slice(m.indexOf(':') + 1);
const mechanismKind = (m: string) => m.slice(0, m.indexOf(':'));
const conditionLabel = (id: string) => CONDITION_LABELS[id as TeambuilderConditionId] ?? id;

function enablerDetail(e: SuppliedCondition['enablers'][number]): {text: string; title: string} {
  const name = mechanismName(e.mechanism);
  if (e.speed_tier === 0) {
    return {text: mechanismKind(e.mechanism), title: `${name} needs no action.`};
  }
  if (e.speed_tier === 2) {
    return {text: 'slow', title: `${name} resolves after the opponent acts.`};
  }
  const share = e.first_share ?? 0;
  return {
    text: `${whole(share)} first`,
    title: `Against ${whole(share)} of the metagame by usage this Pokémon gets ${name} up before the opponent can attack; against the other ${whole(1 - share)} the team absorbs a turn first.`,
  };
}

const MARGINAL_HELP =
  'Percentage points of metagame-weighted team win rate added: score(team + this) − score(team). Incremental — the team is credited with its best answer, so a Pokémon adds nothing where a teammate is already better.';

const SUPPORT_HELP =
  "Percentage points added to teammates' win rate by supplying conditions they convert on.";

const POSITIONING_HELP =
  "Share of the metagame this Pokémon can switch in on while keeping 80% of its full-health matchup spread, and the percentage points it adds to teammates' win rate by helping them get in.";

function SwingRow({swing, showTeammate}: {swing: ValueSwing; showTeammate?: boolean}) {
  return (
    <li title={`${swing.opponent_species} is ${pct(swing.weight)} of the field.`}>
      {showTeammate && swing.teammate_species && (
        <span className="swing-teammate">{swing.teammate_species}</span>
      )}
      <span className="swing-opponent">{swing.opponent_species}</span>
      <span className="swing-change">
        {whole(swing.before)}→{whole(swing.after)}
      </span>
    </li>
  );
}

export default function CandidateCard({
  candidate,
  rank,
  highlight,
  detailed,
  hasTeammates,
  onPick,
}: {
  candidate: Candidate;
  rank: number;
  highlight: SortKey;
  detailed: boolean;
  hasTeammates: boolean;
  onPick: (candidate: Candidate) => void;
}) {
  const [openOverride, setOpenOverride] = useState(false);
  const open = detailed || openOverride;

  const {conditions_added: conditions, patches, support_swings, positioning_swings} = candidate;
  const set = candidate.sets?.[0];

  const byCategory = new Map<EffectCategory, SuppliedCondition[]>();
  for (const c of conditions) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const orderedCategories = SUPPORT_CATEGORIES.filter((c) => byCategory.has(c));

  return (
    <li className={open ? 'candidate-card open' : 'candidate-card'}>
      <div className="candidate-row">
        {/* --- identity + set --- */}
        <div className="candidate-ident">
          <div className="candidate-name">
            <span className="candidate-rank">{rank}</span>
            <Link to={`/build/variant/${encodeURIComponent(candidate.human_id)}`}>
              {candidate.species}
            </Link>
            {(candidate.sets?.length ?? 0) > 1 && (
              <span className="set-count" title={`${candidate.sets!.length} preset sets`}>
                ×{candidate.sets!.length}
              </span>
            )}
            {candidate.source === 'custom' && <span className="badge-active">custom</span>}
            {candidate.provisional && (
              <span className="provisional-badge" title="Estimated from the damage calculator while its simulations run">
                prov
              </span>
            )}
          </div>
          {set && (
            <div className="set-summary">
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
          )}
        </div>

        {/* --- matchup coverage --- */}
        <div className={highlight === 'marginal_score' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={MARGINAL_HELP}>
            Matchup
          </span>
          <span className="dimension-value">{signed(candidate.marginal_score)}</span>
          {open && patches.length > 0 && (
            <ul className="swing-list">
              {patches.map((p) => (
                <SwingRow
                  key={p.variant_id}
                  swing={{
                    opponent: p.variant_id,
                    opponent_species: p.species,
                    weight: p.weight,
                    before: p.p_exposed,
                    after: p.best_answer.p,
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* --- support --- */}
        <div className={highlight === 'support_delta' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={SUPPORT_HELP}>
            Support
          </span>
          <span className="dimension-value">
            {hasTeammates && candidate.support_delta > 0 ? signed(candidate.support_delta) : '—'}
          </span>
          {orderedCategories.length > 0 && (
            <span className="category-chips">
              {orderedCategories.map((cat) => (
                <span key={cat} className="category-chip">
                  {CATEGORY_LABELS[cat]}
                </span>
              ))}
            </span>
          )}
          {open && orderedCategories.length > 0 && (
            <>
              <span className="support-pills">
                {orderedCategories.map((cat) =>
                  byCategory.get(cat)!.map((c) =>
                    c.enablers.map((e) => {
                      const detail = enablerDetail(e);
                      return (
                        <span key={`${c.condition}:${e.mechanism}`} className="support-pill">
                          {cat !== 'speed' && (
                            <span className="pill-condition">{conditionLabel(c.condition)}:</span>
                          )}
                          <span className="pill-mechanism">{mechanismName(e.mechanism)}</span>
                          <span className="pill-detail" title={detail.title}>
                            ({detail.text})
                          </span>
                        </span>
                      );
                    })
                  )
                )}
              </span>
              {hasTeammates && support_swings.length > 0 && (
                <ul className="swing-list">
                  {support_swings.map((s, i) => (
                    <SwingRow key={i} swing={s} showTeammate />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* --- positioning --- */}
        <div className={highlight === 'positioning_delta' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={POSITIONING_HELP}>
            Positioning
          </span>
          <span className="dimension-value">
            {pct(candidate.entry_coverage)}
            <span className="value-suffix">enters</span>
          </span>
          {hasTeammates && candidate.positioning_delta > 0 && (
            <span className="dimension-subvalue">{signed(candidate.positioning_delta)} for teammates</span>
          )}
          {open && hasTeammates && positioning_swings.length > 0 && (
            <ul className="swing-list">
              {positioning_swings.map((s, i) => (
                <SwingRow key={i} swing={s} showTeammate />
              ))}
            </ul>
          )}
        </div>

        {/* --- actions --- */}
        <div className="candidate-actions">
          <button type="button" className="candidate-pick" onClick={() => onPick(candidate)}>
            Add
          </button>
          {!detailed && (
            <button
              type="button"
              className="candidate-expand"
              aria-expanded={open}
              title="Show the matchups behind each figure"
              onClick={() => setOpenOverride((o) => !o)}
            >
              {open ? 'Less' : 'More'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

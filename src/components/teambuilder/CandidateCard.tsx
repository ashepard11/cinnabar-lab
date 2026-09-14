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
import SetSummary from './SetSummary';

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
    return {
      text: mechanismKind(e.mechanism),
      title: `${name} needs no action — the condition is up before anything else happens.`,
    };
  }
  if (e.speed_tier === 2) {
    return {
      text: 'slow',
      title: `${name} costs an action and resolves after the opponent acts, so the team absorbs a turn of pressure before it lands.`,
    };
  }
  const share = e.first_share ?? 0;
  return {
    text: `${whole(share)} first`,
    title: `Against ${whole(share)} of the metagame by usage, this Pokémon gets ${name} up before the opponent can attack. Against the remaining ${whole(1 - share)} it moves second, so the team takes a turn of pressure under the unfavourable state first.`,
  };
}

const MARGINAL_HELP =
  'Percentage points of metagame-weighted team win rate this member adds: score(team + this) − score(team). Incremental — a Pokémon that beats an opponent 90% of the time adds nothing if a teammate already beats it 88%, because the team is credited with its best answer.';

const SUPPORT_HELP =
  "Percentage points this member adds to its teammates' win rate by supplying conditions they convert on. The gain belongs to the teammate, which is why it is not counted under matchup coverage.";

const POSITIONING_HELP =
  "Percentage points this member adds to teammates' win rate by helping them reach their good matchups. Provisional — the display may change once the Phase 6 logic is real.";

/** `Opponent 24%→68%`, the format the existing team builder already uses. */
function SwingRow({swing, showTeammate}: {swing: ValueSwing; showTeammate?: boolean}) {
  return (
    <li
      title={`${swing.opponent_species} is ${pct(swing.weight)} of the field.${
        swing.mechanism ? ` Via ${mechanismName(swing.mechanism)}.` : ''
      }`}
    >
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

/**
 * One candidate for the next slot.
 *
 * Three tiles, all in percentage points of metagame-weighted win rate, differing
 * in whose win rate moves. Each collapses to its headline figure so 84 rows can
 * be scanned, and expands to the specific matchups behind it so the figure can
 * be checked rather than trusted.
 */
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
  /** Global density. A card can still be opened individually when compact. */
  detailed: boolean;
  /** Support and positioning need teammates to act on; with none they are zero. */
  hasTeammates: boolean;
  onPick: (candidate: Candidate) => void;
}) {
  const [openOverride, setOpenOverride] = useState(false);
  const open = detailed || openOverride;

  const {conditions_added: conditions, patches, support_swings, positioning_swings} = candidate;
  const primarySet = candidate.sets?.[0];

  const byCategory = new Map<EffectCategory, SuppliedCondition[]>();
  for (const c of conditions) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const orderedCategories = SUPPORT_CATEGORIES.filter((c) => byCategory.has(c));

  return (
    <li className={open ? 'candidate-card open' : 'candidate-card'}>
      <div className="candidate-head">
        <span className="candidate-rank">{rank}</span>
        <div className="candidate-name">
          <Link to={`/build/variant/${encodeURIComponent(candidate.human_id)}`}>
            {candidate.species}
          </Link>
          <span className="candidate-set">{candidate.set_label}</span>
          {(candidate.sets?.length ?? 0) > 1 && (
            <span className="set-count" title={`${candidate.sets!.length} preset sets for this Pokémon`}>
              {candidate.sets!.length} sets
            </span>
          )}
          {candidate.source === 'custom' && <span className="badge-active">custom</span>}
          {candidate.provisional && (
            <span className="provisional-badge" title="Ranked from the damage calculator while its simulations run">
              provisional
            </span>
          )}
        </div>
        {!detailed && (
          <button
            type="button"
            className="candidate-expand"
            aria-expanded={open}
            onClick={() => setOpenOverride((o) => !o)}
          >
            {open ? 'Less' : 'Detail'}
          </button>
        )}
        <button type="button" className="candidate-pick" onClick={() => onPick(candidate)}>
          Add to team
        </button>
      </div>

      {primarySet && <SetSummary set={primarySet} compact={!open} />}

      <div className="candidate-dimensions">
        {/* --- Matchup coverage --- */}
        <div className={highlight === 'marginal_score' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={MARGINAL_HELP}>
            Matchup coverage
          </span>
          <span className="dimension-value" title={MARGINAL_HELP}>
            {signed(candidate.marginal_score)}
          </span>
          {open && (
            <span className="dimension-note">
              {patches.length > 0 ? (
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
              ) : (
                'answers nothing the team was missing'
              )}
            </span>
          )}
        </div>

        {/* --- Support --- */}
        <div className={highlight === 'support_delta' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={SUPPORT_HELP}>
            Support
          </span>
          <span className="dimension-value" title={SUPPORT_HELP}>
            {!hasTeammates ? '—' : candidate.support_delta > 0 ? signed(candidate.support_delta) : '—'}
          </span>

          {/* Categories show even when collapsed — they are what makes a
              column of 84 rows scannable for "who brings speed control". */}
          {orderedCategories.length > 0 && (
            <span className="category-chips">
              {orderedCategories.map((cat) => (
                <span key={cat} className="category-chip">
                  {CATEGORY_LABELS[cat]}
                </span>
              ))}
            </span>
          )}

          {open && (
            <span className="dimension-note">
              {orderedCategories.length === 0 ? (
                'supplies nothing the team cannot already bring about'
              ) : (
                <>
                  <span className="support-groups">
                    {orderedCategories.map((cat) => (
                      <span key={cat} className="support-group">
                        {byCategory.get(cat)!.map((c) =>
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
                        )}
                      </span>
                    ))}
                  </span>
                  {hasTeammates && support_swings.length > 0 && (
                    <ul className="swing-list">
                      {support_swings.map((s, i) => (
                        <SwingRow key={i} swing={s} showTeammate />
                      ))}
                    </ul>
                  )}
                  {!hasTeammates && (
                    <span className="empty-note">
                      Support is worth nothing until there is a teammate to support.
                      Pick a first slot to see what this enables.
                    </span>
                  )}
                </>
              )}
            </span>
          )}
        </div>

        {/* --- Positioning --- */}
        <div className={highlight === 'positioning_delta' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={POSITIONING_HELP}>
            Positioning
          </span>
          {/* Its own entry coverage comes first: on an empty team that is the
              whole of what positioning means, and it stays the anchor after. */}
          <span className="dimension-value" title="Share of the metagame by usage this Pokémon can switch in on while keeping at least 80% of its full-health matchup spread.">
            {pct(candidate.entry_coverage)}
            <span className="value-suffix">enters</span>
          </span>
          <span className="dimension-subvalue">
            {hasTeammates && candidate.positioning_delta > 0
              ? `${signed(candidate.positioning_delta)} for teammates`
              : hasTeammates
                ? 'no entry help for teammates'
                : 'teammate help needs a teammate'}
          </span>

          {open && (
            <span className="dimension-note">
              {hasTeammates && positioning_swings.length > 0 ? (
                <ul className="swing-list">
                  {positioning_swings.map((s, i) => (
                    <SwingRow key={i} swing={s} showTeammate />
                  ))}
                </ul>
              ) : hasTeammates ? (
                'brings no tool that reduces a teammate’s entry cost'
              ) : (
                <span className="empty-note">
                  With no teammates, positioning is just how safely this Pokémon
                  itself gets in.
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

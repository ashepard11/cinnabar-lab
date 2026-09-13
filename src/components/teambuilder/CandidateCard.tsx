import {Link} from 'react-router-dom';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  SUPPORT_CATEGORIES,
  type Candidate,
  type EffectCategory,
  type SuppliedCondition,
  type TeambuilderConditionId,
} from '../../../lib/teambuilder/types';

export type SortKey = 'marginal_score' | 'support_delta' | 'positioning_delta';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)}%`;

/** "move:Tailwind" → "Tailwind"; "ability:Drizzle" → "Drizzle". */
function mechanismName(mechanism: string): string {
  return mechanism.slice(mechanism.indexOf(':') + 1);
}

function mechanismKind(mechanism: string): string {
  return mechanism.slice(0, mechanism.indexOf(':'));
}

function conditionLabel(id: string): string {
  return CONDITION_LABELS[id as TeambuilderConditionId] ?? id;
}

/**
 * The parenthetical after an enabler name.
 *
 * For anything with a computed speed tier this is the share of the metagame it
 * resolves against before the opponent can act — the single number that makes
 * "fast against half the field, slow against the other half" usable. Abilities
 * and other tier-0 enablers say what they are instead, since "100% first" is
 * noise on something that needs no action at all.
 */
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
    text: `${Math.round(share * 100)}% first`,
    title: `Against ${Math.round(share * 100)}% of the metagame by usage, this Pokémon gets ${name} up before the opponent can attack. Against the remaining ${Math.round((1 - share) * 100)}% it moves second, so the team takes a turn of pressure under the unfavourable state first.`,
  };
}

const MARGINAL_HELP =
  'Percentage points of metagame-weighted team win rate this member adds: score(team + this) − score(team). Incremental — a Pokémon that beats an opponent 90% of the time adds nothing if a teammate already beats it 88%, because the team is credited with its best answer.';

const SUPPORT_HELP =
  "Percentage points this member adds to its *teammates'* win rate by supplying conditions they convert on. A Tailwind user that lets a slow attacker move first scores here, not under matchup coverage, because the gain belongs to the teammate.";

const POSITIONING_HELP =
  "Percentage points this member adds to teammates' win rate by helping them reach their good matchups — pivots, redirection, entry-cost reduction. Provisional: this is comparable with the other two by design, but the display may change once the Phase 6 logic is real.";

/**
 * One candidate for the next slot.
 *
 * All three dimensions are in the same unit — percentage points of
 * metagame-weighted win rate — so they read against each other. The three
 * differ in *whose* win rate moves: its own (matchup coverage), or its
 * teammates' (support and positioning).
 *
 * Support pills are grouped by effect category in a fixed order, so the same
 * category lands in the same place on every row and a reader can scan a column
 * for "who brings speed control" without reading each card.
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
  const {conditions_added: conditions, patches, opponents_unlocked: unlocked} = candidate;

  const byCategory = new Map<EffectCategory, SuppliedCondition[]>();
  for (const c of conditions) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const orderedCategories = SUPPORT_CATEGORIES.filter((c) => byCategory.has(c));

  return (
    <li className="candidate-card">
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
        <button type="button" className="candidate-pick" onClick={() => onPick(candidate)}>
          Add to team
        </button>
      </div>

      <div className="candidate-dimensions">
        <div className={highlight === 'marginal_score' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={MARGINAL_HELP}>
            Matchup coverage
          </span>
          <span className="dimension-value" title={MARGINAL_HELP}>
            {signed(candidate.marginal_score)}
          </span>
          <span className="dimension-note">
            {patches.length > 0 ? (
              <ul className="threat-list">
                {patches.map((p) => (
                  <li key={p.variant_id} title={`${p.species} is ${pct(p.weight)} of the field; the team currently does ${pct(p.p_exposed)} against it, and this member does ${pct(p.best_answer.p)}.`}>
                    <span className="threat-name">{p.species}</span>
                    <span className="threat-weight">{pct(p.weight)}</span>
                    <span className="threat-gain">→ {pct(p.best_answer.p)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              'answers nothing the team was missing'
            )}
          </span>
        </div>

        <div className={highlight === 'support_delta' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={SUPPORT_HELP}>
            Support
          </span>
          <span className="dimension-value" title={SUPPORT_HELP}>
            {candidate.support_delta > 0 ? signed(candidate.support_delta) : '—'}
          </span>
          <span className="dimension-note">
            {orderedCategories.length > 0 ? (
              <span className="support-groups">
                {orderedCategories.map((cat) => (
                  <span key={cat} className="support-group">
                    <span className="support-category">{CATEGORY_LABELS[cat]}</span>
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
            ) : (
              'supplies nothing the team cannot already bring about'
            )}
          </span>
        </div>

        <div className={highlight === 'positioning_delta' ? 'dimension active' : 'dimension'}>
          <span className="dimension-label" title={POSITIONING_HELP}>
            Positioning
          </span>
          <span className="dimension-value" title={POSITIONING_HELP}>
            {candidate.positioning_delta > 0 ? signed(candidate.positioning_delta) : '—'}
          </span>
          <span className="dimension-note">
            {unlocked.length > 0 ? (
              <ul className="threat-list">
                {unlocked.map((o) => (
                  <li key={o.species} title={`${o.helps} can now switch in against ${o.species} (${pct(o.weight)} of the field) without losing more than it can afford.`}>
                    <span className="threat-name">{o.species}</span>
                    <span className="threat-weight">{pct(o.weight)}</span>
                    <span className="threat-gain">for {o.helps}</span>
                  </li>
                ))}
              </ul>
            ) : (
              `no entry help · enters on ${pct(candidate.entry_coverage)} of the field itself`
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

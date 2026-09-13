import {Link} from 'react-router-dom';
import {useFixtureVariants, useMatchupCells, useTeamScore} from '../lib/useFixtures';
import SpeedTierBadge from '../components/teambuilder/SpeedTierBadge';
import {CATEGORY_LABELS, CONDITION_LABELS, type TeambuilderConditionId} from '../../lib/teambuilder/types';

const conditionLabel = (id: string) =>
  CONDITION_LABELS[id as TeambuilderConditionId] ?? id;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Blue for the team, red against it, with the neutral point at 0.5. */
function cellColor(p: number): string {
  const t = Math.max(0, Math.min(1, p));
  return t >= 0.5
    ? `rgba(70, 83, 200, ${((t - 0.5) * 2 * 0.55).toFixed(3)})`
    : `rgba(179, 66, 58, ${((0.5 - t) * 2 * 0.55).toFixed(3)})`;
}

/**
 * Team detail (SPEC-teambuilder.md Phase 1).
 *
 * The full matchup grid of six members against the metagame, a condition
 * inventory naming which member supplies each enabler, a positioning summary,
 * and the leave-one-out contribution chart that answers whether the sixth slot
 * is doing anything.
 *
 * The score band leads, not the ceiling. A team at 0.64 ceiling and 0.58 floor
 * is a safer bet than one at 0.66 and 0.31, and the ceiling alone cannot tell
 * them apart — since the model carries no reliability priors, the band and the
 * enabler speed tiers are the only signals a reader gets about how much setup a
 * team is asking for.
 */
export default function TeamDetailPage() {
  const {data: team} = useTeamScore();
  const {data: variants} = useFixtureVariants();
  const {data: cells} = useMatchupCells();

  if (!team || !variants) return <div className="page"><p>Loading fixtures…</p></div>;

  const nameOf = (id: string) => variants.find((v) => (v.cid ?? v.id) === id)?.species ?? id;
  const slugOf = (id: string) => variants.find((v) => (v.cid ?? v.id) === id)?.id ?? id;

  // Opponents are whatever the fixture matrix covers.
  const opponents = [...new Set((cells ?? []).map((c) => c.variant_B_id))];
  const cellFor = (member: string, opponent: string) =>
    (cells ?? []).find(
      (c) => c.variant_A_id === member && c.variant_B_id === opponent && c.condition === 'fresh'
    );

  const maxContribution = Math.max(...team.member_contributions.map((m) => Math.abs(m.marginal_score)), 0.001);

  return (
    <div className="page team-detail">
      <header className="page-head">
        <Link to="/build" className="back-link">← Back to Build</Link>
        <h1>Team detail</h1>
        <p className="subtitle">Running on fixture data — every score here is invented.</p>
      </header>

      <section className="score-band-section">
        <div className="score-band">
          <div className="band-track">
            <div
              className="band-fill"
              style={{left: `${team.score_floor * 100}%`, width: `${(team.score_ceiling - team.score_floor) * 100}%`}}
            />
            <div className="band-marker floor" style={{left: `${team.score_floor * 100}%`}} />
            <div className="band-marker ceiling" style={{left: `${team.score_ceiling * 100}%`}} />
          </div>
          <div className="band-labels">
            <span>
              <strong>{pct(team.score_floor)}</strong> floor
              <span className="muted"> — no conditions, no chip</span>
            </span>
            <span>
              <strong>{pct(team.score_ceiling)}</strong> ceiling
              <span className="muted"> — every supplied condition available</span>
            </span>
          </div>
        </div>
        <div className="reliance">
          <span className="headline-value">{pct(team.condition_reliance)}</span>
          <span className="headline-label">Condition reliance</span>
          <span className="headline-note">
            How much of the ceiling depends on setup landing. The score is a ceiling,
            not an expectation — the model applies no reliability priors.
          </span>
        </div>
      </section>

      <section>
        <h2>Members</h2>
        <ul className="member-row">
          {team.members.map((m) => (
            <li key={m}>
              <Link to={`/build/variant/${encodeURIComponent(slugOf(m))}`}>{nameOf(m)}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Matchup grid</h2>
        <p className="muted footnote" style={{marginTop: 0, marginBottom: 12}}>
          Six members down the side, the metagame across the top. In this fixture
          build the matrix covers only the six variants the generator emits, so the
          columns happen to be the same Pokémon as the rows and the diagonal is
          empty. Against real data these are different sets.
        </p>
        {opponents.length === 0 ? (
          <p className="muted">No fixture cells.</p>
        ) : (
          <div className="grid-scroll">
            <table className="matchup-grid">
              <thead>
                <tr>
                  <th />
                  {opponents.map((o) => (
                    <th key={o} className="grid-opponent">{nameOf(o)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {team.members.map((m) => (
                  <tr key={m}>
                    <th className="grid-member">{nameOf(m)}</th>
                    {opponents.map((o) => {
                      const cell = cellFor(m, o);
                      return (
                        <td
                          key={o}
                          style={cell ? {background: cellColor(cell.p_A_wins)} : undefined}
                          title={
                            cell
                              ? `${nameOf(m)} beats ${nameOf(o)} ${pct(cell.p_A_wins)} of the time (${cell.status}${cell.inherited_from ? ` from ${cell.inherited_from}` : ''})`
                              : 'no cell'
                          }
                        >
                          {cell ? (cell.p_A_wins * 100).toFixed(0) : '·'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Condition inventory</h2>
        <table className="detail-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Condition</th>
              <th>Supplied by</th>
              <th>Mechanism</th>
              <th>Speed</th>
            </tr>
          </thead>
          <tbody>
            {team.conditions_supplied.flatMap((c) =>
              c.enablers.map((e) => (
                <tr key={`${c.condition}:${e.mechanism}`}>
                  <td className="muted">{CATEGORY_LABELS[c.category]}</td>
                  <td><strong>{conditionLabel(c.condition)}</strong></td>
                  <td>{nameOf(e.member)}</td>
                  <td><code>{e.mechanism}</code></td>
                  <td><SpeedTierBadge tier={e.speed_tier} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="setup-profile">
          {Object.entries(team.setup_profile)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <span key={k} className="condition-chip">
                {k.replace(/_/g, ' ')} <strong>{v}</strong>
              </span>
            ))}
        </div>
      </section>

      <section>
        <h2>Positioning summary</h2>
        <table className="detail-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Entry coverage</th>
            </tr>
          </thead>
          <tbody>
            {team.positioning.member_entry_coverage.map((m) => (
              <tr key={m.member}>
                <td>{nameOf(m.member)}</td>
                <td>
                  <span className="inline-bar" style={{width: `${m.coverage * 100}%`}} />
                  {pct(m.coverage)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {team.positioning.unreachable_opponents.length > 0 && (
          <p className="muted footnote">
            No member can safely come in on:{' '}
            {team.positioning.unreachable_opponents.map((o) => `${o.species} (${pct(o.weight)})`).join(', ')}.
            Positioning is reported alongside the score rather than folded into it —
            a single number would hide which of three problems this team has.
          </p>
        )}
      </section>

      <section>
        <h2>Worst matchups</h2>
        <table className="detail-table">
          <thead>
            <tr>
              <th>Opponent</th>
              <th>Weight</th>
              <th>Best the team does</th>
              <th>Answer</th>
            </tr>
          </thead>
          <tbody>
            {team.worst_matchups.map((w) => (
              <tr key={w.variant_id}>
                <td>{w.species}</td>
                <td>{pct(w.weight)}</td>
                <td className="loss">{pct(w.p_exposed)}</td>
                <td className="muted">
                  {nameOf(w.best_answer.member)} under {conditionLabel(w.best_answer.condition)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Member contributions</h2>
        <p className="muted footnote">
          Leave-one-out score delta. This is what says whether the sixth slot is
          doing anything.
        </p>
        <ul className="contribution-chart">
          {[...team.member_contributions]
            .sort((a, b) => b.marginal_score - a.marginal_score)
            .map((m) => (
              <li key={m.variant_id}>
                <span className="contribution-name">{nameOf(m.variant_id)}</span>
                <span className="contribution-track">
                  <span
                    className="contribution-bar"
                    style={{width: `${(Math.abs(m.marginal_score) / maxContribution) * 100}%`}}
                  />
                </span>
                <span className="contribution-value">{pct(m.marginal_score)}</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

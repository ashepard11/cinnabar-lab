import {Link, useParams} from 'react-router-dom';
import {useEnablers, useFixtureVariants, useMatchupCells, usePositioning} from '../lib/useFixtures';
import SpeedTierBadge from '../components/teambuilder/SpeedTierBadge';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Pokémon detail (SPEC-teambuilder.md Phase 1).
 *
 * Where a user goes to understand why a candidate was ranked where it was:
 * its matchup spread, what it enables, and its positioning profile.
 *
 * The two headline positioning numbers are deliberately shown side by side
 * rather than combined, because they separate two different failures. A
 * Pokémon can come in safely on most of the field and then beat none of it, or
 * beat most of the field but only from full health. One number cannot say
 * which.
 *
 * Running on fixtures. The matchup cells cover only the handful of pairs the
 * fixture generator emits, so most spreads are sparse here.
 */
export default function VariantDetailPage() {
  const {variantId = ''} = useParams();
  const {data: variants} = useFixtureVariants();
  const {data: cells} = useMatchupCells();
  const {data: enablerRecords} = useEnablers();
  const {data: profiles} = usePositioning();

  const variant = variants?.find((v) => v.id === variantId);
  const cid = variant?.cid ?? variantId;

  const spread = (cells ?? []).filter((c) => c.variant_A_id === cid && c.condition === 'fresh');
  const enablers = (enablerRecords ?? []).find((r) => r.human_id === variantId)?.enablers ?? [];
  const positioning = (profiles ?? []).find((p) => p.variant_id === cid);

  const nameOf = (id: string) => variants?.find((v) => (v.cid ?? v.id) === id)?.species ?? id;

  if (!variants) return <div className="page"><p>Loading fixtures…</p></div>;

  return (
    <div className="page variant-detail">
      <header className="page-head">
        <Link to="/build" className="back-link">← Back to Build</Link>
        <h1>{variant?.species ?? variantId}</h1>
        <p className="subtitle">
          {variant ? (
            <>
              {variant.set_label} · {variant.ability} · {variant.nature} ·{' '}
              weight {pct(variant.weight)}
              {variant.tier && <> · <span className="badge-active">{variant.tier} tier</span></>}
            </>
          ) : (
            'Not in the fixture set — the fixture covers only the top variants by weight.'
          )}
        </p>
      </header>

      <section>
        <h2>Positioning</h2>
        {positioning ? (
          <>
            <div className="headline-numbers">
              <div className="headline">
                <span className="headline-value">{pct(positioning.entry_coverage)}</span>
                <span className="headline-label">Entry coverage</span>
                <span className="headline-note">
                  Share of the field it can switch in on while keeping at least 80% of
                  its full-health matchup spread.
                </span>
              </div>
              <div className="headline">
                <span className="headline-value">{positioning.conversion}</span>
                <span className="headline-label">Conversion</span>
                <span className="headline-note">
                  Across that share, how many opponents it is actually favoured
                  against after paying the entry cost.
                </span>
              </div>
              <div className="headline">
                <span className="headline-value">{pct(positioning.switch_in_score)}</span>
                <span className="headline-label">Switch-in score</span>
                <span className="headline-note">
                  Usage-weighted matchup spread retained after entry costs. Hard to
                  read alone, which is why the two above exist.
                </span>
              </div>
            </div>

            <h3>Cannot safely come in on</h3>
            {positioning.costly_entries.length === 0 ? (
              <p className="muted">Nothing in the fixture field costs it more than it can afford.</p>
            ) : (
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>Opponent</th>
                    <th>Entry cost</th>
                    <th>Spread retained</th>
                  </tr>
                </thead>
                <tbody>
                  {positioning.costly_entries.map((e) => (
                    <tr key={e.opponent}>
                      <td>{e.species}</td>
                      <td>{pct(e.cost)}</td>
                      <td>{pct(e.spread_retained)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted footnote">
              Entry cost assumes the opponent attacks with its best move into the
              switch. It does not model prediction, Protect, or the opponent
              switching out — it is a floor on how safely this Pokémon enters.
            </p>

            {positioning.tools_provided.length > 0 && (
              <>
                <h3>Tools it gives teammates</h3>
                <ul className="tool-list">
                  {positioning.tools_provided.map((t) => (
                    <li key={t.tool}>
                      <code>{t.tool}</code> <span className="muted">{t.effect.replace(/_/g, ' ')}</span>{' '}
                      <SpeedTierBadge tier={t.speed_tier} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="muted">No positioning profile in the fixture for this variant.</p>
        )}
      </section>

      <section>
        <h2>What it enables</h2>
        {enablers.length === 0 ? (
          <p className="muted">
            No enablers recorded. It contributes through matchups and positioning only.
          </p>
        ) : (
          <table className="detail-table">
            <thead>
              <tr>
                <th>Condition</th>
                <th>Mechanism</th>
                <th>Class</th>
                <th>Target</th>
                <th>Cost</th>
                <th>Speed</th>
              </tr>
            </thead>
            <tbody>
              {enablers.map((e) => (
                <tr key={`${e.condition}:${e.mechanism}`}>
                  <td><strong>{e.condition}</strong></td>
                  <td><code>{e.mechanism}</code></td>
                  <td>{e.mechanism_class.replace(/_/g, ' ')}</td>
                  <td>{e.target.replace(/_/g, ' ')}</td>
                  <td>{e.action_cost === 0 ? 'free' : `${e.action_cost} action`}</td>
                  <td><SpeedTierBadge tier={e.speed_tier} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted footnote">
          One record per mechanism-and-condition pair — a move doing two things
          appears twice. Effects the simulator applies on its own, like Swift Swim
          gaining speed once rain is up, are not enablers.
        </p>
      </section>

      <section>
        <h2>Matchup spread</h2>
        {spread.length === 0 ? (
          <p className="muted">
            No fixture cells for this variant. The fixture matrix covers only the top
            six by weight.
          </p>
        ) : (
          <table className="detail-table">
            <thead>
              <tr>
                <th>Opponent</th>
                <th>P(win)</th>
                <th>Turns</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {[...spread]
                .sort((a, b) => b.p_A_wins - a.p_A_wins)
                .map((c) => (
                  <tr key={c.variant_B_id}>
                    <td>{nameOf(c.variant_B_id)}</td>
                    <td className={c.p_A_wins >= 0.5 ? 'win' : 'loss'}>{pct(c.p_A_wins)}</td>
                    <td>{c.mean_turns}</td>
                    <td>
                      <span className={`cell-status status-${c.status}`}>{c.status}</span>
                      {c.inherited_from && <span className="muted"> from {c.inherited_from}</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

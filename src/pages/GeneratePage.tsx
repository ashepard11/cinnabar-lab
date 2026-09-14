import {useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {useFixtureVariants, useTeamScore} from '../lib/useFixtures';
import type {TeamScore} from '../../lib/teambuilder/types';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Automatic mode (SPEC-teambuilder.md Phase 1).
 *
 * Configuration for scoring parameters and constraints, above a ranked team
 * list showing members, the score band and worst matchups.
 *
 * `condition_reliance` is on the card itself rather than in a detail view,
 * which is the spec's explicit instruction and the reason the list is cards
 * rather than a table. A team at 0.66 ceiling with 0.31 floor should not be
 * able to sit above one at 0.64/0.58 without the reader seeing why.
 *
 * The search does not exist until Phase 8. This screen derives a plausible
 * ranked list from the single fixture team so the layout, the controls and
 * the sorting question can be exercised now.
 */
export default function GeneratePage() {
  const {data: base} = useTeamScore();
  const {data: variants} = useFixtureVariants();

  const [lambda, setLambda] = useState(0.25);
  const [beamWidth, setBeamWidth] = useState(50);
  const [priceSlowEnablers, setPriceSlowEnablers] = useState(false);
  const [sortBy, setSortBy] = useState<'ceiling' | 'floor' | 'reliance'>('ceiling');

  /**
   * Fixture-only: fan the one scored team out into a ranked list by varying
   * its band. Not a search, and not a model of one — it exists so the card
   * layout can be judged against a list that has both safe and swingy teams
   * in it, which is the comparison the band is meant to support.
   */
  const teams: TeamScore[] = useMemo(() => {
    if (!base || !variants) return [];
    return Array.from({length: 12}, (_, i) => {
      const ceiling = base.score_ceiling - i * 0.006;
      // Later teams lean harder on conditions, so the band widens down the list.
      const reliance = 0.04 + (i % 5) * 0.075;
      const floor = ceiling * (1 - reliance);
      const rotation = variants.slice(i % 6, (i % 6) + 6);
      // Rotate the worst matchups too. Every team showing the same four
      // problems would make the card look broken and would tell the layout
      // question nothing.
      const memberIds = new Set(rotation.map((v) => v.cid ?? v.id));
      // Drawn from outside the team: a team listing its own member as a
      // matchup it loses to is nonsense, and the card has to be readable as
      // the real thing for the layout judgement to be worth anything.
      const pool = variants.filter((v) => !memberIds.has(v.cid ?? v.id));
      const worst = base.worst_matchups.map((w, j) => {
        const stand = pool[(i + j) % pool.length];
        return {...w, species: stand.species, variant_id: stand.cid ?? stand.id,
                p_exposed: Math.min(0.39, w.p_exposed + ((i + j) % 4) * 0.03)};
      });
      return {
        ...base,
        worst_matchups: worst,
        members: rotation.map((v) => v.cid ?? v.id),
        score_ceiling: ceiling,
        score_floor: floor,
        condition_reliance: reliance,
      };
    });
  }, [base, variants]);

  const ranked = useMemo(() => {
    const list = [...teams];
    if (sortBy === 'floor') return list.sort((a, b) => b.score_floor - a.score_floor);
    if (sortBy === 'reliance') return list.sort((a, b) => a.condition_reliance - b.condition_reliance);
    return list.sort((a, b) => b.score_ceiling - a.score_ceiling);
  }, [teams, sortBy]);

  if (!base || !variants) return <div className="page"><p>Loading fixtures…</p></div>;

  const nameOf = (id: string) => variants.find((v) => (v.cid ?? v.id) === id)?.species ?? id;

  return (
    <div className="page generate-page">
      <header className="page-head">
        <h1>Generate teams</h1>
        <p className="subtitle">Fixture data — the search itself lands in Phase 8.</p>
      </header>

      <section className="generate-config">
        <h2>Configuration</h2>
        <div className="config-row">
          <label title="Approximates bring-6 pick-4 by blending a team's second-best answer into its best. At 0 a team scores as its single best answer.">
            <span>λ</span>
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.05}
              value={lambda}
              onChange={(e) => setLambda(Number(e.target.value))}
            />
            <output>{lambda.toFixed(2)}</output>
          </label>

          <label title="At width 1 the automatic search reproduces greedy guided mode exactly.">
            <span>Beam width</span>
            <input
              type="number"
              min={1}
              max={200}
              value={beamWidth}
              onChange={(e) => setBeamWidth(Number(e.target.value))}
            />
          </label>

          <label className="checkbox" title="Charges a tier-2 enabler roughly a turn of absorbed damage. Approximate.">
            <input
              type="checkbox"
              checked={priceSlowEnablers}
              onChange={(e) => setPriceSlowEnablers(e.target.checked)}
            />
            <span>Price slow enablers</span>
          </label>
        </div>
      </section>

      <section>
        <div className="candidates-head">
          <h2>Ranked teams</h2>
          <div className="sort-toggle" role="group" aria-label="Sort teams">
            <button type="button" className={sortBy === 'ceiling' ? 'active' : ''} onClick={() => setSortBy('ceiling')}>
              Ceiling
            </button>
            <button type="button" className={sortBy === 'floor' ? 'active' : ''} onClick={() => setSortBy('floor')}>
              Floor
            </button>
            <button type="button" className={sortBy === 'reliance' ? 'active' : ''} onClick={() => setSortBy('reliance')}>
              Least setup
            </button>
          </div>
        </div>

        <ol className="team-list">
          {ranked.map((t, i) => (
            <li key={i} className="team-card">
              <div className="team-card-head">
                <span className="candidate-rank">{i + 1}</span>
                <ul className="member-row compact">
                  {t.members.map((m) => (
                    <li key={m}>{nameOf(m)}</li>
                  ))}
                </ul>
                <Link className="team-card-link" to="/build/team/current">
                  Detail
                </Link>
              </div>

              <div className="team-card-band">
                <div className="band-track">
                  <div
                    className="band-fill"
                    style={{left: `${t.score_floor * 100}%`, width: `${(t.score_ceiling - t.score_floor) * 100}%`}}
                  />
                </div>
                <span className="band-figures">
                  <strong>{pct(t.score_floor)}</strong>
                  <span className="muted"> floor · </span>
                  <strong>{pct(t.score_ceiling)}</strong>
                  <span className="muted"> ceiling · </span>
                  <span className={t.condition_reliance > 0.2 ? 'reliance-high' : 'reliance-low'}>
                    {pct(t.condition_reliance)} setup-dependent
                  </span>
                </span>
              </div>

              <div className="team-card-worst">
                <span className="alt-label">Worst</span>
                {t.worst_matchups.slice(0, 4).map((w) => (
                  <span key={w.variant_id} className="condition-chip">
                    {w.species} <strong className="loss">{pct(w.p_exposed)}</strong>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

    </div>
  );
}

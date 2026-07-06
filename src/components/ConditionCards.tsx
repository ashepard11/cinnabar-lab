import { interpolateRdBu } from 'd3-scale-chromatic';
import { CONDITION_IDS, type MatchupRow } from '../lib/matchupDb';

/**
 * The 10-starting-conditions grid for one A-vs-B matchup (P(A wins) per
 * condition). Used by the matchup detail page and the team builder's
 * weakest-matchups expansion.
 */
export default function ConditionCards({ rows }: { rows: Map<string, MatchupRow> }) {
  return (
    <div className="condition-cards">
      {CONDITION_IDS.map((c) => {
        const r = rows.get(c);
        if (!r) return <div key={c} className="condition-card condition-missing">{c}: —</div>;
        const pct = Math.round(r.p_A_wins * 100);
        return (
          <div key={c} className="condition-card" style={{ borderTopColor: interpolateRdBu(r.p_A_wins) }}>
            <div className="condition-name">{c}</div>
            <div className="condition-value">{pct}%</div>
            <div className="condition-ci">
              CI {Math.round(r.ci_low * 100)}–{Math.round(r.ci_high * 100)} · n={r.n_simulated}
              <br />⌀ {r.mean_turns.toFixed(1)} turns
            </div>
          </div>
        );
      })}
    </div>
  );
}

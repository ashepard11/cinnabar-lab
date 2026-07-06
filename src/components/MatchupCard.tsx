import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Database } from 'sql.js';
import { allConditionsFor, type MatchupRow } from '../lib/matchupDb';
import ConditionCards from './ConditionCards';

/**
 * Expansion card for one A-vs-B matchup: the all-conditions grid plus a link
 * to the full detail page. Shared by the team builder's weakest-matchups
 * accordion and the Pokémon detail page's best/worst accordions; callers put
 * page-specific content (per-member tables, meta lines) in children, above
 * the grid.
 */
export default function MatchupCard({
  db, A, B, heading, children,
}: {
  db: Database;
  A: string;
  B: string;
  heading: string;
  children?: ReactNode;
}) {
  const rows = useMemo(() => {
    const byCondition = new Map<string, MatchupRow>();
    for (const r of allConditionsFor(db, A, B)) byCondition.set(r.condition, r);
    return byCondition;
  }, [db, A, B]);

  return (
    <div className="weak-card">
      {children}
      <h4 className="weak-card-subhead">{heading}</h4>
      <ConditionCards rows={rows} />
      <p className="weak-card-meta">
        <Link to={`/matchup/${A}/${B}`}>Full matchup detail →</Link>
      </p>
    </div>
  );
}

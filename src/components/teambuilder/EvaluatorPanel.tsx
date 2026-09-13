import {useState} from 'react';
import {useDex} from '../../lib/useDex';
import EvalSection from '../evaluator/EvalSection';
import TypeMatrix from '../evaluator/TypeMatrix';
import BoardControlTable from '../evaluator/BoardControlTable';
import RngExposure from '../evaluator/RngExposure';
import RelevantBst from '../evaluator/RelevantBst';
import DamageMarimekko from '../evaluator/DamageMarimekko';
import WorstMatchups from '../evaluator/WorstMatchups';
import type {ParsedSet} from '../../../lib/evaluator/parse';

/**
 * The team evaluator, embedded in the Build screen.
 *
 * These are the evaluator's own components, not copies. The teambuilder and
 * the evaluator answer overlapping questions about a roster, and maintaining
 * two type matrices or two board-control tables would guarantee they drift —
 * SPEC-teambuilder.md and BACKLOG item 08 both say to share them.
 *
 * Collapsed by default. While building, the candidate list is the thing being
 * read; the composition check is what you turn to when a slot choice feels
 * wrong, so it lives one click away on the same screen rather than behind a
 * navigation step that loses the partial team.
 */
export default function EvaluatorPanel({sets}: {sets: ParsedSet[]}) {
  const [open, setOpen] = useState(false);
  const {dex, error} = useDex();

  if (sets.length === 0) return null;

  return (
    <section className="evaluator-panel">
      <button type="button" className="evaluator-toggle" onClick={() => setOpen((o) => !o)}>
        <span className={open ? 'caret open' : 'caret'} aria-hidden="true">
          ▸
        </span>
        Team composition
        <span className="muted">
          {' '}
          — type coverage, board control, RNG exposure and stat totals for the{' '}
          {sets.length} Pokémon picked so far
        </span>
      </button>

      {open && (
        <div className="evaluator-body">
          {error && <p className="error">Failed to load the dex: {error}</p>}
          {!dex && !error && <p className="muted">Loading the dex…</p>}
          {dex && (
            <>
              <EvalSection
                title="Worst matchups"
                subtitle="Metagame-weighted, lexicographic on best and second-best coverage. The same ranking the candidate list uses."
              >
                <WorstMatchups sets={sets} />
              </EvalSection>
              <EvalSection
                title="Type matchups"
                subtitle="Attacking types against this team's defensive typings, and the team's offensive reach in reverse. Ability-aware."
              >
                <TypeMatrix dex={dex} sets={sets} />
              </EvalSection>
              <EvalSection
                title="Board control"
                subtitle="What the team has for speed, weather, terrain, targeting, mitigation, pivoting and option control."
              >
                <BoardControlTable dex={dex} sets={sets} />
              </EvalSection>
              <EvalSection
                title="RNG exposure"
                subtitle="Rolls the team wants to hit, and rolls it needs not to miss."
              >
                <RngExposure dex={dex} sets={sets} />
              </EvalSection>
              <EvalSection
                title="Relevant stat totals"
                subtitle="Stats excluded where unused — Attack on a Pokémon with no physical moves, and so on."
              >
                <RelevantBst dex={dex} sets={sets} />
              </EvalSection>
              <EvalSection
                title="Damage sources"
                subtitle="Where this team's damage comes from, by attack type and category."
              >
                <DamageMarimekko dex={dex} sets={sets} />
              </EvalSection>
            </>
          )}
        </div>
      )}
    </section>
  );
}

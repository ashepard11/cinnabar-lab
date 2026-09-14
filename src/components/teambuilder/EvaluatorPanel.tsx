import {useState} from 'react';
import {useDex} from '../../lib/useDex';
import TypeMatrix from '../evaluator/TypeMatrix';
import BoardControlTable from '../evaluator/BoardControlTable';
import RngExposure from '../evaluator/RngExposure';
import RelevantBst from '../evaluator/RelevantBst';
import DamageMarimekko from '../evaluator/DamageMarimekko';
import WorstMatchups from '../evaluator/WorstMatchups';
import type {ParsedSet} from '../../../lib/evaluator/parse';
import type {EvaluatorDex} from '../../../lib/evaluator/dex';

type SectionId = 'worst' | 'types' | 'board' | 'rng' | 'bst' | 'damage';

const SECTIONS: Array<{id: SectionId; label: string; blurb: string}> = [
  {
    id: 'worst',
    label: 'Worst matchups',
    blurb: 'Metagame-weighted, lexicographic on best and second-best coverage — the same ranking the candidate list uses.',
  },
  {
    id: 'types',
    label: 'Type coverage',
    blurb: "Attacking types against this team's defensive typings, and its offensive reach in reverse. Ability-aware.",
  },
  {
    id: 'board',
    label: 'Board control',
    blurb: 'Speed, weather, terrain, targeting, mitigation, pivoting and option control across the roster.',
  },
  {
    id: 'rng',
    label: 'RNG exposure',
    blurb: 'Rolls the team wants to hit, and rolls it needs not to miss.',
  },
  {
    id: 'bst',
    label: 'Stat totals',
    blurb: 'Stats excluded where unused — Attack on a Pokémon with no physical moves, and so on.',
  },
  {
    id: 'damage',
    label: 'Damage sources',
    blurb: "Where this team's damage comes from, by attack type and category.",
  },
];

function Section({id, dex, sets}: {id: SectionId; dex: EvaluatorDex; sets: ParsedSet[]}) {
  switch (id) {
    case 'worst':
      return <WorstMatchups sets={sets} />;
    case 'types':
      return <TypeMatrix dex={dex} sets={sets} />;
    case 'board':
      return <BoardControlTable dex={dex} sets={sets} />;
    case 'rng':
      return <RngExposure dex={dex} sets={sets} />;
    case 'bst':
      return <RelevantBst dex={dex} sets={sets} />;
    case 'damage':
      return <DamageMarimekko dex={dex} sets={sets} />;
  }
}

/**
 * The team evaluator, embedded between the team strip and the candidate list.
 *
 * These are the evaluator's own components, not copies — the two projects
 * answer overlapping questions about a roster, and two type matrices would
 * guarantee they drift.
 *
 * One section at a time rather than a single expand-everything toggle: six
 * full-width panels between the team and the candidates would push the list
 * off the screen, and a user checking type coverage is not simultaneously
 * checking RNG exposure. Clicking the open section closes it.
 */
export default function EvaluatorPanel({sets}: {sets: ParsedSet[]}) {
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const {dex, error} = useDex();

  if (sets.length === 0) return null;

  const active = SECTIONS.find((s) => s.id === openSection);

  return (
    <section className="evaluator-panel">
      <div className="evaluator-bar">
        <span className="evaluator-bar-label">
          Team composition <span className="muted">({sets.length} picked)</span>
        </span>
        <div className="evaluator-buttons">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              title={s.blurb}
              aria-pressed={openSection === s.id}
              className={openSection === s.id ? 'active' : ''}
              onClick={() => setOpenSection((cur) => (cur === s.id ? null : s.id))}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {active && (
        <div className="evaluator-body">
          <p className="evaluator-blurb">{active.blurb}</p>
          {error && <p className="error">Failed to load the dex: {error}</p>}
          {!dex && !error && <p className="muted">Loading the dex…</p>}
          {dex && <Section id={active.id} dex={dex} sets={sets} />}
        </div>
      )}
    </section>
  );
}

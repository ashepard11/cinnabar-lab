import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDex } from '../lib/useDex';
import TeamInput from '../components/evaluator/TeamInput';
import EvalSection from '../components/evaluator/EvalSection';
import TypeMatrix from '../components/evaluator/TypeMatrix';
import WorstMatchups from '../components/evaluator/WorstMatchups';
import BoardControlTable from '../components/evaluator/BoardControlTable';
import DamageMarimekko from '../components/evaluator/DamageMarimekko';
import OffensiveCoverage from '../components/evaluator/OffensiveCoverage';
import RngExposure from '../components/evaluator/RngExposure';
import RelevantBst from '../components/evaluator/RelevantBst';
import {
  decodeTeam, encodeTeam, exportTeam, parseTeam,
} from '../../lib/evaluator/parse';
import type { ParsedSet, ParseFailure } from '../../lib/evaluator/parse';
import type { EvaluatorDex } from '../../lib/evaluator/dex';

const STORAGE_KEY = 'team-evaluator:team';

/** The Phase 4 fixture team (same sets as scripts/test-evaluator.ts). */
const EXAMPLE_TEAM = `
Garchomp @ Life Orb
Ability: Rough Skin
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Protect

Kingambit @ Black Glasses
Ability: Defiant
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Sucker Punch
- Kowtow Cleave
- Iron Head
- Swords Dance

Incineroar
Ability: Intimidate
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Parting Shot
- U-turn

Charizard @ Charizardite Y
Ability: Blaze
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Heat Wave
- Solar Beam
- Overheat
- Protect

Rotom-Wash @ Sitrus Berry
Ability: Levitate
EVs: 252 HP / 252 SpA
Modest Nature
- Hydro Pump
- Thunderbolt
- Will-O-Wisp
- Protect

Whimsicott @ Focus Sash
Ability: Prankster
EVs: 252 HP / 252 Spe
Timid Nature
- Tailwind
- Moonblast
- Encore
- Icy Wind
`;

/**
 * Re-derive the whole team through export → parse so every edit flows through
 * the single validation path (mega formes, warnings, canonical names).
 */
function normalize(sets: ParsedSet[], dex: EvaluatorDex): ParsedSet[] {
  return parseTeam(exportTeam(sets), dex).sets;
}

export default function TeamEvaluatorPage() {
  const { dex, error } = useDex();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sets, setSets] = useState<ParsedSet[]>([]);
  const [failures, setFailures] = useState<ParseFailure[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Initial load: ?team= wins over localStorage.
  useEffect(() => {
    if (!dex || loaded) return;
    const fromUrl = searchParams.get('team');
    const encoded = fromUrl ?? localStorage.getItem(STORAGE_KEY);
    if (encoded) {
      const parsed = decodeTeam(encoded, dex);
      setSets(parsed.sets);
      setFailures(parsed.failures);
    }
    setLoaded(true);
  }, [dex, loaded, searchParams]);

  // Persist every change to the URL (shareable) and localStorage (durable).
  const replaceTeam = (next: ParsedSet[], nextFailures: ParseFailure[]) => {
    if (!dex) return;
    const normalized = normalize(next, dex);
    // keep pre-normalization invalid-move strikethroughs from a fresh paste
    for (let i = 0; i < normalized.length; i++) {
      if (next[i] && next[i].species === normalized[i].species) {
        normalized[i].invalidMoves = next[i].invalidMoves;
      }
    }
    setSets(normalized);
    setFailures(nextFailures);
    const encoded = normalized.length ? encodeTeam(normalized) : null;
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (encoded) p.set('team', encoded); else p.delete('team');
      return p;
    }, { replace: true });
    if (encoded) localStorage.setItem(STORAGE_KEY, encoded);
    else localStorage.removeItem(STORAGE_KEY);
  };

  const loadExample = () => {
    if (!dex) return;
    const parsed = parseTeam(EXAMPLE_TEAM, dex);
    replaceTeam(parsed.sets, parsed.failures);
  };

  const hasTeam = sets.length > 0;

  const body = useMemo(() => {
    if (!hasTeam || !dex) return null;
    return (
      <>
        <EvalSection
          title="Worst matchups"
          subtitle="The opponents this team has the fewest good answers to, weighted by how common each opponent is."
        >
          <WorstMatchups sets={sets} />
        </EvalSection>
        <EvalSection
          title="Defensive type matchups"
          subtitle="Multipliers account for each Pokémon's ability (dot-marked cells; hover for the unmodified value); items are not."
        >
          <TypeMatrix dex={dex} sets={sets} />
        </EvalSection>
        <EvalSection
          title="Damage sources"
          subtitle="Average damage of one clean hit from each move into a neutral bulky target, spread moves ×1.5."
        >
          <DamageMarimekko dex={dex} sets={sets} />
          <h3 className="cov-subhead">Coverage — best hit into each defending type</h3>
          <p className="footer-note" style={{ margin: '0 0 10px' }}>
            Each Pokémon's best damaging move against a single-typed defender, hardest-to-hit types first. Hover a row for the Pokémon in each category.
          </p>
          <OffensiveCoverage dex={dex} sets={sets} />
        </EvalSection>
        <EvalSection
          title="Board control"
          subtitle="Dimmed tools need a field state (sun, terrain, …) that no team member provides."
        >
          <BoardControlTable dex={dex} sets={sets} />
        </EvalSection>
        <EvalSection title="RNG exposure">
          <RngExposure dex={dex} sets={sets} />
        </EvalSection>
        <EvalSection
          title="Relevant BST"
          subtitle="Base-stat totals excluding stats each set demonstrably doesn't use (struck through)."
        >
          <RelevantBst dex={dex} sets={sets} />
        </EvalSection>
      </>
    );
  }, [hasTeam, dex, sets]);

  if (error) return <div className="error-note">Could not load the Champions dex — {error}</div>;
  if (!dex || !loaded) return <div className="loading">Loading Champions dex…</div>;

  return (
    <div>
      <h1>Team evaluator</h1>
      <p className="subtitle">
        Paste a team (Showdown export format) or build one manually.
      </p>

      <div className="team-roster-sticky">
        <TeamInput
          dex={dex}
          sets={sets}
          failures={failures}
          onReplace={replaceTeam}
          onExampleTeam={loadExample}
        />
      </div>

      {!hasTeam && (
        <p className="footer-note">
          No team yet — paste one above, or load the example team to see every
          section populated.
        </p>
      )}

      {body}
    </div>
  );
}

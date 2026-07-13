import { rngExposure, noFavorableRng } from '../../../lib/evaluator/rng';
import type { RngEntry } from '../../../lib/evaluator/rng';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet } from '../../../lib/evaluator/parse';
import { setLabel } from './TeamInput';

function Bucket({
  title, entries, sets,
}: {
  title: string;
  entries: RngEntry[];
  sets: ParsedSet[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="rng-bucket">
      <h4>{title} <span className="rng-count">{entries.length}</span></h4>
      <ul>
        {entries.map((e, i) => (
          <li key={i} className={e.struck ? 'rng-struck' : ''}>
            <span className="rng-member">{setLabel(sets[e.memberIndex])}</span>
            {' '}{e.struck ? <s>{e.source} — {e.detail}</s> : <>{e.source} — {e.detail}</>}
            {e.struck && <span className="rng-note"> Sheer Force: traded for power</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RngExposure({ dex, sets }: { dex: EvaluatorDex; sets: ParsedSet[] }) {
  const rng = rngExposure(dex, sets);
  const unfavorableCount =
    rng.unfavorable.accUnder80.length + rng.unfavorable.acc80to89.length +
    rng.unfavorable.acc90to99.length + rng.unfavorable.crash.length +
    rng.unfavorable.ohko.length + rng.unfavorable.selfLock.length;

  return (
    <div className="rng-exposure">
      <div className="rng-columns">
        <div>
          <h3>Favorable — variance the team can exploit</h3>
          {noFavorableRng(rng) ? (
            <p className="rng-callout">
              No proactive RNG upside — this team has no crit boosts, wanted
              secondaries, or sleep RNG, so it needs every roll to go its way.
            </p>
          ) : (
            <>
              <Bucket title="Enhanced crits" entries={rng.favorable.crits} sets={sets} />
              <Bucket title="Wanted secondaries" entries={rng.favorable.secondaries} sets={sets} />
              <Bucket title="Sleep RNG" entries={rng.favorable.sleep} sets={sets} />
            </>
          )}
        </div>
        <div>
          <h3>Unfavorable — variance the team must survive</h3>
          {unfavorableCount === 0 ? (
            <p className="rng-callout rng-good">
              No accuracy risk, crash moves, or self-locking moves — the team's
              own turns are deterministic.
            </p>
          ) : (
            <>
              <Bucket title="Accuracy < 80" entries={rng.unfavorable.accUnder80} sets={sets} />
              <Bucket title="Accuracy 80–89" entries={rng.unfavorable.acc80to89} sets={sets} />
              <Bucket title="Accuracy 90–99" entries={rng.unfavorable.acc90to99} sets={sets} />
              <Bucket title="Crash on miss" entries={rng.unfavorable.crash} sets={sets} />
              <Bucket title="OHKO moves" entries={rng.unfavorable.ohko} sets={sets} />
              <Bucket title="Self-locking" entries={rng.unfavorable.selfLock} sets={sets} />
            </>
          )}
        </div>
      </div>
      {rng.notes.map((n, i) => <p key={i} className="footer-note">{n}</p>)}
      <p className="footer-note">
        Counts are per move slot, with per-use probabilities — deliberately no
        combined "RNG score"; a flinch chance and a miss chance don't add.
      </p>
    </div>
  );
}

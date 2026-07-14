import { relevantBst } from '../../../lib/evaluator/bst';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet } from '../../../lib/evaluator/parse';
import type { StatID } from '../../../lib/types';
import { setLabel } from './TeamInput';

const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABELS: Record<StatID, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

export default function RelevantBst({ dex, sets }: { dex: EvaluatorDex; sets: ParsedSet[] }) {
  const report = relevantBst(dex, sets);
  return (
    <div className="bst">
      <div className="bst-averages">
        <div className="condition-card">
          <div className="condition-name">team average{report.hasTrickRoomSetter ? ' (with Speed)' : ''}</div>
          <div className="condition-value">{Math.round(report.averageWithSpeed)}</div>
        </div>
        {report.hasTrickRoomSetter && (
          <div className="condition-card">
            <div className="condition-name">without Speed (Trick Room on the team)</div>
            <div className="condition-value">{Math.round(report.averageWithoutSpeed)}</div>
            <div className="condition-ci">Speed's value is ambiguous under Trick Room — compare both</div>
          </div>
        )}
      </div>
      <table className="bst-table">
        <thead>
          <tr>
            <th />
            {STAT_IDS.map((s) => <th key={s}>{STAT_LABELS[s]}</th>)}
            <th>relevant total</th>
          </tr>
        </thead>
        <tbody>
          {report.members.map((m, i) => (
            <tr key={i}>
              <th className="bst-member">{setLabel(sets[i])}</th>
              {STAT_IDS.map((s) => (
                <td
                  key={s}
                  className={m.perStat[s].included ? '' : 'bst-excluded'}
                  title={m.perStat[s].note}
                >
                  {m.perStat[s].included ? m.perStat[s].value : <s>{m.perStat[s].value}</s>}
                </td>
              ))}
              <td className="bst-total">
                {m.totalWithSpeed}
                {report.hasTrickRoomSetter && <span className="bst-nospeed"> / {m.totalWithoutSpeed}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.members.flatMap((m, i) =>
        [...m.notes, ...STAT_IDS.map((s) => m.perStat[s].note).filter(Boolean)]
          .map((n, j) => (
            <p key={`${i}-${j}`} className="footer-note">
              {setLabel(sets[i])}: {n}
            </p>
          )),
      )}
    </div>
  );
}

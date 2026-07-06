import { CONDITION_IDS, type ConditionId } from '../lib/matchupDb';

/** The condition filter shared by the matchups, Pokémon, and team-builder pages. */
export default function ConditionSelect({
  value,
  onChange,
}: {
  value: ConditionId;
  onChange: (c: ConditionId) => void;
}) {
  return (
    <label>
      Condition{' '}
      <select value={value} onChange={(e) => onChange(e.target.value as ConditionId)}>
        {CONDITION_IDS.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

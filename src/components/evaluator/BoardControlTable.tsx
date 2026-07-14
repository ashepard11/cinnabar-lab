import { boardControl } from '../../../lib/evaluator/tags';
import type { Tag } from '../../../lib/evaluator/tags';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet } from '../../../lib/evaluator/parse';
import { setLabel } from './TeamInput';

function TagChip({ tag }: { tag: Tag }) {
  const title = [
    tag.annotation,
    tag.dimmed ? 'needs a field state this team does not provide' : null,
  ].filter(Boolean).join(' — ');
  return (
    <span className={`bc-tag bc-${tag.kind}${tag.dimmed ? ' bc-dimmed' : ''}`} title={title || undefined}>
      {tag.name}
      {tag.annotation && <span className="bc-annotation"> {tag.annotation}</span>}
    </span>
  );
}

function Cell({ tags, categoryId }: { tags: Tag[]; categoryId: string }) {
  if (tags.length === 0) {
    return (
      <td className="bc-cell bc-empty">
        {categoryId === 'protect' ? <span className="bc-noprotect">no Protect</span> : '—'}
      </td>
    );
  }
  // group by sub-group, preserving first-seen order
  const groups = new Map<string, Tag[]>();
  for (const t of tags) {
    if (!groups.has(t.subGroup)) groups.set(t.subGroup, []);
    groups.get(t.subGroup)!.push(t);
  }
  return (
    <td className="bc-cell">
      {[...groups.entries()].map(([sub, group]) => (
        <div key={sub} className="bc-group">
          {groups.size > 1 && <span className="bc-subgroup">{sub}: </span>}
          {group.map((t, i) => <TagChip key={`${t.name}-${i}`} tag={t} />)}
        </div>
      ))}
    </td>
  );
}

export default function BoardControlTable({ dex, sets }: { dex: EvaluatorDex; sets: ParsedSet[] }) {
  const inventory = boardControl(dex, sets);
  return (
    <div className="bc-scroll">
      <table className="bc-table">
        <thead>
          <tr>
            <th />
            {sets.map((s, i) => <th key={i} className="tm-member">{setLabel(s)}</th>)}
          </tr>
        </thead>
        <tbody>
          {inventory.map((catRow) => (
            <tr key={catRow.id}>
              <th className="bc-category" title={catRow.description}>{catRow.label}</th>
              {catRow.perMember.map((tags, i) => <Cell key={i} tags={tags} categoryId={catRow.id} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

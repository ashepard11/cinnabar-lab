import { boardControl } from '../../../lib/evaluator/tags';
import type { CategoryId, Tag } from '../../../lib/evaluator/tags';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet } from '../../../lib/evaluator/parse';
import { setLabel } from './TeamInput';

/**
 * Display consolidation of the 10 underlying board-control categories into 5
 * rows (DECISIONS.md D38.3). The lib inventory is unchanged; regrouping —
 * including moving Wide/Quick Guard from option control into Protects — is
 * purely presentational.
 */
type RowId = 'speed' | 'field' | 'option' | 'defense' | 'protect';

const ROWS: Array<{ id: RowId; label: string; description: string; sources: CategoryId[] }> = [
  {
    id: 'speed', label: 'Speed control', sources: ['speed', 'priority'],
    description: 'Speed drops, Tailwind, Trick Room, paralysis, priority moves, speed abilities.',
  },
  {
    id: 'field', label: 'Field effects', sources: ['weather', 'terrain'],
    description: 'Weather and terrain setters, removal, and neutralizers.',
  },
  {
    id: 'option', label: 'Option control', sources: ['targeting', 'option'],
    description: 'Redirection, Fake Out pressure, Encore-class denial, blocking abilities.',
  },
  {
    id: 'defense', label: 'Defensive tools', sources: ['mitigation', 'healing', 'pivoting'],
    description: 'Damage mitigation, healing, and pivoting.',
  },
  {
    id: 'protect', label: 'Protects', sources: ['protect'],
    description: 'Protect-class moves plus Wide and Quick Guard; members without one are flagged.',
  },
];

/** Final row for a tag: its source category's row, except guards → Protects. */
function rowOf(source: CategoryId, tag: Tag): RowId {
  if (source === 'option' && tag.subGroup === 'guards') return 'protect';
  return ROWS.find((r) => r.sources.includes(source))!.id;
}

const MAX_TOOLS_SHOWN = 4;

function ToolList({ tags }: { tags: Tag[] }) {
  const shown = tags.length > MAX_TOOLS_SHOWN ? tags.slice(0, MAX_TOOLS_SHOWN - 1) : tags;
  const rest = tags.slice(shown.length);
  return (
    <>
      {shown.map((t, i) => {
        const title = [
          t.annotation,
          t.dimmed ? 'needs a field state this team does not provide' : null,
        ].filter(Boolean).join(' — ');
        return (
          <span key={`${t.name}-${i}`}>
            {i > 0 && ', '}
            <span
              className={`bcx-tool bcx-${t.kind}${t.dimmed ? ' bc-dimmed' : ''}`}
              title={title || undefined}
            >
              {t.name}
            </span>
          </span>
        );
      })}
      {rest.length > 0 && (
        <span className="bcx-more" title={rest.map((t) => t.name).join(', ')}>
          {' '}+{rest.length} more
        </span>
      )}
    </>
  );
}

export default function BoardControlTable({ dex, sets }: { dex: EvaluatorDex; sets: ParsedSet[] }) {
  const inventory = boardControl(dex, sets);

  // perRow[rowId][memberIndex] = deduped tools that member contributes.
  const perRow: Record<RowId, Tag[][]> = {
    speed: sets.map(() => []), field: sets.map(() => []), option: sets.map(() => []),
    defense: sets.map(() => []), protect: sets.map(() => []),
  };
  for (const cat of inventory) {
    cat.perMember.forEach((tags, si) => {
      for (const tag of tags) {
        const bucket = perRow[rowOf(cat.id, tag)][si];
        if (!bucket.some((t) => t.name === tag.name)) bucket.push(tag);
      }
    });
  }

  return (
    <div className="bcx">
      {ROWS.map(({ id, label, description }) => {
        const members = perRow[id]
          .map((tags, si) => ({ tags, si }))
          .filter(({ tags }) => tags.length > 0);
        // A tool that needs an unavailable field state isn't usable — dimmed-only
        // members are listed but not counted (D38.3).
        const usable = members.filter(({ tags }) => tags.some((t) => !t.dimmed));
        const missingProtect = id === 'protect'
          ? sets.map((s, si) => ({ s, si })).filter(({ si }) => perRow.protect[si].length === 0)
          : [];
        return (
          <div key={id} className="bcx-row">
            <div className="bcx-label" title={description}>{label}</div>
            <div className="bcx-count">
              {usable.length}<span className="bcx-of"> / {sets.length}</span>
            </div>
            <div className="bcx-detail">
              {members.length === 0 && <span className="bcx-none">none</span>}
              {members.map(({ tags, si }) => (
                <span key={si} className="bcx-member">
                  <span className="bcx-name">{setLabel(sets[si])}:</span>{' '}
                  <ToolList tags={tags} />
                </span>
              ))}
              {missingProtect.length > 0 && (
                <span className="bcx-missing">
                  no Protect: {missingProtect.map(({ s }) => setLabel(s)).join(', ')}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

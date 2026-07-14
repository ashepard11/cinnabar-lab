import { useEffect, useMemo, useState } from 'react';
import Marimekko from '../Marimekko';
import type { EvaluatorDex } from '../../../lib/evaluator/dex';
import type { ParsedSet } from '../../../lib/evaluator/parse';

type DamageModule = typeof import('../../../lib/evaluator/damage');

/**
 * Team-local "damage sources" view: the viz-1 Marimekko computed in the
 * browser over the pasted team (one clean hit vs the standard neutral target,
 * unweighted — the team's four moves are certainties, not usage frequencies).
 *
 * The damage module transitively bundles @smogon/calc (~130 KB gzipped), so
 * it is loaded as a split chunk on first render rather than in the app entry.
 */
export default function DamageMarimekko({ sets }: { dex: EvaluatorDex; sets: ParsedSet[] }) {
  const [mod, setMod] = useState<DamageModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    import('../../../lib/evaluator/damage').then(setMod).catch((e) => setLoadError(String(e)));
  }, []);

  const ds = useMemo(() => (mod ? mod.teamDamageSources(sets) : null), [mod, sets]);

  if (loadError) return <div className="error-note">Could not load the damage calc — {loadError}</div>;
  if (!ds) return <div className="loading">Loading damage calc…</div>;
  if (ds.viz.cells.length === 0) {
    return <p className="footer-note">No damaging moves on this team — nothing to chart.</p>;
  }
  return (
    <div>
      <Marimekko data={ds.viz} segmentLabels="name" />
      {ds.flagged.length > 0 && (
        <p className="footer-note">
          Undercounted (base power depends on battle state): {ds.flagged.join(', ')}.
        </p>
      )}
      {ds.skipped.length > 0 && (
        <p className="footer-note">
          Not charted: {ds.skipped.map((s) => `${s.move} (${s.reason})`).join('; ')}.
        </p>
      )}
    </div>
  );
}

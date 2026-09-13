import {useEffect, useState} from 'react';
import {fetchJSON} from '../lib';
import {loadMatchupDb, metadata, allVariantIds} from '../lib/matchupDb';
import {
  REGULATIONS,
  activeRegulationConfig,
  isSourceable,
  type RegulationId,
} from '../../lib/format-rules';
import type {VariantsData} from '../../lib/types';

const ACTIVE = activeRegulationConfig();

interface FormatRulesFile {
  regulation_id: string;
  generated_at: string;
  legality_format: string;
  sim_format: string;
  legal_species: string[];
  legal_items: string[];
  mega_capable: [string, string][];
  sourced_clauses: {
    team_size: number;
    bring_count: number;
    level: number;
    item_clause: boolean;
    species_clause: boolean;
  };
}

function ago(iso: string | undefined): string {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * Data status (SPEC-teambuilder.md Phase 1).
 *
 * Active regulation, when the usage data was scraped, when the matrix was
 * built, and which variants are stale. Unlike the other Phase 1 screens this
 * one runs entirely on real data — the regulation registry, the committed
 * variants file, the resolved format rules and the matrix metadata all exist
 * already, so there is nothing to fixture.
 *
 * It earns its place early because the staleness it surfaces is real right
 * now: the matrix was built against a variant set the weekly refresh has
 * since moved, and that discrepancy was previously visible only by running
 * `npm run verify-matchups` from a terminal.
 */
export default function DataStatusPage() {
  const [variants, setVariants] = useState<VariantsData | null>(null);
  const [rules, setRules] = useState<FormatRulesFile | null>(null);
  const [matrix, setMatrix] = useState<{meta: Record<string, string>; ids: string[]} | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    fetchJSON<VariantsData>('defender-variants.json')
      .then(setVariants)
      .catch((e) => setErrors((x) => [...x, `variants: ${e}`]));
    fetchJSON<FormatRulesFile>(`format-rules-${ACTIVE.regulation_id}.json`)
      .then(setRules)
      .catch((e) => setErrors((x) => [...x, `format rules: ${e}`]));
    loadMatchupDb()
      .then((db) => setMatrix({meta: metadata(db), ids: allVariantIds(db)}))
      .catch((e) => setErrors((x) => [...x, `matrix: ${e}`]));
  }, []);

  // The staleness that matters: variants the matrix has never seen, and
  // variants the matrix still holds rows for that no longer exist.
  const currentIds = new Set((variants?.variants ?? []).map((v) => v.id));
  const matrixIds = new Set(matrix?.ids ?? []);
  const unsimulated = [...currentIds].filter((id) => !matrixIds.has(id));
  const orphaned = [...matrixIds].filter((id) => !currentIds.has(id));
  const matrixRegulation = matrix?.meta.regulation ?? 'M-B (predates the stamp)';

  return (
    <div className="page data-status">
      <header className="page-head">
        <h1>Data status</h1>
        <p className="subtitle">
          What the analysis is currently built from, and where it has drifted.
          This page reads the committed data directly — nothing here is fixture.
        </p>
      </header>

      {errors.map((e) => (
        <p key={e} className="error">Failed to load {e}</p>
      ))}

      <section>
        <h2>Regulation</h2>
        <div className="status-grid">
          {(Object.keys(REGULATIONS) as RegulationId[]).map((id) => {
            const r = REGULATIONS[id];
            const active = id === ACTIVE.regulation_id;
            const sourceable = isSourceable(r);
            return (
              <div key={id} className={`regulation-card${active ? ' active' : ''}`}>
                <div className="regulation-head">
                  <strong>{id}</strong>
                  {active && <span className="badge-active">active</span>}
                  {!sourceable && <span className="badge-warn">no data</span>}
                </div>
                <p className="muted">
                  {r.active_from} → {r.active_until ?? 'current'}
                </p>
                <dl>
                  <dt>Legality</dt>
                  <dd>{r.legality_format ?? '—'}</dd>
                  <dt>Simulated in</dt>
                  <dd>{r.sim_format ?? '—'}</dd>
                  <dt>Usage source</dt>
                  <dd>{r.pikalytics_format ?? '—'}</dd>
                </dl>
                {!sourceable && (
                  <p className="regulation-note">
                    The vendored Showdown build predates this regulation, so its
                    legality cannot be resolved. Switching to it needs a
                    re-vendor, which bumps the engine version and invalidates
                    the matrix.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="muted switch-note">
          Switching regulation is a configuration change — set{' '}
          <code>CHAMPIONS_REGULATION</code> and rebuild. A selector here needs
          more than one regulation to have data, so it stays a note until the
          M-C migration lands.
        </p>
      </section>

      <section>
        <h2>Usage data and variants</h2>
        {variants ? (
          <dl className="status-list">
            <dt>Regulation</dt>
            <dd>{variants.regulation ?? 'unstated (pre-v3 file)'}</dd>
            <dt>Schema</dt>
            <dd>v{variants.schema_version}</dd>
            <dt>Generated</dt>
            <dd>
              {variants.generated_at.slice(0, 10)} <span className="muted">({ago(variants.generated_at)})</span>
            </dd>
            <dt>Variants</dt>
            <dd>
              {variants.variants.length}
              <span className="muted">
                {' '}
                — {variants.variants.filter((v) => v.tier === 'core').length} core,{' '}
                {variants.variants.filter((v) => v.tier === 'extended').length} extended
              </span>
            </dd>
          </dl>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </section>

      <section>
        <h2>Format rules</h2>
        {rules ? (
          <dl className="status-list">
            <dt>Resolved from</dt>
            <dd>
              {rules.legality_format} <span className="muted">(doubles — legality)</span>
            </dd>
            <dt>Legal species</dt>
            <dd>{rules.legal_species.length}</dd>
            <dt>Legal items</dt>
            <dd>{rules.legal_items.length}</dd>
            <dt>Mega formes</dt>
            <dd>{rules.mega_capable.length}</dd>
            <dt>Team / bring</dt>
            <dd>
              {rules.sourced_clauses.team_size} / {rules.sourced_clauses.bring_count}
              <span className="muted"> — sourced from the format, not declared</span>
            </dd>
            <dt>Generated</dt>
            <dd>
              {rules.generated_at.slice(0, 10)} <span className="muted">({ago(rules.generated_at)})</span>
            </dd>
          </dl>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </section>

      <section>
        <h2>Matchup matrix</h2>
        {matrix ? (
          <>
            <dl className="status-list">
              <dt>Regulation</dt>
              <dd>{matrixRegulation}</dd>
              <dt>Built</dt>
              <dd>
                {matrix.meta.built_at?.slice(0, 10) ?? 'unknown'}{' '}
                <span className="muted">({ago(matrix.meta.built_at)})</span>
              </dd>
              <dt>Policy</dt>
              <dd>{matrix.meta.policy_id} @ {matrix.meta.policy_version}</dd>
              <dt>Engine</dt>
              <dd>{matrix.meta.engine_version}</dd>
              <dt>Format</dt>
              <dd>{matrix.meta.format}</dd>
              <dt>Variants covered</dt>
              <dd>{matrix.ids.length}</dd>
            </dl>

            {(unsimulated.length > 0 || orphaned.length > 0) && (
              <div className="stale-callout">
                <h3>The matrix is out of sync with the variant set</h3>
                {unsimulated.length > 0 && (
                  <p>
                    <strong>{unsimulated.length}</strong> current variant
                    {unsimulated.length === 1 ? ' has' : 's have'} no rows:{' '}
                    <span className="muted">{unsimulated.join(', ')}</span>
                  </p>
                )}
                {orphaned.length > 0 && (
                  <p>
                    <strong>{orphaned.length}</strong> variant
                    {orphaned.length === 1 ? '' : 's'} in the matrix no longer
                    exist{orphaned.length === 1 ? 's' : ''}:{' '}
                    <span className="muted">{orphaned.join(', ')}</span>
                  </p>
                )}
                <p className="muted">
                  The weekly refresh regenerates usage and variants but not the
                  matrix. Rebuilding it is hours of compute, so it is worth
                  batching with the other changes that invalidate it — see the
                  note in BACKLOG.md.
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="muted">Loading the matrix…</p>
        )}
      </section>
    </div>
  );
}

/**
 * scripts/test-refresh.ts — incremental matrix refresh (BACKLOG item 03).
 *
 * Run: npm run test-refresh
 *
 * Everything runs against a temporary database built in this file, so the test
 * is hermetic and fast. Variants are supplied with their `cid` already set,
 * which keeps the whole suite free of the Showdown dex — `variantCid` itself is
 * covered by scripts/test-variant-cid.ts, and what is under test here is the
 * arithmetic over identities, not how the identities are computed.
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureSchema, upsertRun, SCHEMA_VERSION } from '../lib/analysis/schema';
import {
  diffVariants, planRefresh, pendingUnits, prune, readRuns,
} from '../lib/analysis/refresh';
import type { RunVersions } from '../lib/analysis/schema';
import type { Variant } from '../lib/types';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const section = (s: string) => console.log(`\n${s}\n`);

const CONDITIONS = ['fresh', 'trick_room'] as const;

const VERSIONS: RunVersions = {
  regulation: 'M-B',
  policy_id: 'nash-d2',
  policy_version: '1.0.0',
  calc_version: '0.11.0 (test)',
  engine_version: '1.0.0',
};

/** A variant stub carrying an explicit cid, so nothing has to hash a real set. */
function v(slug: string, cid: string, weight = 0.1): Variant {
  return {
    id: slug,
    cid,
    species: 'Pikachu',
    is_mega: false,
    item: null,
    ability: 'Static',
    nature: 'Hardy',
    sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 },
    weight,
    moves: [],
  } as unknown as Variant;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-test-'));
const dbPath = (name: string) => path.join(tmpDir, `${name}.sqlite`);

/** A database with `variants` rows and a complete matrix over them. */
function seeded(name: string, variants: Variant[], versions = VERSIONS): {
  db: DatabaseSync;
  runId: number;
} {
  const db = new DatabaseSync(dbPath(name));
  ensureSchema(db);
  const runId = upsertRun(db, versions);
  // Insert variant rows directly rather than through syncVariants, which
  // resolves each spec against the Showdown dex. The cids are the whole point
  // here and they are given, so the dex would only slow the suite down.
  const vstmt = db.prepare(
    'INSERT OR REPLACE INTO variants (cid, slug, spec, current) VALUES (?, ?, ?, 1)',
  );
  for (const variant of variants) vstmt.run(variant.cid!, variant.id, '{}');
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
    .run('current_run_id', String(runId));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO matchups
      (variant_A_cid, variant_B_cid, condition, run_id, n_simulated, wins_A, wins_B, draws,
       p_A_wins, ci_low, ci_high, mean_turns, generated_at)
    VALUES (?, ?, ?, ?, 200, 100, 100, 0, 0.5, 0.4, 0.6, 12.0, 'now')
  `);
  for (let i = 0; i < variants.length; i++) {
    for (let j = 0; j < variants.length; j++) {
      if (i === j) continue;
      for (const c of CONDITIONS) insert.run(variants[i].cid!, variants[j].cid!, c, runId);
    }
  }
  return { db, runId };
}

// ---------------------------------------------------------------------------
section('Variant diff');

{
  const known = new Map([
    ['cid_a', 'alpha'],
    ['cid_b', 'bravo'],
    ['cid_c', 'charlie'],
    ['cid_d_old', 'delta'],
  ]);
  const incoming = [
    v('alpha', 'cid_a'),
    v('bravo_renamed', 'cid_b'),
    v('delta', 'cid_d_new'),
    v('echo', 'cid_e'),
  ];
  const d = diffVariants(known, incoming);

  check('unchanged cids are reused regardless of slug',
    d.unchanged.map((x) => x.cid).sort().join(',') === 'cid_a,cid_b',
    d.unchanged.map((x) => x.slug).join(', '));
  check('a new cid is an addition',
    d.added.some((x) => x.cid === 'cid_e'), `${d.added.length} added`);
  check('a dropped cid is retired',
    d.retired.some((x) => x.cid === 'cid_c'), d.retired.map((x) => x.slug).join(', '));
  check('a slug rename costs nothing',
    d.renamed.length === 1 && d.renamed[0].from === 'bravo' && d.renamed[0].to === 'bravo_renamed');
  check('a changed battle set is reported as respecified, not as churn',
    d.respecified.length === 1 &&
      d.respecified[0].slug === 'delta' &&
      d.respecified[0].from_cid === 'cid_d_old' &&
      d.respecified[0].to_cid === 'cid_d_new');
  check('respecification still counts in added and retired',
    d.added.some((x) => x.cid === 'cid_d_new') && d.retired.some((x) => x.cid === 'cid_d_old'));
  check('every incoming variant lands in exactly one of added/unchanged',
    d.added.length + d.unchanged.length === incoming.length,
    `${d.added.length} + ${d.unchanged.length} = ${incoming.length}`);
}

// ---------------------------------------------------------------------------
section('Refresh planning');

{
  const before = [v('a', 'c_a'), v('b', 'c_b'), v('c', 'c_c')];
  const { db } = seeded('plan', before);

  // Unchanged set: nothing to do.
  const same = planRefresh(db, before, VERSIONS, CONDITIONS);
  check('an unchanged variant set needs no simulation',
    same.cells.to_simulate === 0 && !same.full_rebuild, same.reason);
  check('reuse is counted in cells, not rows',
    same.cells.reusable === 3 * CONDITIONS.length && same.cells.full === 3 * CONDITIONS.length,
    `${same.cells.reusable} reusable of ${same.cells.full}`);

  // One added variant: only pairs touching it cost anything.
  const grown = [...before, v('d', 'c_d')];
  const plan = planRefresh(db, grown, VERSIONS, CONDITIONS);
  check('adding one variant costs only the pairs involving it',
    plan.cells.to_simulate === 3 * CONDITIONS.length,
    `${plan.cells.to_simulate} cells (full build ${plan.cells.full})`);
  check('the pre-existing block is reused in full',
    plan.cells.reusable === 3 * CONDITIONS.length);
  check('a grown set is not a full rebuild', !plan.full_rebuild);

  // A dropped variant: its rows become orphans but nothing needs simulating.
  const shrunk = [v('a', 'c_a'), v('b', 'c_b')];
  const shrinkPlan = planRefresh(db, shrunk, VERSIONS, CONDITIONS);
  check('dropping a variant needs no simulation',
    shrinkPlan.cells.to_simulate === 0, shrinkPlan.reason);
  check('rows for the dropped variant are counted as orphans',
    shrinkPlan.orphan_rows === 4 * CONDITIONS.length,
    `${shrinkPlan.orphan_rows} orphan rows`);

  // A changed run key invalidates everything by design.
  const newPolicy = { ...VERSIONS, policy_version: '2.0.0' };
  const rebuild = planRefresh(db, before, newPolicy, CONDITIONS);
  check('a policy bump is a full rebuild', rebuild.full_rebuild && rebuild.run.run_id === null);
  check('a full rebuild reuses nothing',
    rebuild.cells.reusable === 0 && rebuild.cells.to_simulate === rebuild.cells.full,
    `${rebuild.cells.to_simulate} cells`);
  check('the rebuild reason names the run key, not the variants',
    rebuild.reason.includes('run key is new'));

  const engineBump = planRefresh(db, before, { ...VERSIONS, engine_version: '2.0.0' }, CONDITIONS);
  check('an engine bump is a full rebuild', engineBump.full_rebuild);
  const regBump = planRefresh(db, before, { ...VERSIONS, regulation: 'M-C' }, CONDITIONS);
  check('a regulation change is a distinct run rather than a conflict',
    regBump.full_rebuild && regBump.run.run_id === null, regBump.reason);

  // Rows from the old run stay put and are reported.
  upsertRun(db, newPolicy);
  const staleSeen = planRefresh(db, before, newPolicy, CONDITIONS);
  check('rows under other run keys are reported as stale, not deleted',
    staleSeen.stale_run_rows.length === 1 && staleSeen.stale_run_rows[0].rows === 6 * CONDITIONS.length,
    staleSeen.stale_run_rows.map((s) => `#${s.run_id}: ${s.rows}`).join(', '));

  db.close();
}

// ---------------------------------------------------------------------------
section('Work units');

{
  const before = [v('a', 'c_a'), v('b', 'c_b'), v('c', 'c_c')];
  const { db, runId } = seeded('units', before);

  check('a complete matrix yields no work',
    pendingUnits(db, before, runId, CONDITIONS).length === 0);

  const grown = [...before, v('d', 'c_d')];
  const units = pendingUnits(db, grown, runId, CONDITIONS);
  check('units cover exactly the missing pairs',
    units.length === 3 * CONDITIONS.length, `${units.length} units`);
  check('every unit involves the new variant',
    units.every((u) => u.aCid === 'c_d' || u.bCid === 'c_d'));
  check('units are unordered pairs — no cell is dispatched twice',
    new Set(units.map((u) => [u.aCid, u.bCid].sort().join('|') + u.condition)).size === units.length);
  check('units carry slugs for the worker and cids for the writer',
    units.every((u) => u.aSlug && u.bSlug && u.aCid && u.bCid));

  check('a null run id means everything is pending',
    pendingUnits(db, grown, null, CONDITIONS).length === 6 * CONDITIONS.length);

  // Half-finished build: deleting some rows should bring back exactly those.
  db.prepare('DELETE FROM matchups WHERE variant_A_cid = ? AND variant_B_cid = ? AND condition = ?')
    .run('c_a', 'c_b', 'fresh');
  check('a crashed build resumes from whatever rows survived',
    pendingUnits(db, before, runId, CONDITIONS).length === 1,
    'one cell missing, one cell pending');

  db.close();
}

// ---------------------------------------------------------------------------
section('Pruning');

{
  const all = [v('a', 'c_a'), v('b', 'c_b'), v('c', 'c_c')];
  const { db } = seeded('prune', all);
  const live = new Set(['c_a', 'c_b']);

  const rowsBefore = (db.prepare('SELECT COUNT(*) c FROM matchups').get() as any).c;
  const result = prune(db, live);
  const rowsAfter = (db.prepare('SELECT COUNT(*) c FROM matchups').get() as any).c;

  check('pruning removes every row touching a dead variant',
    rowsAfter === 2 * CONDITIONS.length,
    `${rowsBefore} -> ${rowsAfter} rows, ${result.rows_deleted} deleted`);
  check('pruning keeps every row between live variants',
    (db.prepare(
      'SELECT COUNT(*) c FROM matchups WHERE variant_A_cid IN (?, ?) AND variant_B_cid IN (?, ?)',
    ).get('c_a', 'c_b', 'c_a', 'c_b') as any).c === 2 * CONDITIONS.length);
  check('the dead variant record goes too',
    (db.prepare('SELECT COUNT(*) c FROM variants WHERE cid = ?').get('c_c') as any).c === 0);
  check('a run nothing references is removed',
    result.runs_deleted === 0 && (db.prepare('SELECT COUNT(*) c FROM sim_runs').get() as any).c === 1,
    'the only run still has rows, so it stays');
  check('pruning is idempotent', prune(db, live).rows_deleted === 0);
  db.close();
}

// ---------------------------------------------------------------------------
section('Schema v2 -> v3 upgrade');

{
  // Build a v2-shaped file by hand: sim_runs without the regulation column.
  const p = dbPath('v2');
  const db = new DatabaseSync(p);
  db.exec(`
    CREATE TABLE variants (cid TEXT PRIMARY KEY, slug TEXT NOT NULL, spec TEXT NOT NULL,
                           current INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sim_runs (
      run_id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_id TEXT NOT NULL, policy_version TEXT NOT NULL,
      calc_version TEXT NOT NULL, engine_version TEXT NOT NULL,
      UNIQUE (policy_id, policy_version, calc_version, engine_version));
    CREATE TABLE matchups (
      variant_A_cid TEXT NOT NULL, variant_B_cid TEXT NOT NULL, condition TEXT NOT NULL,
      run_id INTEGER NOT NULL, n_simulated INTEGER NOT NULL, wins_A INTEGER NOT NULL,
      wins_B INTEGER NOT NULL, draws INTEGER NOT NULL, p_A_wins REAL NOT NULL,
      ci_low REAL NOT NULL, ci_high REAL NOT NULL, mean_turns REAL NOT NULL,
      generated_at TEXT NOT NULL,
      PRIMARY KEY (variant_A_cid, variant_B_cid, condition, run_id));
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO sim_runs (run_id, policy_id, policy_version, calc_version, engine_version)
      VALUES (7, 'nash-d2', '1.0.0', '0.11.0 (test)', '1.0.0');
    INSERT INTO metadata (key, value) VALUES ('schema_version', '2'), ('current_run_id', '7');
    INSERT INTO matchups VALUES ('c_a','c_b','fresh',7,200,100,100,0,0.5,0.4,0.6,12.0,'now');
  `);

  // A v2 file with no regulation stamp: rows are M-B by construction.
  const runsBefore = readRuns(db);
  check('a v2 file reads as M-B before migration',
    runsBefore.length === 1 && runsBefore[0].regulation === 'M-B' && runsBefore[0].run_id === 7,
    `run #${runsBefore[0].run_id} / ${runsBefore[0].regulation}`);

  ensureSchema(db);

  const cols = (db.prepare('PRAGMA table_info(sim_runs)').all() as Array<{ name: string }>)
    .map((c) => c.name);
  check('the upgrade adds the regulation column', cols.includes('regulation'), cols.join(', '));
  check('run_id survives the table rebuild',
    (db.prepare('SELECT run_id, regulation FROM sim_runs').get() as any).run_id === 7,
    'matchup rows and current_run_id both point at it');
  check('existing rows keep pointing at their run',
    (db.prepare('SELECT COUNT(*) c FROM matchups WHERE run_id = 7').get() as any).c === 1);
  check('the schema version is stamped',
    (db.prepare('SELECT value FROM metadata WHERE key = ?').get('schema_version') as any).value
      === SCHEMA_VERSION, `v${SCHEMA_VERSION}`);
  check('the upgrade is idempotent',
    (() => { ensureSchema(db); return (db.prepare('SELECT COUNT(*) c FROM sim_runs').get() as any).c === 1; })());

  // With the column present, the same tuple under a second regulation is a
  // distinct run rather than a unique-constraint collision.
  const mc = upsertRun(db, { ...VERSIONS, regulation: 'M-C' });
  const mb = upsertRun(db, VERSIONS);
  check('two regulations coexist under one file',
    mc !== mb && mb === 7, `M-C is run #${mc}, M-B is run #${mb}`);

  db.close();
}

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILURES`}`);
process.exit(failures > 0 ? 1 : 0);

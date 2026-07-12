/**
 * scripts/test-variant-cid.ts — unit checks for content-addressed variant ids
 * (BACKLOG item 02). Fast and pure; part of `npm test` and CI.
 */
import { variantCid, canonicalSpec } from '../lib/variant-cid';
import type { Variant, VariantsData } from '../lib/types';
import * as fs from 'fs';
import * as path from 'path';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const base: Variant = {
  id: 'kingambit_test',
  species: 'Kingambit',
  is_mega: false,
  item: 'Black Glasses',
  ability: 'Defiant',
  nature: 'Adamant',
  sps: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 },
  weight: 0.25,
  moves: [
    { name: 'Sucker Punch', usage: 0.99 },
    { name: 'Kowtow Cleave', usage: 0.98 },
    { name: 'Iron Head', usage: 0.73 },
    { name: 'Protect', usage: 0.69 },
    { name: 'Low Kick', usage: 0.44 },
  ],
};
const cid0 = variantCid(base);

check('cid is 16 hex chars', /^[0-9a-f]{16}$/.test(cid0), cid0);

// Identity must survive everything that does not change the battle set.
check('weight drift does not change cid',
  variantCid({ ...base, weight: 0.01 }) === cid0);
check('slug rename does not change cid',
  variantCid({ ...base, id: 'kingambit_renamed' }) === cid0);
check('usage reorder within the same top 4 does not change cid',
  variantCid({
    ...base,
    moves: [
      { name: 'Protect', usage: 0.9 },
      { name: 'Iron Head', usage: 0.8 },
      { name: 'Sucker Punch', usage: 0.7 },
      { name: 'Kowtow Cleave', usage: 0.6 },
      { name: 'Low Kick', usage: 0.1 },
    ],
  }) === cid0);
check('below-top-4 usage tail does not change cid',
  variantCid({ ...base, moves: base.moves.slice(0, 4) }) === cid0);

// Identity must change with anything that does change the battle set.
check('item changes cid', variantCid({ ...base, item: 'Life Orb' }) !== cid0);
check('no-item changes cid', variantCid({ ...base, item: null }) !== cid0);
check('ability changes cid', variantCid({ ...base, ability: 'Supreme Overlord' }) !== cid0);
check('nature changes cid', variantCid({ ...base, nature: 'Jolly' }) !== cid0);
check('SP spread changes cid',
  variantCid({ ...base, sps: { ...base.sps, spe: 2, spd: 0 } }) !== cid0);
check('resolved moveset changes cid',
  variantCid({
    ...base,
    moves: [...base.moves.slice(0, 3), { name: 'Swords Dance', usage: 0.75 }],
  }) !== cid0);

// The canonical spec is the resolved battle set, not the raw variant record.
const spec = canonicalSpec(base);
check('canonical moveset is sorted top-4',
  JSON.stringify(spec.moves) === JSON.stringify(['Iron Head', 'Kowtow Cleave', 'Protect', 'Sucker Punch']));
check('canonical spec carries level 50', spec.level === 50);

// Every variant in the data file: stored cid matches a recompute, and all
// cids are distinct.
const data: VariantsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'defender-variants.json'), 'utf8'),
);
check('data file is schema v2', data.schema_version === 2, `schema_version=${data.schema_version}`);
const stale = data.variants.filter((v) => v.cid !== variantCid(v));
check('stored cids match recompute', stale.length === 0,
  stale.length ? `stale: ${stale.slice(0, 3).map((v) => v.id).join(', ')}` : `${data.variants.length} variants`);
const unique = new Set(data.variants.map((v) => v.cid));
check('cids are unique', unique.size === data.variants.length,
  `${unique.size} distinct of ${data.variants.length}`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`}`);
process.exit(failures > 0 ? 1 : 0);

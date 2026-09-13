/**
 * scripts/migrate-variants-v3.ts — migrate data/defender-variants.json from
 * schema v2 to v3 in place (BACKLOG item 09).
 *
 * Run: npm run migrate-variants
 *
 * No re-scrape and no re-simulation. Every added field is derived from what
 * the file already holds plus the resolved format rules, and nothing that
 * feeds `variantCid` is touched — so content ids are unchanged and the
 * matchup matrix stays valid. That is checked, not assumed: the migration
 * recomputes every cid and fails if one moved.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {variantCid} from '../lib/variant-cid';
import {activeRegulationConfig} from '../lib/format-rules';
import {
  VARIANT_SCHEMA_VERSION,
  assignTiers,
  defaultSetLabel,
  assertVariantsData,
} from '../lib/variant-schema';
import type {VariantsData} from '../lib/types';
import type {FormatRulesFile} from './build-format-rules';

const DATA_DIR = path.join(__dirname, '..', 'data');
const VARIANTS_PATH = path.join(DATA_DIR, 'defender-variants.json');

function main() {
  const rules = activeRegulationConfig();
  const data: VariantsData = JSON.parse(fs.readFileSync(VARIANTS_PATH, 'utf8'));

  if (data.schema_version === VARIANT_SCHEMA_VERSION) {
    console.log(`Already schema v${VARIANT_SCHEMA_VERSION}; nothing to do.`);
    return;
  }
  if (data.schema_version !== 2) {
    throw new Error(
      `Expected schema v2, found v${data.schema_version}. Migrate to v2 first.`
    );
  }

  const rulesFile: FormatRulesFile = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, `format-rules-${rules.regulation_id}.json`), 'utf8')
  );
  const nationalDex = new Map(rulesFile.national_dex);
  const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

  const cidsBefore = new Map(data.variants.map((v) => [v.id, v.cid]));

  const missingDex: string[] = [];
  const migrated = assignTiers(
    data.variants.map((v) => {
      const dex = nationalDex.get(toId(v.species));
      if (dex === undefined) missingDex.push(v.species);
      return {
        ...v,
        national_dex: dex,
        set_label: defaultSetLabel(v),
        // Everything in a v2 file came from the modal set; Phase 2's
        // top-usage rules and the override screen do not exist yet.
        moves_source: 'modal_set' as const,
      };
    })
  );

  if (missingDex.length > 0) {
    throw new Error(
      `No National Pokédex number for: ${[...new Set(missingDex)].join(', ')}. ` +
        `Run npm run build-format-rules first.`
    );
  }

  // The whole point of deriving rather than rebuilding: cids must not move,
  // or every row in matchups.sqlite is orphaned.
  const moved = migrated.filter((v) => variantCid(v) !== cidsBefore.get(v.id));
  if (moved.length > 0) {
    throw new Error(
      `Migration changed the content id of ${moved.length} variant(s): ` +
        moved.map((v) => v.id).join(', ')
    );
  }

  const out: VariantsData = {
    schema_version: VARIANT_SCHEMA_VERSION,
    regulation: rules.regulation_id,
    generated_at: data.generated_at,
    variants: migrated,
  };
  assertVariantsData(out, rules, new Set(rulesFile.legal_species));

  fs.writeFileSync(VARIANTS_PATH, JSON.stringify(out, null, 2) + '\n');

  const core = migrated.filter((v) => v.tier === 'core').length;
  console.log(
    `Migrated ${migrated.length} variants to schema v${VARIANT_SCHEMA_VERSION} ` +
      `(${rules.regulation_id}; ${core} core, ${migrated.length - core} extended). ` +
      `All content ids unchanged — matchups.sqlite stays valid.`
  );
}

main();

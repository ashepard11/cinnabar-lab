/**
 * Run the Pikalytics scraper and write data/usage-tournaments.json.
 * Run: npm run scrape
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {scrapeUsage} from '../lib/scrape';

async function main() {
  const data = await scrapeUsage();
  const out = path.join(__dirname, '..', 'data', 'usage-tournaments.json');
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${out}: ${data.pokemon.length} Pokémon, scraped_at ${data.scraped_at}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

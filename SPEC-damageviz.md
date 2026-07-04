# Pokémon Champions VGC Damage Visualizations — Implementation Spec

## Goal

Build two complementary data visualizations for the Pokémon Champions VGC metagame (Regulation M-B, doubles).

- **Viz 1 (Marimekko):** "Where does the damage I take come from?" — weighted by Pokémon usage and move usage, broken down by attack type (Fire, Water, etc.) and category (physical/special).
- **Viz 2 (Heatmap):** "If I bring a generic attack of each type, how much damage does it do to the field?" — a 18×2 grid showing relative damage (vs the average cell) for each (type, category) combination.

The two visualizations share infrastructure: same scraper, same defender variant logic, same calc layer. That shared infrastructure is also the foundation for the follow-on Battle Simulator project (see `SPEC-sim.md`) — build it clean.

## Format scope

- **Game:** Pokémon Champions
- **Format:** VGC doubles, **Regulation M-B, Season 3** (current as of writing — active June 17 through September 2, 2026, and will be used at the 2026 World Championships).
- **Data source:** Pikalytics tournament data at `pikalytics.com/pokedex/battledataregmbs3/` (the Reg M-B Season 3 tournament page). Per-Pokémon URLs branch from there. **Verify the exact URL structure during Phase 1** — Pikalytics has restructured its URL scheme between formats before, and the season identifier may roll forward before this project is complete. If Reg M-B S3 is no longer current when Fable runs, use the current M-series season instead and note it in the README.
- **Not** the ladder data, **not** the older "championstournaments" or "battledataregma" URLs.

## Tech stack

- **Language:** TypeScript throughout
- **Pipeline:** Node scripts for scraping and calc
- **Frontend:** React + D3 (single-page app with two routes/pages)
- **Calc engine:** `@smogon/calc` from npm. Pokémon Showdown has native support for Pokémon Champions, and `@smogon/calc` shares its data pipeline — the Champions gen/format should be available directly. **Verify in Phase 0.**
- **Scraping:** `axios` + `cheerio`

## Repo structure

```
pokemon-champions-viz/
├── data/
│   ├── usage-tournaments.json       # Scraped Pikalytics output, weekly cron
│   ├── defender-variants.json       # Derived: variant list with spreads, abilities, items
│   ├── viz1-data.json               # Output of build-viz1, consumed by frontend
│   └── viz2-data.json               # Output of build-viz2, consumed by frontend
├── lib/
│   ├── scrape.ts                    # Pikalytics → usage JSON
│   ├── variants.ts                  # Variant selection logic
│   ├── calc.ts                      # Calc wrapper: calculate(att, def, move, field) → damage roll
│   ├── items.ts                     # Damage-boosting item allowlist + Mega Stone list
│   ├── moves.ts                     # Move catalog (type, category, BP, isSpread, isDamaging)
│   └── types.ts                     # Shared TypeScript types
├── scripts/
│   ├── scrape-usage.ts              # Run scraper, write usage-tournaments.json
│   ├── build-variants.ts            # Build defender-variants.json from usage
│   ├── build-viz1.ts                # Compute expected damage table → viz1-data.json
│   └── build-viz2.ts                # Compute relative damage matrix → viz2-data.json
├── src/
│   ├── components/
│   │   ├── Marimekko.tsx            # Viz 1
│   │   └── Heatmap.tsx              # Viz 2
│   ├── App.tsx                      # Two pages, navigation between them
│   └── main.tsx                     # Entry
├── .github/workflows/
│   └── refresh-data.yml             # Weekly cron to re-scrape and re-build
├── package.json
└── README.md
```

## Phase 0: De-risk the calc engine (do this first)

Pokémon Showdown supports Pokémon Champions natively. `@smogon/calc` shares Showdown's data pipeline, so Champions should Just Work — but confirm before building everything on top of it.

**Steps:**
1. `npm install @smogon/calc`.
2. Look at the package's exported generations / formats list. Find the Champions entry (may be labelled by gen number with `champions` sub-format, may be its own gen ID — inspect the package to determine the correct constructor).
3. Write a Node script that runs this test case:
   - Attacker: Mega Charizard Y, Modest nature, max SpA investment, Heat Wave (Fire, Special, spread)
   - Defender: synthetic Pokémon with base 100 HP / 80 Def / 80 SpD, no investment, neutral nature, no item, no ability
   - Field: doubles, Sun (should be auto-set by Drought — if the calc doesn't auto-apply weather from ability, set it explicitly)
   - Expected damage: roughly 60–80% of target HP per hit (STAB × Sun × spread reduction × Y's 159 base SpA into a frail target). The 16 damage rolls should span roughly this range.
4. Verify a few Champions-specific data points that would catch a stale calc:
   - Mega Charizard Y's Sp.Atk stat is 159 base (Champions retains standard Gen 6/7 Mega stats).
   - Grav Apple is 90 BP in Champions (was 80 BP pre-Champions).
   - Growth is Grass-type in Champions (was Normal pre-Champions).
   - The SP (Stat Points) system: `@smogon/calc` may or may not have a first-class SP field. If not, translate SP → EV using the roughly 8 EV per 1 SP conversion for calc purposes and note it in `lib/calc.ts`.

**If the Champions format is not yet in the released `@smogon/calc`:**
1. Check the master branch of the smogon/damage-calc GitHub repo — Champions support may exist in unreleased code.
2. If not there either, fall back to the highest available Gen 9 VGC format and accept that Champions-specific BP/type changes won't be reflected. Log which moves diverge and add them to a `champions-overrides.ts` file for manual patching in the calc wrapper. This is a known v1 limitation, not a blocker.

**Output of Phase 0:** A working `lib/calc.ts` with this signature:

```typescript
type CalcResult = { min: number; max: number; avg: number };  // damage as % of defender HP

export function calculate(
  attacker: Attacker,
  defender: Defender,
  move: Move,
  field: Field
): CalcResult;
```

Don't proceed to Phase 1 until this works end-to-end on the Mega Zard Y test case.

## Phase 1: Scraper

Scrape Pikalytics's current Reg M-B tournament pages.

**Main leaderboard page (`pikalytics.com/pokedex/battledataregmbs3/` or the current M-series equivalent):**
- Get the list of Pokémon with their overall usage %.
- Filter to Pokémon with ≥ 1% usage (this is the inclusion threshold).

**Per-Pokémon pages:** The exact URL pattern needs to be discovered during implementation — hit the leaderboard, find the Pokémon links, and follow them. Extract per Pokémon:
- Overall usage %
- Move list with usage % per move (e.g., `Earthquake 89.948%`)
- Ability list with usage % per ability
- Item list with usage % per item
- **Modal SP/EV spread** from the top sets section. If the page format makes this hard to extract, log a warning and fall back to a default spread (max attacking stat + positive nature).

**Politeness:**
- 1-second delay between requests
- Cache results in `data/usage-tournaments.json` with a `scraped_at` timestamp
- Re-scrape only when triggered (weekly cron)

**Output:** `data/usage-tournaments.json`

```json
{
  "scraped_at": "2026-07-03T12:00:00Z",
  "format": "regmbs3",
  "pokemon": [
    {
      "name": "Incineroar",
      "usage": 0.5118,
      "moves": [{"name": "Fake Out", "usage": 0.99047}, ...],
      "abilities": [{"name": "Intimidate", "usage": 0.98193}, ...],
      "items": [{"name": "Sitrus Berry", "usage": 0.55242}, ...],
      "modal_set": {
        "ability": "Intimidate",
        "item": "Sitrus Berry",
        "nature": "Careful",
        "evs": {"hp": 252, "atk": 0, "def": 4, "spa": 0, "spd": 252, "spe": 0}
      }
    }
  ]
}
```

## Phase 2: Variant builder

Convert the scraped usage into the list of "attacker variants" and "defender variants" used by the two visualizations.

### Item bucketing

Items fall into three buckets:
1. **Mega Stone** — each individual stone is its own bucket (changes typing/stats/ability/role)
2. **Damage-boosting item** — each individual item is its own bucket. The Reg M-A allowlist:
   - Life Orb
   - Choice Band, Choice Specs
   - Expert Belt
   - Muscle Band, Wise Glasses
   - Type-boosting items: Charcoal, Mystic Water, Miracle Seed, Magnet, Soft Sand, Sharp Beak, Poison Barb, Silver Powder, Spell Tag, Twisted Spoon, Black Belt, Black Glasses, Metal Coat, Hard Stone, Never-Melt Ice, Dragon Fang, Pixie Plate, Silk Scarf
   - (Verify list against current Reg M-A legality during implementation; this is the standard set)
3. **No item** (everything else — Sitrus Berry, Focus Sash, Leftovers, Rocky Helmet, Safety Goggles, Choice Scarf, Clear Amulet, type-resist berries, defensive berries, Weakness Policy, Assault Vest, etc.)

### Variant selection

For each Pokémon `P` with `usage(P) > 1%`:

**Step 1: Bucket all items.** Every item the Pokémon uses is assigned to exactly one bucket:
- Each Mega Stone → its own individual bucket (e.g., "Charizardite Y" is a distinct bucket from "Charizardite X")
- Each damage-boosting item → its own individual bucket (e.g., "Life Orb", "Soft Sand")
- All non-damage-boosting items → collapsed into a single **"no item"** bucket. Sum the usage percentages of every non-damage-boosting item the Pokémon runs (Sitrus Berry, Focus Sash, Leftovers, Rocky Helmet, Choice Scarf, Clear Amulet, type-resist berries, Weakness Policy, Assault Vest, etc.) into this one aggregate bucket.

**Step 2: Select variants from the bucketed list.**

```
function selectVariants(pokemon):
    buckets = bucketItems(pokemon.items)
    # buckets is now a map: bucket_name → within_P_share
    # where all non-damage-boosting items have been summed into the single "no item" bucket
    
    variants = []
    
    # Include every Mega Stone bucket, regardless of weight
    for bucket, within_share in buckets:
        if isMegaStoneBucket(bucket):
            variants.append(buildVariant(pokemon, bucket, within_share))
    
    # Include any non-Mega bucket where usage(P) × within_share ≥ 1%
    for bucket, within_share in buckets:
        if not isMegaStoneBucket(bucket) and pokemon.usage * within_share >= 0.01:
            variants.append(buildVariant(pokemon, bucket, within_share))
    
    # Fallback: if NO variants of any kind were included, take the modal bucket
    # (the one with the largest within_P_share after bucketing)
    if not variants:
        modal = max(buckets, key=within_share)
        variants.append(buildVariant(pokemon, modal.bucket, modal.within_share))
    
    return variants
```

The important change from earlier versions: **"no item" is one aggregated bucket before thresholding, not many individual item checks**. This means a Pokémon where no single item clears 1% combined can still clear the threshold via the sum of all its non-damage-boosting items.

**Worked examples:**

- *Charizard (18% usage):* Charizardite Y bucket at 92.3% within-P → Mega Y variant (always included as Mega). Charizardite X bucket at 6.6% within-P → Mega X variant (always included as Mega). All other items (Charcoal, etc.) sum into "no item" bucket at ~1% within-P → 18% × 1% = 0.18%, below threshold, not included. **Result: 2 variants.**

- *Garchomp (39% usage):* No Megas. Soft Sand bucket at 15.6% within-P → 39% × 15.6% = 6.1% → damage-boost variant. All non-damage-boosting items (Choice Scarf, White Herb, Lum Berry, Haban Berry, Clear Amulet, etc.) sum to roughly 58% into "no item" bucket → 39% × 58% = 22.6% → "no item" variant. **Result: 2 variants.**

- *Hypothetical Pokémon at 1.2% usage, Expert Belt modal at 30%, non-boosting items summing to 70%:* Expert Belt bucket is 1.2% × 30% = 0.36% → below threshold. "No item" bucket is 1.2% × 70% = 0.84% → also below threshold. Nothing clears 1%, so fallback triggers: modal bucket is "no item" (70% > 30%), so the single fallback variant is "no item". **Result: 1 variant, the no-item one.**

- *Hypothetical Pokémon at 1.5% usage, Life Orb at 80%:* Life Orb bucket is 1.5% × 80% = 1.2% → above threshold, damage-boost variant included. "No item" bucket is 1.5% × 20% = 0.3% → below threshold, not included. **Result: 1 variant with Life Orb.**

### Ability handling

Use modal ability per Pokémon. For Mega variants, use the Mega's ability (e.g., Mega Charizard Y → Drought, Mega Venusaur → Thick Fat, Mega Salamence → Aerilate). The base form's ability is irrelevant once Mega evolves.

### Spread handling

For each variant, attach the modal SP/EV spread from the scraped data. For Mega variants, prefer a Mega-specific spread if scrapeable; otherwise apply the base form's spread (close enough — Megas rarely change spread philosophy from base forms).

**Output:** `data/defender-variants.json` (used by both viz scripts)

```json
{
  "variants": [
    {
      "id": "incineroar_no_item",
      "species": "Incineroar",
      "is_mega": false,
      "item": null,
      "ability": "Intimidate",
      "nature": "Careful",
      "evs": {"hp": 252, "atk": 0, "def": 4, "spa": 0, "spd": 252, "spe": 0},
      "weight": 0.5118
    },
    {
      "id": "charizard_mega_y",
      "species": "Charizard-Mega-Y",
      "is_mega": true,
      "mega_stone": "Charizardite Y",
      "item": "Charizardite Y",
      "ability": "Drought",
      "nature": "Modest",
      "evs": {...},
      "weight": 0.166
    }
  ]
}
```

## Phase 3: Build Viz 1 data (Marimekko)

For each variant V (used as attacker):
  For each move M in that variant's moveset where M is damaging and M's usage in P ≥ some minimum (suggest 10%):
    
    1. Build attacker from V's species, ability, item, nature, EVs, and Mega state.
    2. Build defender: synthetic Pokémon with base 100 HP / 80 Def / 80 SpD, no investment, neutral nature, no item, no ability.
       (For convenience define this once as STANDARD_TARGET in lib/variants.ts.)
    3. Build field: 
       - isDoubles: true
       - If V's ability auto-sets weather (Drought, Drizzle, Sand Stream, Snow Warning, Primordial Sea, Desolate Land), set that weather.
       - Otherwise no weather.
    4. Run calculate(attacker, defender, move, field) → CalcResult.
    5. Compute expected damage:
       - avg_damage = result.avg (% of defender HP)
       - move_weight = M.usage_in_P  (e.g., 0.899 for Garchomp's Earthquake)
       - spread_multiplier = 1.5 if M.isSpread else 1.0
       - expected = V.weight × move_weight × avg_damage × spread_multiplier

Aggregate by (move.type, move.category) → sum of expected. Then normalize so the sum across all (type, category) cells equals 1.0.

**Damaging moves filter:** 
- Exclude status moves (BP = 0 or N/A)
- Exclude moves with variable BP unless modeled (Last Respects, Facade, Acrobatics, Weather Ball — for v1, skip these or apply a reasonable default and flag them)
- Exclude OHKO moves (Sheer Cold, Horn Drill — exceedingly rare in VGC anyway)
- Multi-hit moves: use expected hit count × per-hit damage (calc lib should handle this if you pass `hits` correctly)

**Spread moves note:** In doubles, a spread move hits both opposing targets at 0.75× each. Per the user's spec, count this as 1.5× total damage from your perspective ("how much damage does this player project against my side per turn"). The calc lib's `isSpread: true` already applies the 0.75×; we then multiply by 2 to get 1.5× total.

**Output:** `data/viz1-data.json`

```json
{
  "generated_at": "2026-04-22T12:05:00Z",
  "cells": [
    {
      "type": "Fire",
      "category": "Special",
      "share": 0.18,
      "contributors": [
        {"variant_id": "charizard_mega_y", "species": "Charizard-Mega-Y", "move": "Heat Wave", "expected_damage": 0.082},
        {"variant_id": "incineroar_no_item", "species": "Incineroar", "move": "Flare Blitz", "expected_damage": 0.014}
      ]
    },
    ...
  ]
}
```

The `contributors` array is sorted descending by `expected_damage` and used for the tooltip drilldown.

## Phase 4: Build Viz 2 data (Heatmap)

Synthetic attacker:
- Species: doesn't matter functionally, but pick a real legal Pokémon with Normal typing for cleanest non-STAB behavior. **Suggest using a placeholder with**:
  - Level 50
  - Base 100 in both Atk and SpA (will swap which is used per category)
  - 0 SP, neutral nature, no item, ability that does nothing (e.g., Insomnia)
  - Typing: Normal/Normal (so no STAB on any move except Normal — and we'll skip Normal cells or accept STAB there)

For each defender variant V (with V.weight as defined in Phase 2):
  For each (type T in 18 types, category C in [Physical, Special]):
    
    1. Build the synthetic attacker. If C is Physical and V.ability is Intimidate, apply -1 Atk stage to the attacker (`boosts: { atk: -1 }`). Special calcs unaffected.
    2. Build a generic 90 BP move of type T, category C, single-target (not spread), no secondary effects.
    3. Build defender from V (species, ability, item, nature, EVs).
    4. Build field: isDoubles: true, no weather, no terrain, no screens.
    5. Run calculate(attacker, defender, move, field) → CalcResult.
    6. damage(V, T, C) = result.avg (% of V's HP). Immunities return 0; the calc lib handles this.

For each (T, C):
  weighted_damage(T, C) = Σ over V: V.weight × damage(V, T, C)

Then normalize:
  average = mean of weighted_damage across all 36 (T, C) cells (equal-weighted mean)
  relative(T, C) = weighted_damage(T, C) / average

**Tooltip data:** For each cell, also record the top defender contributors — sorted descending by `V.weight × damage(V, T, C)`. This shows "Fire special hits hardest because of Sinistcha, Garchomp, Kingambit (in that order)."

**Output:** `data/viz2-data.json`

```json
{
  "generated_at": "2026-04-22T12:10:00Z",
  "average_damage": 0.42,
  "cells": [
    {
      "type": "Fire",
      "category": "Special",
      "weighted_damage": 0.50,
      "relative": 1.18,
      "contributors": [
        {"variant_id": "sinistcha_no_item", "species": "Sinistcha", "damage": 0.95, "weighted_contribution": 0.041},
        {"variant_id": "kingambit_no_item", "species": "Kingambit", "damage": 0.82, "weighted_contribution": 0.038}
      ]
    },
    ...
  ]
}
```

## Phase 5: Frontend

Two pages, one app.

### Routing
- `/` — landing page with brief intro, links to both visualizations
- `/marimekko` — Viz 1
- `/heatmap` — Viz 2

Use whatever React router is convenient (React Router DOM).

### Viz 1: Marimekko component

True marimekko semantics:
- Columns = types, sorted by total share descending
- Column width ∝ total share for that type (sum of phys + spec)
- Within each column, two rows: physical on top, special on bottom
- Row height ∝ that category's share within that type's total

Layout math (no library needed, ~30 lines of D3):
```
chart_width = 800px (or container width)
chart_height = 400px
x = 0
for type, total_share in sorted_types:
    col_width = chart_width × total_share
    phys_height = chart_height × (phys_share_in_type / total_share)
    spec_height = chart_height − phys_height
    
    render <rect x={x} y={0} width={col_width} height={phys_height} fill={type_color_phys} />
    render <rect x={x} y={phys_height} width={col_width} height={spec_height} fill={type_color_spec} />
    
    x += col_width
```

**Coloring:** Use canonical Pokémon type colors (Fire=red-orange, Water=blue, Grass=green, etc.). For phys/spec distinction within a type, use a darker shade for one and lighter for the other (e.g., physical = darker, special = lighter).

**Labels:** Type name + percentage in each column. If a column is too narrow for the label (< ~40px), omit the label and rely on the tooltip.

**Tooltip:** On hover over a cell, show a floating card with:
- Type + category header
- "X% of expected damage"
- Top 5 contributors as "Pokémon — Move (Y%)"

### Viz 2: Heatmap component

18 rows (types) × 2 columns (Physical, Special).
- Row order: by row max value descending (most threatening type at top), or alphabetical — pick one and stick with it. Suggest descending by max(phys, spec) to surface the standouts.
- Cell color: diverging scale around 1.0. Use d3-scale-chromatic — `interpolateRdBu` reversed gives blue (low) → white (1.0) → red (high). Domain `[0.5, 1.5]` clamped is reasonable.
- Cell text: print the relative number (e.g., `1.18`) in a contrasting color.

**Tooltip:** On hover:
- Type + category header
- "X.XX× average damage"
- "Absolute: X% of average defender HP"
- Top 5 defender contributors: "Pokémon: Y% damage taken"

## Phase 6: Automation

`.github/workflows/refresh-data.yml`:

```yaml
name: Refresh data
on:
  schedule:
    - cron: '0 6 * * 1'  # Mondays 06:00 UTC
  workflow_dispatch:

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run scrape
      - run: npm run build-variants
      - run: npm run build-viz1
      - run: npm run build-viz2
      - name: Commit refreshed data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/
          git diff --staged --quiet || git commit -m "Refresh data $(date -u +%Y-%m-%d)"
          git push
```

`package.json` scripts:
```json
{
  "scrape": "tsx scripts/scrape-usage.ts",
  "build-variants": "tsx scripts/build-variants.ts",
  "build-viz1": "tsx scripts/build-viz1.ts",
  "build-viz2": "tsx scripts/build-viz2.ts",
  "build-all": "npm run scrape && npm run build-variants && npm run build-viz1 && npm run build-viz2",
  "dev": "vite",
  "build": "vite build"
}
```

## Non-goals / known v1 limitations

Document these in the README so users understand chart caveats:

1. **Defender items beyond Megas are ignored.** Type-resist berries, Assault Vest, Eviolite would matter for viz 2 but are skipped to keep variant count manageable.
2. **Variable-BP moves are skipped or use defaults.** Last Respects, Facade, Weather Ball, Acrobatics — the chart undercounts these.
3. **Tera is not modeled** (Champions doesn't have Tera; this is correct for the format but worth noting if anyone tries to compare to other VGC formats).
4. **Synthetic target for viz 1 is a single 100/80/80 Pokémon.** Different targets would produce different relative cells, especially if a target has strong defensive abilities or typings.
5. **Within-Pokémon ability variation is collapsed to modal.** A 60/40 Solar Power vs Blaze Charizard split is treated as 100% the modal ability. For Megas this is moot since Mega ability replaces it.
6. **Critical hit chance, accuracy, secondary effects are ignored.** Damage uses average roll, not expected value with crit/accuracy.
7. **Switching, Protect, Fake Out, redirection (Rage Powder, Follow Me) are not modeled.** Calc is "if this move connects, this is the damage."

## Suggested implementation order

1. **Phase 0** (calc engine de-risk) — must work before anything else
2. **Phase 1** (scraper) — produces raw data
3. **Phase 2** (variant builder) — pure logic, easy to unit-test
4. **Phase 3 OR 4** (build one viz first end-to-end) — suggest viz 2 since it has fewer moving parts (no per-move loop, no spread handling)
5. The other viz
6. **Phase 5** (frontend) — can be developed against fixture data while pipeline is being built
7. **Phase 6** (CI cron) — last, once everything is stable

## Test cases to verify correctness

Before declaring v1 done, sanity-check these:

- **Viz 1:** Fire special should be dominated by Charizard-Mega-Y Heat Wave. Ground physical should be dominated by Garchomp Earthquake. Dark physical should be dominated by Incineroar (Knock Off / Darkest Lariat) and Kingambit (Sucker Punch / Kowtow Cleave).
- **Viz 2:** Ground physical should be high (lots of Ground-weak Pokémon in the field — Incineroar, Kingambit, Charizard if non-Mega, etc.) UNLESS the field has enough Levitate/Flying types to drag the average down. Bug should be near the bottom (most defenders neutral or resistant). Fairy special should be elevated thanks to Dragon-types in the field.
- **Sanity check on Mega Charizard Y Heat Wave damage:** ~70%+ avg roll into the synthetic 100/80/80 target with 0 SpD investment. If the calc says ~30%, something's wrong with the field/weather/Mega state.

## Notes for the implementer

- All damage values flowing into JSON should be decimals (0–1+), not percentages. Format as percentages only at display time.
- Save Pokémon names in their canonical Showdown form (`Charizard-Mega-Y`, not `Charizard Mega Y` or `Mega Charizard Y`). The calc lib expects this format.
- When scraping, log all Pokémon, abilities, items, and moves that don't match the calc lib's known names — these are likely typos in Pikalytics or species-form mismatches that need a manual mapping table.
- The frontend should fetch the JSON data at runtime (not bundle it), so refreshing data doesn't require a rebuild.
- Add a "data last refreshed: YYYY-MM-DD" footer to both visualizations, pulled from the `generated_at` field.

## Building for reuse in the sim project

The next project (`SPEC-sim.md`) builds a 1v1 battle simulator on top of this same metagame data. To make that project cheap to start:

- **`lib/scrape.ts`** and **`lib/variants.ts`** should be pure functions with clean interfaces. The sim project will import them unchanged. Do not couple them to the visualization data structures.
- **`lib/calc.ts`** is not needed by the sim (which drives Pokémon Showdown's simulator directly), but the sim will use similar Pokémon-construction helpers. Consider factoring out a `lib/pokemon.ts` that constructs a canonical Pokémon representation from a variant — used by `calc.ts` here, and importable by the sim.
- **`data/defender-variants.json`** is the primary handoff. The sim reads it as its list of Pokémon to simulate, treating it as "the metagame." Its schema should be stable and versioned (add a `schema_version: 1` field at the top).
- Prefer a monorepo structure (single git repo) with clear folder boundaries so both projects can share `lib/` without publishing an internal package.

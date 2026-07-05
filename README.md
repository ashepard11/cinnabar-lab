# Pokémon Champions VGC — Damage Visualizations

Two complementary views of the Pokémon Champions VGC metagame (**Regulation
M-B, Season 3** ranked battle data from Pikalytics):

1. **Damage sources (Marimekko)** — "Where does the damage I take come from?"
   Expected damage output across the metagame, weighted by Pokémon usage and
   move usage, broken down by attack type and physical/special category.
2. **Field weakness (Heatmap)** — "If I bring a generic 90 BP attack of each
   type, how much damage does it do to the field?" An 18×2 grid of relative
   damage vs the usage-weighted defender field.

This is project 1 of 2; the shared scraper, variant selection, and Pokémon
construction helpers in `lib/` are the foundation for the follow-on battle
simulator (`SPEC-sim.md`). Design decisions and their reasoning live in
[DECISIONS.md](DECISIONS.md).

## Quick start

```bash
npm ci
npm run dev        # frontend at http://localhost:5173 (uses committed data/)
```

Rebuild the data pipeline (scrape → variants → viz1 → viz2):

```bash
npm run build-all
```

Individual steps: `npm run scrape`, `build-variants`, `build-viz1`,
`build-viz2`. Tests: `npm test` (calc-engine smoke test + variant-selection
unit tests), `npm run typecheck`.

Data refreshes automatically every Monday via
`.github/workflows/refresh-data.yml` (also runnable manually via
workflow_dispatch). The frontend fetches `data/*.json` at runtime, so a data
refresh does not require a JS rebuild.

## How it works

- **Calc engine** — `@smogon/calc` with native Pokémon Champions support
  (generation 0), vendored from smogon/damage-calc master
  (`vendor/smogon-calc-*.tgz`) because the npm release predates Champions.
  Champions' SP system (0–32 per stat, level-independent stat formula) is
  first-class. See DECISIONS.md D1–D2.
- **Scraper** (`lib/scrape.ts`) — hits Pikalytics' JSON API for the current
  M-series season (`battledataregmbs3`, Glicko 1760 cutoff), auto-discovers
  the stats month, includes every Pokémon at ≥1% usage. Usage % is derived
  from per-Pokémon game counts (D7).
- **Variant builder** (`lib/variants.ts`) — buckets each Pokémon's items
  (each Mega Stone its own variant, each damage-boosting item its own
  variant, everything else one "no item" bucket), keeps buckets clearing a 1%
  usage product, always keeps Megas. Currently 89 variants from 70 Pokémon.
- **Viz pipelines** (`scripts/build-viz1.ts`, `build-viz2.ts`) — damage calcs
  against a standard synthetic target (viz 1) / the weighted defender field
  (viz 2), written to `data/viz{1,2}-data.json`.

## Known v1 limitations

1. **Defender items beyond Megas are ignored.** Type-resist berries, Assault
   Vest, Eviolite would matter for the heatmap but are skipped to keep the
   variant count manageable.
2. **Variable-BP moves use in-model defaults or are skipped.** The model is
   one clean hit (full HP, no boosts, no prior damage/faints, attacker's own
   auto-weather). Weather Ball, Acrobatics, Facade etc. resolve exactly under
   that model; Last Respects and Rage Fist are included at base BP
   (undercounted); weight-based moves (Grass Knot, Low Kick, Heavy Slam, Heat
   Crash) and fixed-damage moves (Super Fang, Beat Up) are skipped. See
   DECISIONS.md D17.
3. **Tera is not modeled.** Champions doesn't have Tera; correct for this
   format, but don't compare cells directly against Sw/Sh–S/V VGC formats.
4. **The viz-1 target is a single synthetic 100/80/80 Pokémon** with neutral
   (`???`) typing. Real targets with real typings/abilities would shift cells.
5. **Within-Pokémon ability variation is collapsed to modal** (e.g. a
   Solar Power / Blaze split counts as 100% modal). Moot for Megas, whose
   forme ability replaces the base ability.
6. **Crit chance, accuracy, and secondary effects are ignored.** Damage is
   the average roll of a connecting hit.
7. **Switching, Protect, Fake Out timing, and redirection are not modeled.**
   The calc answers "if this move connects, how much does it do."
8. **Usage % is derived, not published.** This format's API exposes game
   counts, not usage percentages; we derive usage assuming 6-Pokémon teams
   (D7), which reproduces known reference values but may drift slightly from
   Pikalytics' own displayed ordering.

## Repo layout

```
data/       scraped usage, variants, and viz JSON (committed, cron-refreshed)
lib/        pipeline library: scrape, variants, items, moves, calc, pokemon, types
scripts/    runnable pipeline steps + tests
src/        React frontend (Vite, React Router, D3 scale-chromatic)
vendor/     vendored @smogon/calc build with Champions support
```

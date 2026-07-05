# Pokémon Champions VGC — Metagame Analytics

Analytics for the Pokémon Champions VGC metagame (**Regulation M-B, Season 3**
ranked battle data from Pikalytics), in two projects sharing one pipeline:

**Damage visualizations** (`SPEC-damageviz.md`):

1. **Damage sources (Marimekko)** — "Where does the damage I take come from?"
   Expected damage output across the metagame, weighted by Pokémon usage and
   move usage, broken down by attack type and physical/special category.
2. **Field weakness (Heatmap)** — "If I bring a generic 90 BP attack of each
   type, how much damage does it do to the field?" An 18×2 grid of relative
   damage vs the usage-weighted defender field.

**Battle simulator** (`SPEC-sim.md`):

3. **Matchup matrix** (`/matchups`) — P(A beats B) in a simulated 1v1
   Champions endgame for every pair of the 89 metagame variants × 10 starting
   conditions (fresh, Tailwind either side, Trick Room, sun, rain, ±1 boosts),
   from seeded Pokémon Showdown battles.
4. **Matchup detail** (`/matchup/:A/:B`) — one pairing across all conditions,
   with confidence intervals and both modal sets.
5. **Team builder** (`/team-builder`) — pick a 1–4 variant core, get partners
   ranked by how well they patch the core's worst matchups, weighted by
   opponent usage and matchup urgency.

Design decisions and their reasoning live in [DECISIONS.md](DECISIONS.md);
the move-selection policy design is documented in
[docs/policy-design.md](docs/policy-design.md).

## Quick start

```bash
npm ci
npm run dev        # frontend at http://localhost:5173 (uses committed data/)
```

Rebuild the damage-viz data pipeline (scrape → variants → viz1 → viz2):

```bash
npm run build-all
```

Battle-simulator commands:

```bash
npm run sim-smoke        # Phase 0 engine smoke test (Zard Y vs Incineroar)
npm run sim-sanity       # sanity gate: 5 spec matchups + invariants
npm run build-matchups   # full matrix build into data/matchups.sqlite (~hours; resumable)
npm run inspect-matchup -- --A charizard_mega_y --B incineroar_no_item --condition fresh --verbose
```

Tests: `npm test` (calc smoke + variant unit tests + damage-viz sanity),
`npm run typecheck`. Damage-viz data refreshes weekly via
`.github/workflows/refresh-data.yml`.

## How it works

- **Calc engine** — `@smogon/calc` with native Pokémon Champions support
  (generation 0), vendored from smogon/damage-calc master
  (`vendor/smogon-calc-*.tgz`) because the npm release predates Champions.
  Champions' SP system (0–32 per stat, level-independent stat formula) is
  first-class. See DECISIONS.md D1–D2.
- **Battle engine** — `pokemon-showdown` built from smogon master and
  vendored (`vendor/pokemon-showdown-*.tgz`; the npm release predates
  Champions). 1v1 battles run headless through `BattleStream` in the
  Champions BSS format — mechanically identical to a doubles endgame for
  strict 1v1 (D20–D21). Every battle is seeded and reproducible.
- **Move policy** — `nash-d2`: each turn, both sides' payoff matrix over move
  pairs is evaluated to depth 2 with a calc-backed forward model and solved
  as a zero-sum matrix game (fictitious play); moves are sampled from the
  equilibrium mixture. Rationale, option survey, and validation plan:
  [docs/policy-design.md](docs/policy-design.md).
- **Scraper** (`lib/scrape.ts`) — hits Pikalytics' JSON API for the current
  M-series season (`battledataregmbs3`, Glicko 1760 cutoff), auto-discovers
  the stats month, includes every Pokémon at ≥1% usage. Usage % is derived
  from per-Pokémon game counts (D7).
- **Variant builder** (`lib/variants.ts`) — buckets each Pokémon's items
  (each Mega Stone its own variant, each damage-boosting item its own
  variant, everything else one "no item" bucket), keeps buckets clearing a 1%
  usage product, always keeps Megas. Currently 89 variants from 70 Pokémon.
- **Matchup matrix build** (`scripts/build-matchups.ts`) — worker-thread pool
  over all unordered pairs × conditions; adaptive sampling (20–200 battles
  per cell, Wilson CI); each simulated cell also writes its exact mirror row.
  Output: `data/matchups.sqlite` (schema per spec + a `metadata` table with
  policy/calc/engine versions). The frontend loads it with sql.js.

## Known limitations — damage viz (v1)

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

## Known limitations — battle simulator (v1)

1. **No support moves.** Weather-setters, Tailwind, Trick Room, and screens
   are available only as *starting conditions*, not as playable moves during
   the simulation (they're filtered out of movesets, D23). Pokémon whose
   value comes from support (Grimmsnarl, Farigiraf, Pelipper-as-setter) are
   underrepresented. v2 scope.
2. **No switching.** 1v1 endgame only; pivot value (Parting Shot momentum,
   U-turn) doesn't exist in a 1v1, so pivot Pokémon are undervalued.
3. **Policy realism.** `nash-d2` is a depth-2 equilibrium search, not a
   human. It misses long-horizon plays (multi-turn setup chains) and models
   Encore/Disable/Perish Song as planning no-ops (they still resolve for
   real in battle). Read the matrix as "under one specific, documented
   decision policy" — the policy id is stamped in the sqlite metadata, and
   changing it invalidates (and regenerates) the matrix.
4. **Modal spreads only.** Both sides use their variant's modal spread and
   top-4 eligible moves; real players tune spreads to benchmarks.
5. **Redirection is skipped in 1v1** — correct for the endgame unit, but the
   matrix says nothing about teammate-dependent value (Follow Me, Rage
   Powder).
6. **Community-consensus checks are calibrated to Gen-9 intuitions.** Where
   Champions' stat system and modal spreads genuinely flip a matchup
   (Garchomp vs offensive Rotom-W), the simulator result deviates from the
   Gen-9 expectation by design; such cases are verified by hand and
   documented (D24).

## Repo layout

```
data/       scraped usage, variants, viz JSON, matchups.sqlite (committed)
docs/       policy design doc
lib/        pipeline library: scrape, variants, calc, pokemon, types
lib/sim/    battle simulator: engine, model, policy, condition, harness, sets
lib/analysis/  matchup-matrix and team-coverage query APIs
scripts/    runnable pipeline steps + tests + matrix build
src/        React frontend (Vite, React Router, D3 scale-chromatic, sql.js)
vendor/     vendored @smogon/calc and pokemon-showdown builds with Champions
```

# Pokémon Champions VGC — Metagame Analytics

Analytics for the Pokémon Champions VGC metagame (**Regulation M-B, Season 3**
ranked battle data from Pikalytics — see [Regulation status](#regulation-status),
this is stale), in three projects sharing one pipeline:

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
6. **Team evaluator** (`/team-evaluator`, `SPEC-team-evaluator.md`) — paste a
   Showdown team and get type matrices, relevant BST, board control inventory,
   RNG exposure, damage sources and worst matchups.

**Automated teambuilder** (`SPEC-teambuilder.md`) — *Phases 0–1 complete.* Searches the
space of legal 6-Pokémon teams and ranks them against the usage-weighted
metagame on three axes: matchups, enablers and positioning. Guided mode ranks
candidates slot by slot; automatic mode searches the whole space. It consumes
both pipelines above. Phase 0 (format rules, regulation configuration, data
contracts) and Phase 1 (the interface, against fixtures) have landed:

- **Build** (`/build`) — guided mode. Candidates ranked for the next slot, each
  scored on matchup coverage, conditions added and positioning at once.
- **Generate** (`/generate`) — automatic mode. Ranked teams with the
  floor-to-ceiling score band on every card.
- **Team detail** (`/build/team/:id`) and **Pokémon detail**
  (`/build/variant/:id`).
- **Movesets** (`/movesets`) — the generated four-move selection next to the
  usage it came from, low-confidence sets first. Real data.
- **Data status** (`/data-status`) — active regulation, data ages, and which
  variants the matrix has drifted away from. Real data.

Every score on the Build, Generate and detail screens is fixture data:
`npm run build-fixtures` regenerates `data/fixtures/`. The remaining Priority 0
items in [BACKLOG.md](BACKLOG.md) block Phase 2 onward.

Design decisions and their reasoning live in [DECISIONS.md](DECISIONS.md);
the move-selection policy design is documented in
[docs/policy-design.md](docs/policy-design.md).

## Regulation status

The metagame is defined by a regulation that rolls over every three to four
months. **Regulation M-C is current**, running 9 September to 2 December 2026.
It added 36 Pokémon, 18 items and 6 Mega Evolutions over M-B; nothing legal in
M-A or M-B was removed.

**This pipeline still runs M-B Season 3, which ended on 9 September 2026**, so
every number here describes a format that is no longer played. The format ids
are no longer hardcoded — `lib/format-rules.ts` resolves them from a regulation
read from configuration:

```bash
CHAMPIONS_REGULATION=M-A npm run build-format-rules   # default: M-B
npm run build-format-rules -- --all                   # every sourceable regulation
```

That writes `data/format-rules-<id>.json` with the legality sets (legal
species, legal items, Mega-capable species and their stones, National Pokédex
numbers for the species clause), resolved from the vendored Showdown mod
intersected with the calc's Champions roster. M-B comes out at 323 species,
148 items and 74 Mega formes; the item count matches the regulation
announcement exactly.

**M-C cannot be built yet.** The vendored Showdown build (`e440c4a`, ~July
2026) ships only the `champions` (M-B) and `championsregma` (M-A) mods, so M-C
has no legality data and its entry is declared but deliberately unsourceable —
`SIM_FORMAT` and the resolver both throw rather than silently falling back to
M-B rules. Moving to M-C needs three things together: re-vendoring
pokemon-showdown, confirming M-C's Pikalytics format id against the live API,
and re-scraping usage. Re-vendoring bumps `SIM_ENGINE_VERSION`, which
invalidates `data/matchups.sqlite`, so budget a full matrix rebuild. See
DECISIONS.md D39 and BACKLOG items 09 and 10.

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

npm run refresh-matchups -- --dry-run   # what would a refresh cost? touches nothing
npm run refresh-matchups                # simulate only what actually changed
npm run refresh-matchups -- --prune     # ...and drop rows no live pair can reach
npm run verify-matchups                 # post-build integrity checks
```

Tests: `npm test` (calc smoke + variant unit tests + damage-viz sanity +
content-id tests + format rules + team evaluator), `npm run typecheck`. Damage-viz data refreshes weekly via
`.github/workflows/refresh-data.yml`.

Note: the weekly refresh regenerates usage/variants/viz JSON only, so the
matchup matrix drifts out of sync with the variant set every time the scrape
moves it. Use `npm run refresh-matchups` rather than a rebuild: matchup rows
key on content ids, so only pairs involving a genuinely changed variant need
simulating, and the rest are reused. The last sync cost 4,050 cells against
30,810 reused — 11.6% of a rebuild. `--dry-run` prints that breakdown without
touching the file, and `/data-status` shows the same figure in the browser.

A full rebuild is only needed when the run key changes — a different decision
policy, calc version, sim engine or regulation invalidates every row by
design. `refresh-matchups` refuses to do that silently; pass `--full` if it is
what you want.

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
  Output: `data/matchups.sqlite`, schema v2 (DECISIONS.md D34): rows keyed on
  content-addressed variant ids (`lib/variant-cid.ts`) plus a provenance run
  key (policy/calc/engine versions via `sim_runs`); readers query the
  `matchups_current` view, which exposes the human-readable slugs. A v1 file
  migrates in place with `npm run migrate-matchups` (no re-simulation).

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

## Known limitations — team evaluator (v1)

1. **Nearest-variant matchup approximation.** Pasted sets map to the closest
   known variant (species → exact item → aggregate bucket) for the
   worst-matchups section; inexact matches carry an "approximated as …"
   badge, and species outside the variant set are excluded with a note.
   Exact-set and custom-set simulation is BACKLOG item 05; defensive-item
   fidelity is item 04.
2. **No metagame baseline column.** "Your team has 3 speed-control options —
   the meta average is 2.1" needs team-level composition data Pikalytics
   doesn't provide; tallies are raw counts.
3. **Static analysis.** Board control and RNG tallies count *options*, not
   their in-game value; the matchup section is where interaction quality
   lives.
4. **Type matrix is mono-type per axis** — real defenders are dual-typed;
   the offensive grid shows per-type reach, not field coverage.
5. **No item effects** beyond RNG items and healing items (no Air Balloon in
   the type chart, no Covert Cloak in option control).
6. **No ability suppression / Mold Breaker / type-changing mechanics.**
7. **Damage sources inherit the viz-1 model's limits** — one clean hit at
   full HP vs the synthetic neutral target; state-dependent-BP moves are
   undercounted and flagged.
8. **Champions dex gaps thin the curated tables** (Psychic/Misty Surge,
   Serene Grace, pinch berries, …) — CI's taxonomy-rot gate tracks the exact
   drop list in both directions, so a closed gap forces a table review.

## Repo layout

```
data/       scraped usage, variants, viz JSON, matchups.sqlite, evaluator dex,
            resolved per-regulation format rules (committed)
docs/       policy design doc
lib/        pipeline library: scrape, variants, calc, pokemon, types, format-rules
lib/sim/    battle simulator: engine, model, policy, condition, harness, sets
lib/analysis/  matchup-matrix and team-coverage query APIs
lib/evaluator/ team evaluator: dex, parse, typechart, tags, rng, bst, damage, match
scripts/    runnable pipeline steps + tests + matrix build
src/        React frontend (Vite, React Router, D3 scale-chromatic, sql.js)
vendor/     vendored @smogon/calc and pokemon-showdown builds with Champions
```

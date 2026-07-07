# Design decisions

Decisions the specs didn't fully cover, with reasoning. (Per CLAUDE.md working style.)

## Phase 0 — calc engine

### D1: Vendored @smogon/calc master build instead of the npm release
The released `@smogon/calc@0.11.0` has no Pokémon Champions data (gen 10 probe
returns undefined moves; Grav Apple still 80 BP in gen 9). The master branch of
smogon/damage-calc **does** ship Champions support (`calc/src/mechanics/champions.ts`,
`CHAMPIONS_PATCH` move data), keyed as **generation 0**.

npm cannot install a subdirectory of a git monorepo, so the calc package was
compiled from master (commit `ebe3a812d85949362c246cd81408254085976158`) and
vendored as `vendor/smogon-calc-0.11.0-champions-master.tgz`, referenced from
package.json as a `file:` dependency. This keeps `npm ci` working locally and
in CI with no network dependency on GitHub. The tarball was packed with
`--ignore-scripts` because the upstream `prepack` also builds a browser bundle
we don't need (and which requires devDeps that fail to install on this machine).

To refresh: clone smogon/damage-calc, `cd calc && npm install && npx tsc -p . &&
npm pack --ignore-scripts`, copy the tarball into `vendor/`.

### D2: SP handling — the calc has first-class SP support
In gen 0 the calc's `evs` field IS the Champions SP field. The stat formula is
level-independent: `HP = base + SP + 75`, `stat = floor(nature × (base + SP + 20))`,
SP range 0–32 per stat. No 8:1 approximation needed in the calc itself; we only
convert when the *scraped data* is EV-denominated, using the same conversion the
official damage-calc UI uses: `SP = ceil(EV / 8)` with `EV 4 → SP 1`.

### D3: Zard Y Heat Wave benchmark lands at ~86% avg, above the spec's rough 60–80% band
The spec's controlling sanity check ("~70%+ avg roll; if ~30%, something's wrong")
passes. The rough 60–80% band was estimated from Gen-9 stat math; Champions'
level-independent formula gives a slightly higher attack-to-bulk ratio for this
matchup (232 SpA into 175/100 = min 78.9% / avg 85.8% / max 93.1%). Sun (×1.5)
and doubles spread reduction (×0.75) were verified to engage independently, so
the multiplier chain is right and the difference is the stat system itself.

### D4: Growth is not Grass-type in the calc data
The spec lists "Growth is Grass-type in Champions" as a data marker, but master's
`CHAMPIONS_PATCH` doesn't retype it. Growth is a status move, so this cannot
affect any damage number in this project. Logged as informational in the smoke
test rather than patched, to keep our data identical to upstream.

### D5: Weather set explicitly, not inferred by the calc
The calc does not auto-apply Drought → Sun. Per the spec's fallback instruction,
the viz-1 pipeline sets field weather from the attacker's ability
(Drought/Drizzle/Sand Stream/Snow Warning/Primordial Sea/Desolate Land).

## Phase 1 — scraper

### D6: Scrape the Pikalytics JSON API, not the HTML
`pikalytics.com/pokedex/battledataregmbs3` is a client-rendered app; the HTML
contains only Handlebars templates plus a server-rendered rank list (no usage
percentages). The data comes from a JSON API discovered in the site's app
bundle: `/api/l/{month}/{format}-{cutoff}` (leaderboard) and
`/api/p/{month}/{format}-{cutoff}/{name}` (per-Pokémon). We use the site's
default rating cutoff (Glicko 1760). The stats month is auto-discovered by
probing backwards from the current month so the weekly cron keeps working when
the month rolls over.

### D7: Usage % derived from game counts
This format's API has no usage-percent field (the site UI shows ranks instead).
We derive `usage(P) = games(P) / (Σ games / 6)` — the fraction of 6-Pokémon
teams including P. This reproduces the spec's worked examples (Garchomp ≈ 40%
vs the spec's 39%; Charizardite Y at 95.4% of Charizard's items vs the spec's
92.3%). Caveat: the site's own leaderboard ordering does not always follow raw
game counts (it appears to use an internal weighting we cannot reproduce), so
our usage ranking may differ slightly from the site's displayed order.

### D8: Spreads are SP-denominated at the source; nature comes from a separate list
Pikalytics reports Champions spreads directly in SP (0–32, field "ev", order
hp/atk/def/spa/spd/spe) — no EV→SP conversion needed. Spreads carry no nature;
natures are a separate ranked list, so the modal set combines modal spread +
modal nature + modal ability + modal item (each independently modal). Schema
deviation from the spec example: `modal_set.sps` (SP) instead of
`modal_set.evs` (EVs), to avoid mislabeling the denomination.

### D9: Species mapping table
"Aegislash" (Pikalytics) → "Aegislash-Both" (calc dex): the calc splits
Aegislash by stance; "-Both" uses Blade offenses + Shield defenses, which is
the damage-calc convention and correct for both attacker and defender roles
under Stance Change. All other 69 scraped species, and every scraped move,
item, and ability name, resolve in the calc dex unchanged ("Other" rows are
skipped).

## Phase 2 — variant builder

### D10: Truncated item lists — residual mass goes to the "no item" bucket
The API lists only each Pokémon's top ~10 items (sums run 72–100%). The
unlisted residual is added to the aggregate "no item" bucket. Every unlisted
item is individually rarer than the rarest listed one, so this cannot hide a
damage-boost bucket that would have cleared the 1% product threshold.

### D11: Mis-matched Mega Stones are inert
Data rows like Staraptor holding Skarmorite (0.0%) exist. A stone whose species
doesn't match the holder does nothing in battle, so it is bucketed as a
non-damage-boosting item rather than producing a bogus Mega variant.

### D12: Mega variant ids come from the Mega species
`charizard_mega_y` etc. — the stone is implied by the forme. Non-Mega ids are
`{species}_{bucket}` (`garchomp_life_orb`, `incineroar_no_item`).

### D13: Default-spread fallback
When a modal spread is unparseable, the variant gets 32 SP in its larger base
attacking stat with the matching positive nature (Adamant/Modest), per the
spec's "max attacking stat + positive nature" fallback.

## Phases 3 & 4 — viz data pipelines

### D14: Synthetic viz-2 attacker uses `???` typing instead of Normal
The spec suggests a Normal-typed attacker and says "skip Normal cells or accept
STAB there". The calc supports the `???` pseudo-type, which gets no STAB on any
move — so all 36 cells are directly comparable with no correction and no
skipped cells. Verified: with `???` typing all move types deal identical
neutral damage; with Normal typing the Normal cell is exactly 1.5× inflated.

### D15: STANDARD_TARGET (viz 1 defender) is `???`-typed
The spec specifies the target's stats but not its typing. Any real typing
creates an immunity column artifact — a Normal-typed target takes 0 from every
Ghost move, erasing Sinistcha's (31% usage) STAB from the chart. `???` takes
neutral damage from all 18 types. The stand-in body is Snorlax because the
species must exist in the Champions dex (Mew does not) even though stats and
typing are fully overridden.

### D16: Viz-2 weights normalized to a distribution
Variant weights are team-inclusion rates summing to ~5.4 (≈6 team slots).
`relative` is scale-invariant, but the absolute `weighted_damage` /
`average_damage` shown in tooltips are divided by the total weight so they read
as "damage vs a random defender drawn from the field".

### D17: Variable-BP move policy (viz 1)
Our model is one clean hit: full HP, no boosts, no prior damage or faints,
field = attacker's auto weather. The calc resolves most "variable" BP exactly
within that model — Weather Ball becomes 100 BP Fire under Drought sun (counted
in the Fire column, which is what actually threatens the field), Acrobatics
sees the attacker's item, Facade is unstatused, Water Spout is at full HP.
Moves whose BP scales with state the model zeroes (Last Respects, Rage Fist)
are included at base BP and flagged as undercounted. Weight-based moves
(Grass Knot, Low Kick, Heavy Slam, Heat Crash) are skipped: the synthetic
target has no defined weight, and inheriting the Snorlax stand-in's 460 kg
would give them max BP artificially. Fixed-damage moves (Super Fang, Seismic
Toss) and Beat Up are skipped as before.

### D18: Viz-1 cells keyed by resolved move type
Aggregation uses the calc's post-resolution move type/category, not the dex
default. Concretely: Charizard-Mega-Y's Weather Ball (84% usage) counts as
Fire Special, not Normal.

### D19: Heatmap defenders merge same-species item variants (user request, 2026-07-04)
Held items in our variant set have no defensive effect (damage-boost items are
offensive-only; defensive items were bucketed away in Phase 2), so for viz 2
the same-species non-Mega variants are merged into one defender with summed
weight, keyed on (species, ability, nature, spread). Megas stay separate —
different stats/typing/ability. Merging is weight-linear so every cell value
is unchanged; the contributor drilldown just stops splitting one Pokémon
across duplicate rows (e.g. Garchomp no longer appears twice in Fairy
Special). The marimekko intentionally keeps item variants separate: items
change attacking output.

## Battle simulator (SPEC-sim.md) — Phase 0

### D20: Vendored pokemon-showdown master build (same pattern as D1)
The released `pokemon-showdown@0.11.10` npm package has no Champions data
(newest VGC format is 2025 Reg G). The master branch of smogon/pokemon-showdown
ships full Champions support: format `gen9championsvgc2026regmb`
("[Gen 9 Champions] VGC 2026 Reg M-B", mod `champions`), the Champions
level-independent stat formula (`HP = base + SP + 75`, `stat = nature ×
(base + SP + 20)` — a battle set's `evs` field IS the SP field), Grav Apple
90 BP, and — unlike the calc's data (see D4) — Growth retyped to Grass.
Master has no `prepare` script, so a git install would ship unbuilt
TypeScript; instead the package was built from master (commit
`e440c4a18385274f10c405d0b158b6a962ce6d94`, `npm install && node build &&
npm run build-npm && npm pack --ignore-scripts`) and vendored as
`vendor/pokemon-showdown-0.11.10-champions-master-e440c4a.tgz`.

### D21: 1v1 battles run in the Champions BSS (singles) format
`gen9championsvgc2026regmb` is `gameType: doubles`, and the Showdown engine
cannot start a doubles battle with a 1-Pokémon team: the second active slot is
`null` and the turn loop crashes dereferencing it (sim/battle.ts `runAction`
phazing loop; null slots only ever arise at start, never in real endgames,
where fainted Pokémon still occupy their slot). Rather than patch the engine,
1v1 battles use `gen9championsbssregmb` ("[Gen 9 Champions] BSS Reg M-B",
same `champions` mod, `gameType: singles`). For a strict 1v1 this is
mechanically identical to a doubles endgame: the doubles-only spread-damage
reduction (×0.75) only engages when a move actually hits ≥2 targets, and
every other doubles-specific mechanic (redirection, ally targeting) is a
no-op with one Pokémon per side — the spec itself notes this ("Redirection is
skipped in 1v1"). The deviation is logged here per the spec's Phase 0
fallback instructions.

### D22: Mega variants start the battle already in their Mega forme
BattleStream runs no team validation, so sides are sent hackmons-style with
`species: "Charizard-Mega-Y"` + the stone. This matches the variant data
(Pikalytics spreads/abilities are for the Mega), makes Drought fire on
switch-in (verified in the smoke test), and sidesteps the mega-declaration
choice API entirely — the policy never needs to decide "when to Mega" (in
Champions Reg M-B the Mega slot mon just Megas turn 1 anyway). The champions
mod's `canMegaEvo` returns null for a mon already in its Mega forme, so no
double-Mega is possible.

### D23: v1 movesets = top-4 usage moves after scope exclusions
The spec fixes each side to its variant's modal spread but doesn't pin the
moveset. v1 uses the variant's 4 highest-usage moves after removing moves the
v1 scope forbids as actions (weather/terrain setters, Tailwind, Trick Room,
screens) plus moves that are strictly dead in a 1v1 (redirection,
ally-targeted moves, hazards). Filtering *before* taking the top 4 keeps
support-heavy Pokémon (e.g. Amoonguss) from fielding near-empty movesets —
they get their best 4 *eligible* moves instead, which is also the closest
1v1-endgame analogue of what they'd actually click.

## Battle simulator — sanity gate

### D24: Garchomp vs Rotom-Wash deviates from the spec's expected result — verified as format math
The spec expects Rotom-W to win ~80%+ ("Hydro Pump 2HKOs Garchomp; Levitate
means Earthquake does nothing"); the simulator gives Garchomp ~100%. Debugged
per the gate rule and root-caused to the metagame data, not the policy:
this format's modal Rotom-W is an offensive spread (Modest, 32 SpA / 32 SpE,
2 HP SP → 127 HP / 127 Def), not the Gen-9 bulky pivot the expectation
assumes. Jolly Garchomp outspeeds it (169 vs 138) and Dragon Claw (80 BP,
STAB, atk 182) is a guaranteed 2HKO (min roll 66 > 127/2), while Champions'
Hydro Pump is 80-accurate and needs two turns Rotom never gets. Even Rotom's
optimal line loses on paper: T1 Will-O-Wisp (takes 76, leaving 51), burned
Claw does 33–39, so Rotom dies turn 3 before the second Hydro can fire; no
crit or miss path exists (Claw is 100% accurate, crit Hydro still fails to
OHKO). The policy correctly finds the matchup unwinnable. Precedent: D3
(Champions' level-independent stats shift damage ratios above Gen-9
intuition). Logged in scripts/sim-sanity.ts as DEVIATION, not FAIL.

### D25: Amoonguss sanity case uses a synthetic variant
Amoonguss is below the scraper's usage cutoff and has no entry in
defender-variants.json, but the spec names it in a sanity matchup. The gate
uses a standard bulky set (Calm, 32 HP / 32 SpD, Regenerator, Spore /
Pollen Puff / Giga Drain / Protect) defined inline in scripts/sim-sanity.ts.
Related fix: Pollen Puff was removed from the v1 move exclusion list —
against an enemy it is a plain 90 BP attack; only its ally-heal mode is
teammate-dependent.

## Battle simulator — frontend QoL (user request, 2026-07-06)

### D26: Custom combobox instead of a component library
The team-builder core selector moved from toggle-pills over all 89 variants
to a search-filterable combobox with the selected core rendered as removable
chips. The codebase has no component library (plain React + CSS throughout),
so a ~100-line custom combobox (`src/components/Combobox.tsx`: substring
filter, keyboard navigation, outside-click close) was written rather than
introducing Radix/Headless UI as a dependency for a single control. Selected
variants are excluded from the dropdown options, and the 4-Pokémon core limit
disables the input rather than individual options.

### D27: Weakest-matchups section shares the partner-suggestion weighting
The team builder now lists the core's worst matchups above the partner
suggestions, ranked by `usage_weight × (1 − team_best) × urgency(team_best)`
— the same urgency function suggestPartners uses, so the two lists
prioritize identically ("what hurts most" ↔ "who fixes it"). The shared
per-opponent computation lives in `computeTeamBest` (lib/analysis/team.ts,
mirrored in src/lib/matchupDb.ts per the existing Node/browser split) rather
than being duplicated in each ranking. Both lists show the same row count
(TOP_N = 20). Rows expand accordion-style (one at a time) into a card with
per-member win rates, the opponent's metagame weight, and the reused
ConditionCards component (extracted from the matchup detail page).

### D28: Pokémon detail page + cross-page component sharing (user request, 2026-07-06)
New `/pokemon/:variantId` page (nav between Matchups and Team builder):
searchable selector → best/worst top-5 matchup lists with a
"Metagame-weighted" (default) ↔ "Raw win rate" sort toggle. Weighted ranking
= usage_weight × p for best and usage_weight × (1 − p) for worst — the same
usage-weighting philosophy as the team builder (the builder's extra urgency
factor is core-relative and has no analogue for a single Pokémon; the
weight × loss-rate form is exactly `weakestMatchups` with a 1-Pokémon core,
up to the urgency factor). Selecting navigates to the id-bearing URL so
matchup views are deep-linkable; the bare `/pokemon` route renders only the
selector. Supporting refactors so all three analysis pages share primitives
instead of duplicating them: `useVariants` hook (one fetch/label/weights
source), `ConditionSelect`, and `MatchupCard` (the accordion expansion card,
extracted from the weakest-matchups section; team builder composes it with
its per-member table). Matrix row/column headers now link to the page
(hover underline + accent as affordance); cells still open the pairwise
matchup detail.

### D29: Weakest matchups switch to lexicographic sort; suggestPartners re-aligned to match (user request, 2026-07-06/07)
The weakest-matchups list now ranks opponents lexicographically by two keys,
both descending (worst first):
primary `weight(V) × (1 − team_best(core, V))`, then secondary
`weight(V) × (1 − team_second_best(core, V))`, where `team_second_best` is the
second-highest win rate among core members against V (0 for a single-member
core, so its complement is 1 and the secondary key reduces to `weight`). The
intent: once the field is broadly covered, the primary keys of the remaining
opponents sit close together, and the secondary key surfaces the matchups
with no *redundant* answer — thin backup coverage the single-best-answer
score (old D27 `weight × (1 − team_best) × urgency`) could not see.

**Correction (same day):** the request phrased the keys as
`weight × team_best` sorted *ascending*. Taken literally that is dominated by
`weight` (which spans ~100× across the field), so low-usage opponents produce a
near-zero product regardless of win rate and flood the top — e.g. a rare
Sableye-Mega the core beats 100%/100% sorted as the *worst* matchup. The
`(1 − p)` complement with descending sort is the non-degenerate reading that
matches the stated goal ("worst first") and the "roughly what the current
logic does" note (D27 was itself `weight × (1 − best)` descending). A
well-covered opponent now scores `weight × 0 = 0` and sinks to the bottom.

The lexicographic comparison is exact (no epsilon bucketing): with continuous
usage weights the primary key ties only on exact equality, so the secondary
key acts as a strict tie-breaker; the "broadly covered ⇒ secondary decides"
behavior emerges from the clustering of primary values, not from rounding.

**`suggestPartners` re-aligned to match (user request, 2026-07-07):** the
partner score now credits improvements to *both* the best and the backup
answer, so it values the same thing the ranking does. For each opponent V a
candidate's win rate `p` is folded into the core's top-two answers:
`best_after = max(best, p)`, and `second_after = best` if `p ≥ best` (the old
best is demoted to backup) else `max(second, p)`. The score sums
`weight(V) × [ (best_after − best) × urgency(best)
             + BACKUP_WEIGHT × (second_after − second) × urgency(second) ]`
with `BACKUP_WEIGHT = 0.5`, mirroring the ranking's primary-over-secondary
precedence (a scalar sum can't be strictly lexicographic, so backup gains are
discounted rather than dominated). A strong candidate that duplicates an
existing answer now earns backup credit `weight × 0.5 × (best − second) ×
urgency(second)` — thin backups (low `second`, high urgency) reward redundancy
most, exactly the opponents the secondary key elevates. `urgency(second)` is
1.5 for a single-member core (no backup exists), so the backup term there
rewards adding a broadly-competent second answer to high-usage threats. The
displayed "biggest fixes" stay best-answer upgrades (pushed only when
`best_after > best`) for legibility, but are ordered by each opponent's total
score contribution. Both modules still share the `computeTeamBest` foundation.

### D30: Pokémon-page set display + win-rate thresholds + team-builder matchup probe (user request, 2026-07-06)
Three UI tweaks: (1) The Pokémon detail page shows the exact set the sim
uses (SP spread, nature, ability, item, top-4 eligible moves) via a shared
`StatBlock` component extracted from the matchup detail page's "Sets used"
block. The move list mirrors `lib/sim/sets.ts` `pickMoves`/`EXCLUDED_MOVES`
client-side (the Node source can't be bundled — it pulls in
pokemon-showdown), so "Sets used" now shows the 4 played moves rather than
the top-8 by usage. (2) The page's best/worst lists move from a fixed top-5
to win-rate thresholds (best > 80%, worst < 20%), with empty states and each
list scrolling within its column when long. (3) The team builder gains a
"Check specific matchup" combobox below the weakest list that renders the
weakest-matchup card for the core's best answer vs. any chosen opponent
(expanded by default), reusing `WeakMatchupCard` and a new `weakMatchupFor`
(shared `toWeakMatchup` builder with `weakestMatchups`) so probing an
arbitrary opponent draws on the same per-member computation as the list.
Team-builder core and probe stay in component state (no URL params, as
before); the id-bearing routes on the matchup/Pokémon pages are unchanged.

### D31: Metagame power-rankings page (user request, 2026-07-07)
A `/rankings` page ranks every variant by its **metagame-weighted win rate**
under one starting condition: for variant A,
`expected_win_rate(A, C) = Σ over V of weight(V) × P(A beats V | C)`, i.e. the
average chance A beats a random opponent drawn from the field by usage.

Three modeling choices worth recording:

1. **Weights are normalized to sum to 1 across the variant set.** The raw
   `weight` in `defender-variants.json` is a team-inclusion rate (the 89 sum to
   ~5.4, one per team slot). That is fine for the scale-invariant rankings the
   team builder and Pokémon page already do (`weight × p`), but for a *weighted
   mean* it must be a distribution or the "win rate" wouldn't land in [0, 1].
   Normalization lives in a shared `normalizeWeights` helper (exposed as
   `weightsNormalized` from `useVariants`) so every page shares one definition,
   per the task's "factor it into a shared helper" instruction. The **Usage**
   column still shows the raw team-inclusion rate — that's the number the
   Pokémon and team-builder pages already display as "% of teams", so the two
   readings stay consistent (normalized weight is an internal math detail).

2. **Self-matchups are synthesized at 50%.** The matrix omits A-vs-A rows (the
   sim only ran `A != B`), but the task requires including self: a speed-tied
   mirror is a coin flip, so `P(A beats A) = 0.5`. Dropping self instead would
   silently renormalize each row's field to 88/89 and shift every number; adding
   it at 0.5 keeps the mean over the whole field. (Verified: with self included
   the normalized field weights sum to exactly 1.0 across all 89 ids.)

3. **Condition lives in a query param** (`/rankings?condition=trick_room`) so a
   filtered view is shareable, and changing it re-runs the whole ranking live —
   switching to `trick_room` floats slow bulky abusers (Torkoal, Camerupt,
   Mawile, Swampert) to the top where `fresh` favors fast threats (Floette-Mega,
   Dragonite-Mega, Charizard-Y), which is the "who's most dangerous in Trick
   Room" question the page is meant to answer. Columns (rank, name, win rate,
   usage) are client-side sortable; **rank stays pinned to the win-rate order**
   (a variant's standing in the meta) even when the table is sorted by another
   column. A Megas / non-Megas / all filter (on the authoritative `is_mega` field) hides rows without recomputing the ranking, so rank stays the variant's standing in the whole 89-variant field (Megas show as a non-contiguous 1,2,4,5,… set). There is no reusable sprite/"chip" primitive in the app — the matrix
   and detail pages render variants as clickable text labels via `label(id)` +
   a `/pokemon/:id` link — so the rankings rows follow that same convention.

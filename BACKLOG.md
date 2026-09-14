# Backlog

Feature ideas queued for future work, ordered by suggested priority. Sizes:
- **Small** — one session
- **Medium** — two to three sessions
- **Large** — planning session followed by one or more implementation sessions

Item numbers are stable. They do not change when priority changes, so references elsewhere stay valid.

---

## Status

Four specs now exist: `SPEC-damageviz.md`, `SPEC-sim.md`, `SPEC-team-evaluator.md` and `SPEC-teambuilder.md`. The teambuilder is the newest and the largest, and it reshuffled this list: several items that were speculative are now prerequisites for it, one has been absorbed into it, and one is superseded by its design.

**Teambuilder Phases 0 and 1 are complete and on `main`.** Phase 0 delivered regulation-driven format rules, variant schema v3 and the data contracts; Phase 1 delivered all six screens against fixture data — Build, Generate, Team detail, Pokémon detail, Movesets and Data status. Two of those already run on real data rather than fixtures. The evaluator presentation pass merged alongside them.

Phase 2 is next in the spec's order, and the Priority 0 items below are what stand between here and it. Items 03 and 11 have since closed. Item 03 removed the compute wall in front of most of what remains: changes that move the variant set now cost only the pairs they actually touch, so item 04 and Phase 2's moveset selection no longer need to wait for a batched rebuild. Item 11 unblocked Phase 4.

The teambuilder also turned up three defects in the earlier specs. Those were item 09, now closed — two had been fixed in passing while items 01–08 were built, and the third is handled by item 10.

---

## Completed

### 01. Endgame test suite *(Small)* — done

Merged in [#3](https://github.com/ashepard11/cinnabar-lab/pull/3). `scripts/endgame-cases.ts` and `scripts/endgame-suite.ts`, wired into CI. Any regression in the curated endgames fails the build.

This became more important than when first written, and the reason is worth keeping: the teambuilder derives chip damage and the whole positioning analysis from the simulator's recorded HP distributions rather than simulating them separately. Policy error no longer affects one number, it propagates into three axes at once, and it does so silently. The suite is the only thing measuring that.

**Unblocked:** 07

### 02. Content-addressed variants and matchup keys *(Medium)* — done

Merged in [#4](https://github.com/ashepard11/cinnabar-lab/pull/4). `lib/variant-cid.ts` hashes a variant's resolved battle set — species, item, ability, nature, level, SP spread, resolved moveset — into a 64-bit content id. Matchup rows key on cids plus a provenance run key covering policy, calc and engine versions; readers go through the `matchups_current` view. `scripts/migrate-matchups-v2.ts` migrates a v1 file in place with no re-simulation.

The human-readable slug survives as `Variant.id` for display and URLs. The teambuilder's custom sets depend on the cid entirely: the same set defined by two different users is the same variant, computed once and cached for both.

**Unblocked:** 03, 05, teambuilder Phase 6b

### 03. Incremental matrix refresh *(Medium)* — done

`lib/analysis/refresh.ts` plans a refresh, `scripts/refresh-matchups.ts` runs
one, and `lib/analysis/pool.ts` holds the worker pool both it and
`build-matchups` now share. Schema v3 adds `regulation` to the run key.

```
npm run refresh-matchups -- --dry-run
```

Run against the live file it reported 79 variants unchanged, 5 added, 10
retired, and **4,050 cells to simulate against 30,810 reused — 11.6% of a
rebuild**. That closed the staleness `/data-status` had been flagging since the
variant set moved from 89 to 84.

Reuse keys on content ids, so a row survives exactly as long as both its cids
and its run key do — weight drift, move reordering within the same top four,
tier changes and slug renames are all free. Work units come from asking the
database which rows exist rather than from the diff, which is the same answer
when the last build finished and the right one when it did not, so crash
resumption is the same mechanism rather than a second one.

Planning is read-only and `--dry-run` opens the file read-only, so asking what
a change costs cannot itself change anything. A new run key — policy, calc,
engine or regulation — invalidates everything by design, and the script refuses
to run that without `--full` rather than quietly starting an overnight job.
Pruning is opt-in for the same reason it is worth having: retired rows are
cache, since a variant that leaves and returns is byte-identical by cid, but
the file ships to browsers so size is a real consideration.

The `CORE_TIER_SIZE` lever this item was asked to settle is settled, and the
answer is that it was measuring the wrong thing — see DECISIONS.md D41 and the
note under item 04.

Not wired into the weekly workflow: that would turn a two-minute scrape into a
long simulation on a shared runner every week. Flagging the staleness instead is
item 18.

**Unblocked:** 04, 05, teambuilder Phases 2, 6b

### 11. Shared effect table *(Small)* — done

`lib/effects.ts` holds the curated tables and the whole vocabulary: ten
categories, their labels and descriptions, the five display groups, the
teambuilder's nine-category subset, and the dex-validation gate.
`lib/evaluator/tags.ts` keeps the rule engine and imports the rest;
`lib/teambuilder/types.ts` re-exports rather than redefining.

**There were three copies, not two.** The third was `BoardControlTable.tsx`,
holding the five display rows the teambuilder's `DISPLAY_GROUPS` was mirroring
— so lifting only the lib categories would have left the two that had actually
diverged still diverged.

**The divergence was real and is now fixed.** D38.3 moved Wide and Quick Guard
into the Protects row for display; the evaluator implemented it, the
teambuilder's mirror did not. The same two moves would have shown under Option
control on the Build screen and under Protects on the evaluator — on a page
that renders both.

`displayGroupFor` now throws on an unknown category instead of the
teambuilder's silent `'option'` fallback, which is how two tables disagree for
months without anyone noticing. `scripts/test-effects.ts` (27 checks, in CI)
asserts the re-exports are the *same objects*, so a future copy-paste fails
rather than passing until it rots. The dex-drift gate stays in
`test-evaluator.ts`, which needs the dex loaded.

`priority` remains in the taxonomy and out of `TEAMBUILDER_CATEGORIES`: damage
priority is already inside a Pokémon's matchup numbers, while the evaluator has
no matchup numbers behind its inventory. See DECISIONS.md D42.

**Unblocked:** teambuilder Phase 4

---

### 08. Team evaluator *(Large)* — done

Merged in [#5](https://github.com/ashepard11/cinnabar-lab/pull/5), specified in `SPEC-team-evaluator.md`, live at `/team-evaluator`. Showdown paste parsing, ability-aware type matrices, relevant BST, board control inventory, RNG exposure, damage sources, and worst matchups via nearest-variant matching. [#6](https://github.com/ashepard11/cinnabar-lab/pull/6) is an open draft adding a presentation pass.

Two dimensions overlap with the teambuilder and it should reuse these rather than reimplementing them. Worst matchups uses the same ranking logic. Board control inventory uses the evaluator's tag tables — see item 11 for the consolidation that still needs doing. The teambuilder's team detail screen should embed these panels rather than building parallel ones.

A presentation pass followed in [#6](https://github.com/ashepard11/cinnabar-lab/pull/6) (DECISIONS.md D38): aggregate-first defensive type summary with the per-Pokémon grid behind a disclosure, offensive coverage moved to categorical count rows alongside damage sources, board control consolidated from ten categories to five display rows. It sat as a draft for two months and was rebased onto Phases 0–1 before merging, since it rewrote every evaluator component those phases had touched.

Its remaining gaps are recorded under "Known limitations — team evaluator" in the README, not here.

---

### 09. Fix the upstream spec defects *(Small)* — done

All three defects resolved, 2026-09-13. Two turned out to have been fixed in passing by the pipeline diverging from the specs; the third was real.

**Variant records carry no moves.** Was already fixed in the pipeline — variants carry a `moves` array with per-move usage and `lib/sim/sets.ts` resolves the top four eligible. Only the specs were wrong, and they are now corrected.

**Stats are modelled as EVs.** Mostly moot: the Pikalytics API returns spreads SP-denominated, so the variant pipeline never converted from EVs, and `lib/sp.ts`'s `evToSp` is used only for pasted Showdown teams in the evaluator. What was genuinely missing was validation — nothing checked the 66-point total or the 32-per-stat cap. `validateSpSpread` / `assertSpBudget` in `lib/format-rules.ts` now enforce it at build and load time, rejecting rather than clamping.

**Regulation M-B Season 3 is hardcoded.** Fixed structurally by item 10: both format ids resolve from `CHAMPIONS_REGULATION`. M-B remains the default because it is the only regulation the vendored Showdown build can supply and the only one with scraped usage.

**Delivered:** schema v3 for `defender-variants.json` (`regulation`, `national_dex`, `set_label`, `moves_source`, `tier`) with load-time validation in `lib/variant-schema.ts` and an in-place migration (`npm run migrate-variants`) that preserves every content id, so `matchups.sqlite` stays valid. Errata blocks added to `SPEC-damageviz.md` and `SPEC-sim.md` with the bodies corrected inline. The bump went to 3 rather than the spec's "2" because `schema_version: 2` already shipped with a different shape. See DECISIONS.md D39.

**Unblocked:** everything

---

## Priority 0 — blocks the rest of the teambuilder

Phases 0 and 1 are done. Items 03 and 11 have since closed, leaving item 10 — which is one thing: replace the vendored Showdown build. Item 04 waits on it for the item universe.

### A note on rebuilding the matrix

Several queued items invalidate `data/matchups.sqlite`, which is hours of compute. They should be batched into one rebuild rather than paid for separately:

- **Re-vendoring Showdown for M-C** bumps `SIM_ENGINE_VERSION`, which is part of the provenance run key, so every row is invalidated.
- **Item 04, defensive item variants** changes the variant universe, so the pair set changes.
- **Teambuilder Phase 2** replaces the naive top-four moveset selection, which changes the resolved set — and therefore the content id — of any variant whose four moves move.
- **Item 07, a better decision policy** changes `policy_version`, invalidating every row.
- **Re-scraping usage for M-C** changes weights and the variant set.

Item 03 is done, which changes the shape of this. Two of the five entries above are now cheap rather than expensive, because they change the variant universe without changing the run key — item 04 and Phase 2's moveset selection both cost only the pairs involving variants whose content id actually moved. The other three bump the run key and still invalidate everything.

The unrelated staleness is also gone: the matrix was built against 89 variants while the weekly refresh had moved the set to 84, and the first incremental refresh closed that for 4,050 cells instead of 34,860.

Sequence suggestion, revised: do item 04 and Phase 2's moveset selection whenever they are ready, refreshing after each — neither needs to wait for a batch any more. Batch only the run-key changes: the M-C re-vendor and re-scrape together, since the engine bump invalidates the matrix either way. Item 07 stays its own rebuild, because the point of it is measuring how much the policy changes.

### 10. Regulation-driven format rules *(Medium)*

Regulations roll over every three to four months and each changes the legal Pokémon pool, the legal item list, the Mega Evolution list and sometimes individual move legality. M-C added 36 Pokémon, 18 items and 6 Megas over M-B. Any hardcoded list is wrong within a season, and the two format identifiers in `lib/scrape.ts` and `lib/sim/engine.ts` are both M-B.

Build `lib/format-rules.ts` around a regulation identifier read from configuration, sourcing legality from the Pokémon Showdown data the sim already depends on. Export the clauses the search needs as data rather than code: item clause, species clause keyed on National Pokédex number, Mega limit, SP budget and cap, team size and bring count.

Switching regulations then becomes a configuration change. It also makes backtesting against an earlier regulation possible, which the teambuilder's validation depends on.

**Deliverable:** `lib/format-rules.ts`, plus a regulation selector on the data status screen.

**Progress.** `lib/format-rules.ts` and `scripts/build-format-rules.ts` landed; `npm run build-format-rules -- --all` resolves M-A and M-B into `data/format-rules-<id>.json`. Both hardcoded format ids are gone: `lib/scrape.ts` and `lib/sim/engine.ts` now read the active regulation from `CHAMPIONS_REGULATION`, defaulting to M-B. M-B resolves to 323 species / 148 items / 74 Mega formes, and the item count matches the regulation announcement exactly. `scripts/build-matchups.ts` stamps the regulation, and since item 03 put it in the run key, one file can now hold two regulations without their rows becoming indistinguishable — a rollover reuses every row whose variant survived it rather than invalidating the table.

Phase 1's data status screen (`/data-status`) now renders every regulation with its dates, formats and usage source, and marks M-C as declared-but-unsourceable with the reason. What is missing is the *selector*, and it is not blocked on interface work any more — it is blocked on there being a second regulation worth switching to. A dropdown with one working option would be a worse lie than the sentence currently in its place.

So the remaining work is one thing, not two: **replace the vendored Showdown build.** That resolves M-C legality and makes the selector meaningful at the same time. It also needs M-C's Pikalytics format id confirmed against the live API, since guessing one is worse than admitting ignorance — the API answers an unrecognised format with `[]` rather than a 404.

Per-species move bans stay empty regardless: Showdown models them as learnset removals, indistinguishable from never learning the move. See DECISIONS.md D39.

**Blocks:** teambuilder Phases 2, 8; item 15

### 04. Defensive item variants *(Medium)*

Extend the item bucketing used for offensive items — per-Pokémon, threshold-based, aggregate the rest as "no item" — to cover legal defensive items. Only the most common defensive items per Pokémon get their own variants.

Derive the item universe from item 10 rather than a hand-maintained allowlist, since M-C added Air Balloon, Terrain Extender and the four terrain Seeds, and the next regulation will add more.

Two items need their own treatment. Choice Scarf is a property of a variant rather than a condition. Air Balloon's Ground immunity persists until the holder is hit, which changes matchups enough to warrant its own bucket.

Sim variants will diverge from damage-viz variants. Either split into two files or add a `sim_expanded` flag on shared records.

Also closes the evaluator's defensive-item fidelity gap.

**Cheaper than it was.** Item 03 means this no longer implies a rebuild: adding defensive buckets leaves every existing variant's content id untouched, so only pairs involving the new variants get simulated. Run `npm run refresh-matchups -- --dry-run` after regenerating variants to see the bill before paying it.

**This is also the trigger for reconsidering the core tier.** The tier currently gates nothing — every pair is simulated regardless — because at 84 variants skipping extended-against-extended saves 990 pairs of 3,486, which does not pay for the failure mode a gate creates. Pairs are quadratic, so if this item takes the universe to around 200 variants that becomes 19,900 pairs and the calculation changes. See DECISIONS.md D41.7.

**Depends on:** 03 *(done)*, 10

## Priority 1 — do next

### 18. Flag when derived data needs rebuilding *(Small)*

The weekly refresh regenerates usage and variants but not the matchup matrix,
so `/data-status` goes stale every Monday until someone notices and runs
`npm run refresh-matchups`. Item 03 made the fix cheap and made the cost
visible on that screen; what is missing is anything that tells you to look.

Deliberately **not** solved by wiring the refresh into
`.github/workflows/refresh-data.yml` (user decision, 2026-09-13). That turns a
two-minute scrape into a long simulation on a shared runner every week, and
pays for a rebuild nobody asked for. Flag, do not fix.

Shape is open. The cheapest version is a CI step running
`npm run refresh-matchups -- --dry-run --json` after the weekly data commit and
failing, or opening an issue, when `cells.to_simulate` exceeds zero. The
planner already emits exactly that number and touches nothing, so the work is
in the notification rather than the detection.

Worth generalising past the matrix while building it: the evaluator dex and the
resolved format rules have the same property — derived, committed, and silently
invalidated by an upstream refresh.

### 07. Better decision algorithm for setup endgames *(Large)*

The current policy misses long-horizon setup plans — Bulk Up Bitter Blade Ceruledge, Belly Drum Azumarill, Iron Defense Rest walls. The winning line is often "set up four turns, then start winning" and needs six to ten turns of search to see.

Options:
- Hand-coded position patterns that extend search depth on matching subtrees
- MCTS or UCT as a full replacement
- Selective escalation to MCTS only on positions the fast policy cannot resolve

Promoted from Priority 3 for the same reason item 01 was. Every derived quantity in the teambuilder inherits the policy's mistakes, and a policy that cannot play setup endgames will systematically misprice exactly the Pokémon the mitigation and boost conditions are meant to surface.

Item 01's suite now says how big the problem is. Read it before choosing between patching and replacing.

**Depends on:** 01 *(done)*

---

## Priority 2 — high value

### 14. Bring-4 model *(Large)*

Champions is bring-6, pick-4, with open team lists. Both sides see all six before choosing their four. The teambuilder currently approximates this with a λ term that blends a team's second-best answer into its best.

A real model would ask, for each opponent team or opponent Pokémon, which four the team brings and how that selection performs, rather than assuming the best single answer is always available. Open team lists make this more tractable than in a closed-list format, because the selection is a complete-information decision rather than a guess.

The single highest-value modelling upgrade in the teambuilder. It replaces the crudest part of the scoring function.

### 15. Team-archetype metagame model *(Large)*

The teambuilder models the metagame as a bag of independent Pokémon weighted by usage. Pokémon travel together, and Pikalytics publishes pairing data.

Modelling the field as a distribution over team archetypes fixes three separate limitations at once. Opponent condition exposure stops using a global share and starts asking whether this specific opponent appears on teams that set Trick Room. Positioning gains the cross-Pokémon case, where a Pokémon switches in on one opponent to fight a different one. And the bring-4 model in item 14 gets something coherent to select against.

Would also give the evaluator the metagame baseline column it currently lacks.

**Depends on:** 10, for backtesting against earlier regulations
**Unblocks:** part of 14

### 12. Free damage boosts as a derived condition *(Small)*

The teambuilder derives chip damage from stored HP distributions with no additional simulation, on the principle that anything truncating an already-simulated battle can be read off its results.

Free damage boosts have the same property. A Defiant proc or a Weakness Policy activation kills the opponent sooner, so given each side's per-turn cumulative damage, the turn the opponent falls is a lookup. Storing those curves for the core-against-core block makes the whole `atk_up` and `spa_up` extension free for contingent boosts, leaving only setup moves needing simulated cells.

Try this before building the simulated version. It is small, and if it works it removes a large chunk of the extension roadmap.

**Depends on:** teambuilder Phase 5

### 05. Custom set simulation *(Large)*

Now specified in `SPEC-teambuilder.md` Phase 6b rather than here. Kept as a pointer so references resolve.

The spec covers the set editor, provisional ranking from the damage calculator while simulations run, warm-starting from the nearest preset, and the deployment tradeoff between client-side simulation and a job queue. The recommendation is the job queue, because content-addressed IDs make a shared cache accumulate.

Also closes the evaluator's nearest-variant approximation, which currently badges inexact matches and drops species outside the variant set.

**Depends on:** 02 *(done)*, 03 *(done)*

---

## Priority 3 — larger investments

### 13. Extrapolated mitigation and passive healing *(Medium)*

Chip damage is free to derive because it truncates a simulated battle. Damage mitigation and passive healing extend one, so the recorded data stops exactly where it is needed.

They can still be estimated. Recording each side's remaining HP at the moment the other fainted, which the teambuilder's matrix already collects, gives a starting point: extrapolate at the observed per-turn damage rate to find whether the extra turns of survival are enough to flip the result.

This is research, not construction. Build the estimate, compare it against a few hundred real simulated mitigation cells, and report the error distribution. If it is close, a whole family of conditions becomes free. If it is not, say so and simulate them.

### 16. SP and spread optimization *(Large)*

Every variant uses its modal spread. Real teambuilding does considerable work here, and the 66-point budget with a 32-per-stat cap makes the tradeoffs tighter than the old EV system did.

Given a team and a metagame, search each member's spread for allocations that flip specific matchups. The search space is large but heavily constrained, and the outcome gate from the teambuilder gives a cheap test for whether a reallocation changes anything at all.

**Depends on:** 09, for the SP budget to be validated rather than assumed

### 17. Support moves during simulation *(Large)*

`SPEC-sim.md` scopes these out of v1. Conditions are injected as starting states rather than played, which is why the teambuilder's enabler catalog exists in its current form.

When this lands, self-targeted enablers must be removed from the catalog or their credit is counted twice: Dragon Dance is an enabler precisely because the simulator cannot play it. The teambuilder spec leaves a comment at the crediting site.

This also changes what `moves_first` means, since Tailwind and Trick Room become playable actions with real durations rather than a permanent speed flip.

---

## Superseded

### 06. Contextual boost sweeps per Pokémon

Absorbed into the teambuilder's condition and gate design.

The original idea was to replace generic ±1 stat sweeps with per-variant realistic states based on moveset and ability, so that Bulk Up Kingambit sweeps Attack boosts and Calm Mind Floette sweeps joint boosts. The structural gate does exactly this: a condition is simulated for a pair only when either Pokémon has something that reads it, so a Pokémon without setup moves never gets a boost cell.

The open question recorded here was how to aggregate when variants become asymmetric across the matrix, with each Pokémon having different valid conditions. That is answered too. Every pair-and-condition combination has a row, and a gated-out cell inherits the value of the cell it was compared against rather than being absent, so the matrix is dense even though most of it was never simulated. Aggregation needs no special handling.

The preference recorded here for keeping each state as its own condition, rather than marginalizing over an artificial state-probability distribution, is now the design. The teambuilder applies no reliability priors at all and reports a floor-to-ceiling band instead.

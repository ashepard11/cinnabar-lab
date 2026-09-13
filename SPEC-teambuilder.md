# Pokémon Champions VGC Automated Teambuilder — Implementation Spec

## Goal

Search the space of legal 6-Pokémon teams and rank them by expected performance against the usage-weighted metagame.

Three things determine whether a team answers an opposing Pokémon.

**Matchups.** Does some team member beat it in a straight fight? This is offensive pressure, and it is what the battle simulator measures directly.

**Enablers.** Does some team member beat it under a condition that a teammate can bring about? A Pokémon that loses a matchup 5% of the time normally but wins 95% of the time when it moves first is a good answer, provided the team contains something that can make it move first. Enablers widen the set of situations in which your team is the one applying pressure.

**Positioning.** Can that team member actually get into the fight? A Pokémon that wins a matchup from full HP but cannot switch in without losing half its health has a worse matchup than the number says. Positioning is about reaching the favourable situations that matchups and enablers describe.

The system runs in two modes against the same engine:

- **Guided.** Present a ranked list of candidates for the first slot, let the user choose, re-rank candidates for the second slot given that choice, and continue to six.
- **Automatic.** Search the whole space and return a ranked list of complete teams.

Both are graphical. There is no command-line interface for anything a user does.

This is the third project in the repository, following `SPEC-damageviz.md` and `SPEC-sim.md`. It consumes their outputs.

## Prerequisites

| Artifact | Status | What this project needs from it |
|---|---|---|
| `SPEC-damageviz.md` | Complete | Pikalytics scraper, `lib/variants.ts`, `lib/calc.ts`, usage weights |
| `SPEC-sim.md` | Complete | `lib/sim/*`, the battle harness, `matchups.sqlite` |
| `BACKLOG.md` #02, content-addressed IDs | Required first | The variant universe changes often here, and stable hashed IDs prevent repeated data migrations |
| `BACKLOG.md` #03, incremental refresh | Required first | Adding a condition or a regulation should not require rebuilding the whole matrix |
| `BACKLOG.md` #04, defensive item variants | Required first | Teambuilding without Assault Vest and Sitrus Berry variants is not credible |
| `BACKLOG.md` #08, team evaluator | Parallel work | Shares the board-control effect table. Build it once in `lib/effects.ts` and import from both. |

---

## Core design principles

### Conditions and enablers

A condition is a state the simulator cares about. An enabler is a way of reaching it.

A naive taxonomy would treat Tailwind, Icy Wind, +2 Speed, Trick Room and Thunder Wave as five separate conditions. The simulator does not care which of them happened. It cares about one thing: does this Pokémon move first? So `moves_first` is the condition, and all five are enablers of it, catalogued against the Pokémon that supply them.

The condition set stays small as the enabler catalog grows. A new speed-control move adds an enabler, which costs nothing to simulate, rather than a condition, which costs a pass over the pair matrix.

The mapping from mechanism to condition is many-to-many. Bulk Up raises Attack and Defense in one action, so it enables both a damage boost and physical damage mitigation. The catalog stores one record per mechanism-and-condition pair rather than forcing each move into a single category.

### Everything is gated

A condition is simulated for a pair only when it could change the outcome, and two separate tests decide that. The structural gate asks whether either Pokémon reads the condition at all. The outcome gate asks whether the condition moves anything the battle depends on. Phase 3 covers both.

### Some conditions need no simulation

A condition that truncates a battle the simulator already ran can be read off the recorded results rather than simulated again. Chip damage is the main case, and the same reasoning drives the positioning analysis in Phase 6. Phase 3 explains where this works and where it breaks.

### Every condition declares its shape

```typescript
type SimulatedCondition = {
  id: string;
  structural_gate: (a: Variant, b: Variant, context: ConditionContext) => boolean;
  implementation: BattleStateMutation;
  enablers: Enabler[];
};

type DerivedCondition = {
  id: string;
  derives_from: 'final_hp_distribution' | 'cumulative_damage_curve';
  transform: (cell: MatchupCell, magnitude: number) => number;   // returns p_A_wins
  excluded_when: (a: Variant, b: Variant) => boolean;
  enablers: MagnitudeEnabler[];
};
```

Nothing enters the registry without every field filled.

---

## Known gaps in the upstream specs

Three things need fixing before the universe is built. Two of them are problems for the sim project as well.

**The variant records have no moves.** `SPEC-damageviz.md` Phase 2 defines a variant as `{id, species, is_mega, item, ability, nature, evs, weight}`. `SPEC-sim.md` Phase 0 requires a `PokemonSet` containing `moves[]`. Nothing produces the moves array. The sim project cannot run on the viz project's output as currently written.

**Only one set exists per Pokémon.** The current logic produces one set per species and item bucket. A Kingambit holding Assault Vest and a Kingambit running Swords Dance are different Pokémon for teambuilding purposes.

**Stats are modelled as EVs.** Champions has no EVs and no IVs. Every Pokémon is Level 50 with perfect stats, and investment is 66 Stat Points distributed freely with a cap of 32 per stat, where each point adds exactly 1 to the final stat. The damage-viz spec converts SP to EVs at roughly 8:1 for `@smogon/calc`. That conversion is lossy at the margins and hides the real constraint, which is the 66-point budget. Store SP natively and convert only at the boundary of whatever calc library needs EVs.

The upstream specs also hardcode Regulation M-B Season 3, which ended on 9 September 2026.

---

## Phase 0: Format rules and data contracts

### Regulations change, so read them rather than hardcoding them

Regulations roll over every three to four months, and each changes the legal Pokémon pool, the legal item list, the Mega Evolution list and occasionally individual move legality. Any list written into this spec will be wrong within a season.

Build `lib/format-rules.ts` around a regulation identifier read from configuration:

```typescript
type FormatRules = {
  regulation_id: string;            // e.g. "M-C"
  active_from: string;
  active_until: string;
  legal_species: Set<SpeciesId>;
  legal_items: Set<ItemId>;
  mega_capable: Map<SpeciesId, ItemId>;
  banned_moves: Map<SpeciesId, Set<MoveId>>;
  level: 50;
  sp_total: 66;
  sp_per_stat_cap: 32;
  team_size: 6;
  bring_count: 4;
  open_team_lists: true;
  item_clause: boolean;
  species_clause_key: 'national_dex_number';
  max_megas_per_team: number;
};
```

Source the legality sets from the Pokémon Showdown data the sim project already depends on, keyed by the regulation's format ID. Switching regulations then becomes a configuration change rather than a code change.

### What Regulation M-C establishes

Current as of this writing, running 9 September to 2 December 2026. Verify these against `lib/format-rules.ts` at runtime rather than trusting this section.

- 260 legal Pokémon and 166 legal items, up from 224 and 148 in M-B. Nothing legal in M-A or M-B was removed.
- Six new Mega Evolutions: Absol Z, Garchomp Z, Lucario Z, Salamence, Golisopod and Baxcalibur. Only listed species can Mega Evolve, and one Mega Evolution is permitted per battle.
- Eighteen new items, including Air Balloon, Terrain Extender, the four terrain Seeds, Binding Band and Eject Button. Any item allowlist written before September 2026 is missing these.
- Item clause applies: no two Pokémon on a team may hold the same item.
- Species clause is keyed on National Pokédex number, so alternate forms collide. Heat Rotom and Wash Rotom cannot appear on the same team.
- No restricted legendaries, no Paradox Pokémon, no Treasures of Ruin.
- A small number of moves are banned on specific species by the 1.2.0 balance patch. These are per-species, not global.

Bring-6 pick-4 with open team lists is the selection rule. Both sides see all six of the opponent's Pokémon before choosing their four, which matters for the scoring model in Phase 7.

### Variant schema

```json
{
  "schema_version": 2,
  "regulation": "M-C",
  "generated_at": "2026-09-20T00:00:00Z",
  "variants": [
    {
      "id": "sha256:a3f9...",
      "human_id": "kingambit_assault_vest",
      "species": "Kingambit",
      "national_dex": 983,
      "set_label": "Assault Vest",
      "is_mega": false,
      "item": "Assault Vest",
      "ability": "Supreme Overlord",
      "nature": "Adamant",
      "sp": {"hp": 32, "atk": 32, "def": 0, "spa": 0, "spd": 2, "spe": 0},
      "moves": ["Kowtow Cleave", "Sucker Punch", "Iron Head", "Low Kick"],
      "moves_source": "modal_set",
      "weight": 0.081,
      "tier": "core"
    }
  ]
}
```

No `level` field, since every Pokémon is Level 50. No `ivs` field, since perfect stats are universal and cannot be lowered. Validate `sp` against the 66-point total and 32-per-stat cap on load, and reject anything that fails, since a scraped spread breaking the budget indicates a parsing error.

`national_dex` is stored because the species clause keys on it. Deriving it from a name string at search time is error-prone for forms.

Trick Room sets reduce Speed through a minus-Speed nature and zero SP investment only. There is no lower floor available.

### The other contracts

The interface is built before the pipeline, so the shapes it consumes must exist first. Define these in `lib/types.ts` and generate a fixture file for each: `Variant`, `SimulatedCondition`, `DerivedCondition`, `Enabler`, `MatchupCell`, `PositioningProfile`, `Candidate`, `TeamScore`, `CustomSetDraft`.

Expect these to change while the interface is being built. That is the point of building it first. They are not frozen until Phase 1 settles.

---

## Phase 1: Interface

Build the interface against fixture data before any of the pipeline exists. How the thing feels to use determines what the pipeline needs to produce, and discovering that after the matrix is built is expensive.

Generate fixtures with plausible shapes and values: thirty or so variants, a handful of conditions, a synthetic matchup table, a few scored teams. Hand-written is fine. The numbers do not need to be correct, only well-shaped.

### Screens

**Build.** The guided mode, and the primary screen. The current partial team sits across the top with a ranked candidate list below. Each candidate shows three things, because a candidate can earn its slot in three different ways:

- its marginal score, which is direct matchup coverage
- the conditions it adds that the team could not previously supply, with the speed tier of each enabler
- its positioning contribution, meaning how much it improves existing members' ability to get into their good matchups

A Pokémon can rank highly on any one of these while looking unremarkable on the others, and a list sorted only by marginal score hides two thirds of what matters.

When a candidate is selected, the user chooses among its preset sets or defines a new one, with legality and the SP budget validated as they type. A custom set is ranked provisionally from the damage calculator within a second and refined in the background. Phase 6b covers the mechanism.

Three further controls the mode needs:

- **Back up.** Undo the last pick and re-rank. Users will explore alternatives at slot 3 without wanting to restart.
- **Require a condition.** Filter candidates to those supplying a named condition, so a user who wants a Trick Room team can say so rather than scrolling for a setter.
- **Finish automatically.** Hand the partial team to the automatic search and let it fill the remaining slots. This is the common case for slots 5 and 6, where the user has a core and wants the search to solve the leftover problems.

**Generate.** The automatic mode. Configuration for scoring parameters and constraints, above a ranked team list showing members, the score band and worst matchups. `condition_reliance` belongs on the card itself, not in a detail view.

**Team detail.** The full matchup grid of six members against the metagame, a condition inventory listing enablers and which member supplies each, a positioning summary, and a leave-one-out contribution chart.

**Pokémon detail.** Per-variant view showing its matchup spread, what it enables, and its positioning profile from Phase 6. This is where a user goes to understand why a candidate was ranked where it was.

**Movesets.** Generated movesets alongside the usage percentages they were derived from, sorted with low-confidence sets first, editable in place. Edits write to `data/moveset-overrides.json`.

**Data status.** Active regulation, when the usage data was scraped, when the matrix was built, and which variants are stale. Switching regulation happens here.

### What to learn from the fixture build

Four questions the interface should answer before the pipeline is written, because each changes what gets built:

- How many candidates does a user actually scan at each slot? If the answer is ten, the core tier can be smaller than seventy and the matrix build shrinks accordingly.
- Are the three candidate dimensions comprehensible side by side, or does the user need to choose one to sort by? If they need separate views, the ranking function returns three orderings rather than one.
- Does the user work forward from a favourite Pokémon, or backward from a problem matchup? Backward means the search needs an entry point that starts from an opponent, which is not in the current design.
- Is enabler speed tier legible as a qualitative badge, or does the user expect it to move the numbers? The answer decides whether the speed penalty in Phase 4 stays advisory or becomes part of the score.
- How long will a user wait for a custom set's real numbers, and is a provisional ranking they can act on immediately acceptable? If the answer is that provisional figures are not trusted, the custom-set feature needs a faster path rather than a background one.

---

## Phase 2: Variant universe

### Move selection

Pikalytics reports per-move usage percentages, not four-move sets. Converting one to the other needs a rule, and the rule will sometimes be wrong, so it produces a reviewable artifact rather than a final answer.

Take the modal set from the top-sets section when it can be scraped. It is a real, coherent set and should always be included.

Otherwise take the top four moves by usage, with three corrections. Do not include two near-substitutes, such as two Fire STAB moves of the same category, unless both clear 50% usage. Always include Protect when it clears 50%, even if it ranks fifth, because per-move percentages understate Protect relative to how universally it is slotted. Flag any set whose four moves sum to under 250% cumulative usage as low confidence.

Enumerate a second set when the moveset genuinely splits. If a move ranked fourth to seventh has usage of at least 25% and is functionally different from what it would replace, emit an additional set. Cap at three sets per species and item bucket.

Use `lib/calc.ts` for the functional-difference test. If swapping the fifth move in for the fourth changes the KO count against at least 10% of the metagame by usage, the two sets are different. Otherwise collapse them.

Drop any move banned on that species by the current regulation's balance patch before applying the rules above, not after.

### Review and override

Generated movesets are corrected through the Movesets screen. Overrides are written to `data/moveset-overrides.json`, keyed by variant `human_id`, applied after generation and before the matrix build:

```json
{
  "kingambit_assault_vest": {
    "moves": ["Kowtow Cleave", "Sucker Punch", "Iron Head", "Protect"],
    "note": "Low Kick is a niche pick; Protect is more common on AV sets"
  }
}
```

Overrides are version-controlled and survive a rescrape. Any overridden variant is marked `moves_source: "override"` so its downstream results are traceable. Changing a moveset invalidates every matrix cell involving that variant, which incremental refresh handles.

### Items

Derive the item universe from `lib/format-rules.ts` rather than a hand-maintained list. Bucket items into offensive, defensive and neutral categories using the per-Pokémon threshold logic from `BACKLOG.md` #04.

Two items need special handling. Choice Scarf is a property of the variant, not a condition, since a Scarf set moves first because of what it is rather than because of a state something put it in. Air Balloon grants a Ground immunity that persists until the holder is hit by a damaging move, which the simulator models natively but which meaningfully changes matchup outcomes, so it gets its own bucket rather than collapsing into the neutral one.

### Tiering

The metagame a team is built against needs breadth. The pool a team is built from needs depth but not breadth, because a Pokémon at 0.4% usage is rarely the right answer and its matchup data is the noisiest in the set.

- **Core tier.** The top seventy or so variants by weight, subject to what Phase 1 learns about how many candidates a user scans. Full condition set, full pairwise matrix, eligible as team members.
- **Extended tier.** Everything down to the 1% species threshold, roughly 150 to 200 variants. Simulated as opponents. Eligible as team members only during local-search refinement.
- **Fringe.** Below threshold. Excluded.

Output goes to `data/variants.json`.

---

## Phase 3: Conditions

The initial set is five simulated conditions plus their combinations, and one derived condition that costs no simulation at all.

### The two gates

Every simulated cell passes two independent tests before it is worth running.

**The structural gate** asks whether either Pokémon reads the condition. It is cheap, it looks only at typings, abilities, moves and items, and it is written per condition. Sun is skipped when neither Pokémon has anything that responds to Sun.

**The outcome gate** asks whether the condition moves anything the battle depends on. It is the same for every condition, it uses `lib/calc.ts` rather than the simulator, and it catches a large class of cells the structural gate lets through.

For a pair, compute under `fresh` the speed order and the KO count each way, evaluated at both the minimum and maximum damage roll. Recompute both under the condition. If neither the speed order nor any KO count changes at either roll boundary, the condition cannot change the outcome and the cell is not simulated.

A Mega Floette that outspeeds Scrafty and knocks it out in one hit needs no rain cell, no sun cell and no sand cell, because none of them changes the fact that Floette moves first and kills. It does need a `moves_first` cell for Scrafty, because that changes the speed order and gives Scrafty a turn it did not previously have.

Use the roll boundaries rather than the average, so that a condition which turns a probable knockout into a guaranteed one still counts as relevant.

**A skipped cell is never empty.** Every pair-and-condition combination has a row, and a skipped one inherits the probability and HP distribution of the cell it was compared against. Querying the Floette-against-Scrafty matchup under rain returns the same number as under `fresh`, which is the right answer, rather than a gap the interface has to render as unavailable.

Inheritance follows the comparison, not `fresh` by default. A combination cell skipped because the weather changed nothing inherits from the move-order cell it was compared against, not from `fresh`. Store the source alongside the value so provenance is visible wherever a number is shown.

Three exceptions always simulate regardless of the outcome gate: conditions causing residual damage, since they change the turn clock even when every damage figure holds; conditions introducing new randomness, such as paralysis and sleep; and pairs where either Pokémon has an ability that reads field state, since those interactions are easy to miss in a static check.

The outcome gate needs validating before the build is trusted. Phase 9 covers it.

### `moves_first`

The Pokémon whose win probability is being measured acts before its opponent on every turn.

**Structural gate.** Skip when this is already true in the context being evaluated. Simulate when the Pokémon is slower, and when the two are speed-tied, since the condition converts a coin flip into certainty.

The gate is evaluated inside whatever context already applies, which matters for the weather combinations. A Swift Swim Pokémon under rain may already be faster, in which case the combined cell is identical to the rain cell and is skipped. The simulator applies Swift Swim natively once rain is up; nothing in the enabler catalog needs to describe that.

At most one side of an ordered pair gets this condition, and one simulation serves two readings. The cell where the slower Pokémon moves first describes both a team supplying speed control and a team exposed to it, depending on which end it is read from. This halves the work and removes any need to simulate opponent speed control separately.

**Implementation.** Apply enough Speed stages to the slower Pokémon to flip the order, persisting for the whole battle.

**Enablers.** Tailwind; Icy Wind, Electroweb, Bulldoze, Rock Tomb and Glaciate; Trick Room, for the slower side only; Thunder Wave, Nuzzle and Glare; Dragon Dance, Agility, Rock Polish, Autotomize and Shift Gear as self-only setup; Speed Boost; Prankster, for support moves specifically.

Weather-dependent speed abilities such as Swift Swim and Chlorophyll are not enablers. They are consequences of the weather condition, applied by the simulator, and cataloguing them as well would double-count.

### `sun`, `rain`, `snow`, `sand`

The named weather is up for the battle.

One structural gate covers all four. Simulate weather W when either Pokémon has an ability, typing, move or held item whose behaviour changes under W, or when either takes residual damage from W.

| Weather | Abilities | Typings | Moves and items |
|---|---|---|---|
| Sun | Chlorophyll, Solar Power, Flower Gift, Leaf Guard, Dry Skin, Forecast, Protosynthesis | — | Fire and Water damaging moves, Solar Beam, Solar Blade, Weather Ball, Growth, Synthesis, Morning Sun, Moonlight, Thunder, Hurricane, Hydro Steam |
| Rain | Swift Swim, Rain Dish, Dry Skin, Hydration, Forecast | — | Fire and Water damaging moves, Thunder, Hurricane, Weather Ball, Solar Beam, the Synthesis-class recovery moves |
| Snow | Slush Rush, Ice Body, Snow Cloak, Forecast, Ice Face | Ice, for the Defense boost | Blizzard, Aurora Veil, Weather Ball, Solar Beam, the Synthesis-class recovery moves |
| Sand | Sand Veil, Sand Rush, Sand Force, Magic Guard, Overcoat, Forecast | Rock, for the Special Defense boost | Weather Ball, Solar Beam, Shore Up, Safety Goggles |

Sand additionally triggers on residual damage, which applies to any Pokémon that is not Rock, Ground or Steel and lacks one of the abilities or items above. In practice Sand passes the structural gate on most pairs, which is correct, since it is the only weather with an effect independent of either Pokémon reading it. The outcome gate then removes many of those again.

**Enablers.** Drought, Drizzle, Sand Stream and Snow Warning as abilities. Sunny Day, Rain Dance, Sandstorm and Snowscape as moves. Desolate Land and Primordial Sea if legal in the current regulation.

### Combinations

Four weathers and one move-order bit produce up to four combination cells per pair, alongside four weather-only cells, one move-order-only cell, and `fresh`.

Simulate a combination only when the weather passes both gates and `moves_first` still passes its structural gate with the weather applied. In practice this yields a handful of cells per pair rather than ten.

Combinations are affordable because there are only two families and the cross-product is small and fully gated. A third family would need a different approach.

### Chip damage, a derived condition

Some conditions need no simulation. They can be read off a simulation that already ran.

If a cell is simulated a hundred times and the winner's remaining HP is recorded each time, the effect of starting one side lower is already in that data. A battle A won with 40% HP left is a battle A loses when it enters 40% down. Both directions fall out of the same run:

```
P(A wins | B enters at (1 − c) of full HP) = P(A wins) + P(B won with final HP ≤ c)
```

This makes chip a continuous variable rather than a set of discrete conditions. Instead of separate cells for 80% and 60%, the matrix stores the distribution of the winner's remaining HP and the scoring layer evaluates any chip amount as a lookup.

**What to store.** Per cell, two sorted quantile arrays of the winner's final HP as a fraction of maximum, one for battles A won and one for battles B won. Twenty quantiles each is ample.

**Enablers that count.** Chip means damage the opponent carries into the endgame, delivered by a teammate without a dedicated action, because the model cannot charge for a spent turn.

Two sources qualify. A teammate's spread move hits this opponent while targeting something else, so the damage is free. A teammate's contact-punish item or ability, such as Rocky Helmet, Rough Skin or Iron Barbs, damages the opponent because the opponent chose to attack, so that is free too.

Each is a single instance of damage carried into the fight, not a per-turn effect, so amounts are summed with no multiplication by battle length.

Weather residual is not a chip enabler. Sand damages both Pokémon every turn during the fight, and that is already captured by the simulated sand cell, which the outcome gate always admits on residual grounds. Treating it as chip as well would double-count it, and would also get it wrong: equal residual is not symmetric in effect, because it accelerates whichever Pokémon is nearer death. A faster Pokémon dealing 70% against a slower one dealing 96% wins with no weather and loses in sand, and only the simulated cell shows that.

Dedicated chip moves do not count either. Crediting them would let the model buy outcomes with turns it never accounts for.

**Where this is exact and where it is not.** Reading chip off a finished battle assumes entering at lower HP produces the same trajectory, truncated earlier. Two things break that.

The policy sees HP and plays differently at lower HP. Usually second-order, but real, which makes the lookup an approximation rather than an identity.

Threshold mechanics make chip non-linear, in both directions. Focus Sash and Sturdy guarantee survival from full health, so a single point of chip removes a whole turn of survival and is worth far more than its magnitude, while the lookup prices it linearly. Sitrus Berry and the HP-activated berries fail the other way, since chip that pushes the holder past the activation point triggers healing and is worth less than its magnitude. Berserk, Weakness Policy, Emergency Exit and Wimp Out are worse still, because crossing the threshold hands the chipped Pokémon a boost or an escape, so chip can help the side it lands on.

Recovery moves are a third case rather than a threshold: a starting deficit is not permanent, so nothing truncates.

**Exclusions.** The exclusion is keyed on the Pokémon receiving the chip, not on the pair. Fall back to a simulated cell whenever the chipped Pokémon has a recovery move or one of: Focus Sash, Sturdy, Sitrus Berry or any HP-activated berry, Berserk, Emergency Exit, Wimp Out, Defeatist, Ice Face, Weakness Policy.

### What generalizes and what does not

The property making chip free is that it **truncates** a battle the simulator already ran. The counterfactual is a prefix of observed data.

Anything sharing that property is equally free. A damage boost delivered without spending an action, such as a Defiant proc or a Weakness Policy activation, kills the opponent sooner and also truncates. Given each side's per-turn cumulative damage, the turn the opponent falls under a boost is a lookup rather than a simulation.

Anything that **extends** a battle is not free, because the data stops exactly where it is needed. Damage mitigation keeps a Pokémon alive past the turn it died in every recorded battle, and there is no observation of what happens next. Passive healing from Leftovers or Grassy Terrain has the same shape. Both can be estimated by recording each side's remaining HP when the other fell and extrapolating at the observed per-turn damage rate, but that is an extrapolation and should be labelled one.

Conditions that change decisions rather than quantities are never derivable. Speed control reorders actions. Weather changes damage, abilities and residuals at once. Status introduces new randomness.

### What this condition set does not capture

**Duration and mechanism are flattened.** `moves_first` is a permanent speed flip, but Tailwind lasts four turns and Trick Room five. A seven-turn endgame credited to Tailwind is overstated. Trick Room also leaves priority moves untouched and inverts again if either side's speed changes. Expect `moves_first` to run optimistic, more so for long endgames.

**Several archetypes are invisible.** No damage mitigation, no stat boosts, no status, no terrain, no priority blocking. Setup sweepers, Intimidate-stacking teams, screens teams and terrain cores cannot express their value, and the output will over-select bulky offense and weather teams.

**Speed ties produce unusually large conditional credit.** Treating a supplied tie as moving first is correct, and treating an unsupplied tie as a coin flip is also correct, but the gap between them is wider than for a genuine speed deficit.

### Extension roadmap

Damage mitigation and setup boosts are the priority, because they cover the archetypes the initial set cannot see at all.

**`phys_mitigation` and `spec_mitigation`.** The opponent's damage output is reduced by one stage's worth against the relevant category. These extend battles rather than truncating them, so they need simulated cells.

Structural gate on whether the opponent's best move against this Pokémon is of that category, determined with `lib/calc.ts` rather than by counting moves. A Pokémon with three physical moves and one special move that hits four times as hard is a special threat.

Enablers split into two kinds, and the distinction matters more here than anywhere else. Team-wide mitigation protects anyone: Intimidate, Reflect, Light Screen, Snarl, Will-O-Wisp, Friend Guard, Charm. Self-only mitigation protects its user alone: Iron Defense, Amnesia, Acid Armor, Barrier, Cosmic Power, Stockpile, Coil, Curse, and the defensive halves of Bulk Up, Calm Mind and Quiver Dance.

**`atk_up` and `spa_up`.** A damage boost of one stage's worth. These truncate, so a free boost is derivable rather than simulated, provided the matrix stores per-turn cumulative damage. Defiant, Competitive, Weakness Policy and Booster Energy all activate without spending an action and qualify. Setup moves cost a turn and need simulated cells.

Structural gate on whether the Pokémon has a move of that category; the outcome gate then handles whether the boost moves a KO threshold.

Enablers for the simulated version include Swords Dance, Nasty Plot, Work Up, Howl, and the offensive halves of Bulk Up, Calm Mind, Dragon Dance and Quiver Dance.

Bulk Up and Calm Mind therefore appear twice in the catalog, once against a damage boost and once against mitigation, both self-targeted. Because Phase 7 takes a maximum over conditions independently, a Bulk Up user gets credit for whichever helps more in a given matchup, never both at once, which undercounts the move. An atomic condition raising both stats would be more accurate and costs another simulated cell per pair. Measure the undercount before deciding whether to pay for it.

**Passive healing.** Leftovers, Grassy Terrain and Ingrain extend battles the same way mitigation does, with the same consequence.

After those, in rough order:

| Condition | Structural gate | Enablers |
|---|---|---|
| `priority_blocked` | either Pokémon has a damaging priority move or Fake Out | Psychic Terrain, Armor Tail, Dazzling, Queenly Majesty |
| the four terrains | see below | the four Surge abilities, the four terrain moves, the terrain Seeds, Terrain Extender |
| `trick_room`, split from `moves_first` | either Pokémon has Gyro Ball or Electro Ball, or the endgame runs long enough that the five-turn limit matters | Trick Room setters |
| `sleep_O`, `burn_O`, `par_O` | the target is not immune | the relevant inducing moves |

Terrain does not take one structural gate the way weather does, because each terrain does something different. Every terrain gate additionally passes on a terrain-reading ability, move or item: Surge Surfer, Quark Drive, Mimicry, Grass Pelt, Grassy Glide, Rising Voltage, Expanding Force, Misty Explosion, Psyblade, Terrain Pulse, Steel Roller, Ice Spinner, the four Seeds and Terrain Extender.

- **Grassy.** Simulate whenever either Pokémon is grounded. Per-turn healing changes the turn clock in nearly every grounded matchup even when no damage figure moves, and halving Earthquake, Bulldoze and Magnitude changes many more. Skip only when both Pokémon are Flying-type, have Levitate or hold Air Balloon. This is the terrain equivalent of sand.
- **Electric.** Simulate when either Pokémon is grounded and has an Electric move, or when either has a sleep-inducing move or Rest, since the terrain blocks sleep for grounded Pokémon.
- **Misty.** Simulate when either Pokémon is grounded and has a Dragon move, which is halved, or a status-inducing move, which is blocked.
- **Psychic.** Simulate when either Pokémon is grounded and has a priority move, which is blocked against grounded targets, or a Psychic move, which is boosted.

The gate is the difficult part of each addition, not the simulation. Write the gate first, measure how many pairs it admits, and decide affordability after that.

Output goes to `data/conditions.json`, with both gate rules recorded in readable form so their decisions can be audited when a matchup looks wrong.

---

## Phase 4: Enabler catalog

For each variant, which conditions it can bring about and for whom.

```json
{
  "variant_id": "sha256:...",
  "human_id": "kingambit_bulk_up",
  "enablers": [
    {
      "condition": "atk_up",
      "mechanism": "move:Bulk Up",
      "mechanism_class": "setup_move",
      "target": "self",
      "action_cost": 1,
      "speed_tier": "computed"
    },
    {
      "condition": "phys_mitigation",
      "mechanism": "move:Bulk Up",
      "mechanism_class": "setup_move",
      "target": "self",
      "action_cost": 1,
      "speed_tier": "computed"
    }
  ]
}
```

One record per mechanism-and-condition pair. A move doing two things produces two records.

`target` takes one of `self`, `ally_side`, `opponent_side` or `field`, and determines whether the enabler can help a teammate. Dragon Dance is `self`. Tailwind is `ally_side`. This scoping stops the model crediting one Pokémon's Swords Dance to another, and it separates setup-based mitigation from screens-based mitigation.

`mechanism_class` takes one of `switch_in_ability`, `passive`, `support_move`, `setup_move` or `status_move`.

Enablers cover only what a Pokémon actively does. Effects the simulator applies on its own, such as Swift Swim gaining speed once rain is up, are not enablers.

### Speed tier

Not all enablers arrive at the same time, and the difference is large enough that a user should see it even where the model cannot price it.

**Tier 0, free.** No action required. The condition is up before anything else happens. Drought, Drizzle, Grassy Surge, Intimidate, Booster Energy.

**Tier 1, fast.** Costs an action, but resolves before the opponent can respond, either through priority or through outspeeding the specific opponent. Prankster Rain Dance, Fake Out, a Tailwind user faster than what it faces.

**Tier 2, slow.** Costs an action and resolves after the opponent acts. The team absorbs a turn of pressure under the unfavourable state before the condition applies, and the enabler may not survive to finish the job. A non-priority Rain Dance on a Pokémon slower than its opponent.

Tier 0 is a property of the enabler. The split between tiers 1 and 2 is not. A non-priority Tailwind user is fast against half the metagame and slow against the other half, so the tier is computed per opponent as a speed comparison, which costs nothing.

```typescript
function speedTier(enabler: Enabler, opponent: Variant): 0 | 1 | 2;
```

**How this is used.** By default the tier is reported and not priced. It appears next to each condition in `setup_profile`, on every candidate in the Build screen, and in the team detail view. A team whose rain comes from Drizzle and a team whose rain comes from a slow Rain Dance receive the same score and look very different on the card.

Pricing it is available as an option. A tier-2 enabler implies roughly one turn of opponent damage absorbed before the condition lands, which the chip machinery can represent as self-chip against the team's own Pokémon. That charge is off by default, configurable, and approximate, because the turn is spent by the enabler while the chip lookup applies to whichever Pokémon is being scored, and the 1v1 frame cannot represent the difference. Phase 1 should settle whether users read the tier as a badge or expect it to move the numbers.

### Magnitude enablers

Enablers of derived conditions carry an amount rather than a yes-or-no fact, and the amount depends on which opponent is faced:

```json
{
  "condition": "chip",
  "mechanism": "move:Rock Slide",
  "mechanism_class": "free_spread_damage",
  "target": "opponent_side",
  "action_cost": 0,
  "magnitude": "calc"
}
```

`action_cost` is 0 because the second target is hit while the move is already being used against the first. That is the whole test for whether a chip source counts.

`magnitude: "calc"` means the amount is computed at scoring time by running `lib/calc.ts` for this mechanism against the opponent in question. Every chip enabler delivers a single instance of damage carried into the fight, so a team's total chip against an opponent is the plain sum across its magnitude enablers, with no adjustment for battle length.

Summing is the right default, since these stack in play. It is still optimistic, because it assumes every source actually connects.

### Conditional probabilities, not discounted ones

The model does not estimate how often a condition actually materializes. Every probability is a conditional statement: given this Pokémon moves first, it wins 95% of the time. The enabler catalog answers a binary question about whether a team can bring a condition about at all.

The alternative would be a reliability prior, something like assuming Tailwind goes up 65% of the time. Those numbers cannot be measured from the available data, they would propagate into every score, and they would make the output look more precise than it is.

`speed_tier` and `mechanism_class` exist so the reader can discount by eye. The consequence is that the team score is a ceiling rather than an expectation, which is why Phase 7 reports it alongside a floor.

### Building the catalog

Most of this is a movepool and ability scan against a hand-curated effect table. Reuse the board-control taxonomy from `BACKLOG.md` #08. Build that table once, in `lib/effects.ts`, and import it from both projects.

---

## Phase 5: Matrix build

This extends Phase 4 of `SPEC-sim.md`.

For each ordered pair drawn from core-against-core and core-against-extended, apply the structural gate and then the outcome gate. Simulate only the cells passing both.

Record on every row how it was produced. Every pair-and-condition combination gets a row, with a `status` of `simulated`, `inherited` or `excluded_fallback`, and an `inherited_from` naming the source condition where the status is `inherited`. A row is never absent and never null. Any query for a matchup under any condition returns a number, and the interface can show where that number came from.

`excluded_fallback` marks cells simulated because a derived reading was unavailable, such as a chip lookup blocked by a threshold item. Distinguishing it from an ordinary simulated cell makes the cost of the exclusion list visible.

Rows carry `regulation_id`, `policy_version`, `calc_version` and `sim_engine_version`, with a primary key of `(variant_A_id, variant_B_id, condition, policy_version)`. A regulation rollover invalidates rows involving variants whose legality or moveset changed, which incremental refresh handles; it does not invalidate the whole table.

Store `p_A_wins` and `mean_turns`. In place of a mean final HP, store the distribution: two sorted quantile arrays of the winner's remaining HP as a fraction of maximum, one across the battles A won and one across the battles B won. These arrays are what make chip a lookup and what drive the positioning analysis in Phase 6, and a mean discards exactly the information both need.

Also record each side's remaining HP at the moment the other fainted, which a later extrapolation for mitigation and passive healing would need, and which costs nothing to collect now.

Recording per-turn cumulative damage would additionally make free damage boosts derivable. Full curves for every cell are bulky, so store them for the core-against-core block only and treat the boost extension as gated on whether that proves affordable.

---

## Phase 6: Positioning

Matchups measure who wins a fight. Enablers measure how many fights your team can arrange to be favourable. Positioning measures whether a Pokémon can reach those fights at all.

This phase adds no simulations. It runs on the HP distributions from Phase 5 and the damage calculator.

### Self-positioning

A Pokémon that beats half the metagame from full health but cannot enter the field without losing half its own has a worse matchup spread than the matrix says. The question is how much damage it can absorb on the way in and still win the fights it is supposed to win.

The chip machinery answers this directly, read from the defending side rather than the attacking one:

```
p(P beats V | P entered at 1 − x) = P(P won against V with final HP > x)
```

The entry cost is a damage calculation, not a simulation:

```
switch_in_cost(P, W) = max over W's damaging moves of  damage(W → P) / P.maxHP
```

Use the maximum-damage move rather than the most-used one, since a switch-in has to survive the worst case to be a reliable play. Apply P's own switch-in abilities, since Intimidate reduces the physical hit it is about to take.

Combining them gives, for each Pokémon P and each opponent W it might come in on, the matchup spread P retains after paying the entry cost:

```
entry_spread(P, W) = Σ over V of  w(V) · g( p(P beats V | P entered at 1 − switch_in_cost(P, W)) )
switch_in_score(P) = Σ over W of  w(W) · entry_spread(P, W)
```

Two headline numbers belong on the Pokémon detail screen, because the weighted score alone is hard to interpret:

- **Entry coverage.** The share of the metagame by usage that P can switch in on while retaining at least 80% of its full-health matchup spread.
- **Conversion.** Across that share, the number of opponents P is favoured against after paying the entry cost.

These separate two different failures. A Pokémon can come in safely on most of the field and then beat none of it, or it can beat most of the field but only from full health.

The same exclusions apply as for chip. A Pokémon with recovery or a threshold item is evaluated by simulation rather than lookup.

**What this measure assumes.** It assumes the opponent attacks with their best move into the switch, which is the worst case. It does not model prediction, Protect, the opponent switching out, or the switch-in being a double-target read. It is a floor on how safely a Pokémon enters, and reading it as an expectation will understate every Pokémon roughly equally, which is acceptable for ranking and misleading in absolute terms.

### Teammate positioning

The second half is whether a Pokémon helps its teammates get in. This is team-dependent and cannot be evaluated in a vacuum.

Structurally it is the same quantity. A positioning tool reduces `switch_in_cost` for a teammate against the opponents that threaten it:

| Tool | Effect on a teammate's entry cost |
|---|---|
| U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport, Baton Pass | Reduced to zero. The teammate enters without being hit. |
| Fake Out, from a Pokémon faster than the threat | Reduced to zero for that turn. |
| Follow Me, Rage Powder | Reduced to zero. The attack is redirected. |
| Ally Switch | Reduced to zero, conditionally. |
| Intimidate | Physical component multiplied by two thirds. |
| Reflect, Light Screen | Relevant component multiplied by two thirds. Doubles screens reduce by a third, not a half. |
| Friend Guard | Multiplied by three quarters. |
| Weather, against a weather-affected move type | Multiplied by the weather factor. |

So `switch_in_cost(Q, W | T)` is the base cost reduced by whatever tools team T supplies, and `entry_spread(Q, W | T)` follows. A candidate's positioning contribution is the improvement it produces across the existing members:

```
positioning_delta(candidate, T) =
    Σ over Q in T  Σ over W of  w(W) · [ entry_spread(Q, W | T + candidate) − entry_spread(Q, W | T) ]
```

This is what makes a pivot user or a redirector legible as a candidate. Such a Pokémon may beat nothing on its own and enable no conditions, while substantially raising how often the rest of the team reaches its good matchups. Neither `marginal_score` nor `conditions_added` would show it.

The same caveats apply, and one more. A pivot move costs the pivoting Pokémon's action and requires it to survive the turn, which the model does not charge for, in the same way it does not charge for a tier-2 enabler's turn. Report the tool's speed tier alongside its contribution.

**Output.** `data/positioning.json`, one record per variant:

```json
{
  "variant_id": "sha256:...",
  "switch_in_score": 0.412,
  "entry_coverage": 0.63,
  "conversion": 14,
  "costly_entries": [
    {"opponent": "sha256:...", "species": "...", "cost": 0.71, "spread_retained": 0.34}
  ],
  "tools_provided": [
    {"tool": "move:U-turn", "effect": "entry_cost_to_zero", "speed_tier": "computed"}
  ]
}
```

`costly_entries` lists the opponents a Pokémon cannot safely come in on, which is the diagnostic a user actually wants when deciding what else the team needs.

---

## Phase 6b: Custom sets

The preset universe comes from usage data, which describes what people are already playing. A teambuilder that can only choose from it cannot help a user who wants to try something.

When a user selects a Pokémon in the Build screen, they choose among its preset sets or define a new one: ability, item, nature, SP spread and four moves, validated against `lib/format-rules.ts` and the 66-point budget as they type. A custom set becomes a variant like any other, with a content-addressed ID derived from the hash of its full specification, so the same set defined twice is the same variant and is computed once.

### Ranking it before it is simulated

A new variant has no matrix rows, and simulating it against the metagame takes minutes rather than milliseconds. Blocking the interface on that would make the feature unusable.

Produce a provisional ranking immediately from `lib/calc.ts` alone. For each opponent, compute the speed order and the KO count each way at both roll boundaries. That gives a crude win estimate with no simulation: a Pokémon that outspeeds and knocks out in fewer hits than it takes to fall wins nearly always, and the ambiguous cases are the ones where the estimate is weakest. It costs a few hundred damage calculations and returns in under a second.

The provisional figures are marked as such wherever they appear, and the user can keep building while the real numbers arrive.

### Filling in the matrix

Simulate in order of what the interface needs soonest.

1. `fresh` against the core tier, which is what the candidate ranking mostly reads.
2. `fresh` against the extended tier, completing the matchup spread.
3. Gated conditions against the core tier.
4. Gated conditions against the extended tier.

Both gates apply as normal, and the reduction they produce matters more here than anywhere else, since this work happens while a user waits. Use the adaptive stopping rule from `SPEC-sim.md` Phase 3 aggressively, starting at twenty battles per cell and only continuing where the interval stays wide.

**Warm-start from the nearest preset.** Most custom sets are small edits of an existing one: a swapped move, a redistributed spread, a different item. Find the preset with the smallest specification difference and reuse its cells wherever the outcome gate says the edit changes nothing. Swapping a move that is never the best option against a given opponent cannot change that matchup, and the calc says so for a fraction of the cost of a simulation. On a single-move edit this typically leaves a minority of cells needing real work.

### Where this runs

The work is too heavy for the browser and too slow to block on, which makes this a deployment decision rather than a detail. `BACKLOG.md` #05 frames the same tradeoff: a static site with client-side simulation avoids a backend but ships a large dependency and runs slowly, while a small job queue behind an API is faster and costs a server.

The recommendation is the job queue, for a reason specific to this design. Content-addressed IDs mean every custom set computed by anyone is cached for everyone, so a shared backend accumulates coverage of the sets people actually care about, and the second user to try a given spread waits for nothing. Client-side simulation throws that away on every page load.

**Output.** Custom variants are written to `data/custom-variants.json` with `source: "custom"` and the same schema as preset variants. Their matrix rows carry a `provisional` flag until the corresponding simulations complete.

---

## Phase 7: Team scoring

Let `T` be a team, `M` the metagame as extended-tier variants with weights `w(V)` normalized to 1, and `p(v, V, c)` the probability that variant `v` beats variant `V` under condition `c`.

### Step 1: the team's condition set

`C(T, v)` is the set of conditions available to member `v` on team `T`. Membership is binary, decided by three rules.

**Supply.** Some member of `T` enables the condition. A combination cell requires enablers for both components, except where one component is a weather whose effects alone satisfy the other, which the gate has already resolved by not producing the cell.

**Target scoping.** A self-targeted enabler contributes only for the Pokémon that owns it.

**Simultaneity.** Only one weather can be active in a single matchup. A team carrying both Torkoal and Pelipper may still use Sun against one opponent and Rain against another, because each matchup is maximized independently. That reflects real bring choices rather than a modelling error.

`fresh` is always a member of `C(T, v)`.

### Step 2: the answer to each opponent

Derived conditions resolve first, because they modify a cell rather than selecting one. For each member and opponent, sum the team's free chip and read the adjusted probability off the stored distribution:

```
chip(T, V)         = Σ over magnitude enablers e in T of  amount(e, V)
p_chipped(v, V, c) = p(v, V, c) + P(V won under c with final HP ≤ chip(T, V))
```

applied to every simulated condition, and skipped for pairs on the Phase 3 exclusion list.

Then take the maximum:

```
p_best(T, V) = max over v in T, over c in C(T, v) of  p_chipped(v, V, c)
```

No blending and no discount. If a Pokémon wins 5% of the time normally and 95% when moving first, and the team enables `moves_first`, the team's answer is 0.95.

Record which member and condition won the maximum, and the chip applied, so the interface can report that the answer to a given opponent is one specific Pokémon, only when it moves first, via a teammate's Trick Room.

### Step 3: redundancy

A hard maximum treats a second answer as worthless. That is wrong, because only four of six Pokémon are brought and, with open team lists, the opponent chooses their four after seeing all six of yours. Blend in the second-best answer from a distinct member, weighted so it helps only to the extent the first can fail:

```
p_eff(T, V) = p1 + λ · p2 · (1 - p1)
```

Set λ to 0.25 by default and make it configurable. At λ = 0 this reduces to the hard maximum. Report rankings at λ values of 0, 0.25 and 0.5 to check whether the ordering depends on the choice.

### Step 4: shaping

Improving a 30% matchup to 65% is more valuable than improving a 60% matchup to 65%. Apply a shaping function before aggregating:

```
g(p) = 1 / (1 + exp(-k(p - 0.5)))     with k around 6
```

This is also where to discount Pokémon that win but end the battle spent, using the median of the stored winner's-HP distribution.

### Step 5: opponent-supplied conditions

The metagame supplies conditions too, and the matrix holds the data needed to account for it.

For each condition, compute `q(c)`, the share of the metagame that enables it, by summing `w(V)` across extended-tier variants with that enabler, capped at 1. Then blend across the conditions an opponent might bring:

```
p_exposed(T, V) = (1 - Σ q(c)) · p_eff(T, V | fresh)  +  Σ_c q(c) · p_eff(T, V | c)
```

with coefficients renormalized to sum to 1.

The conditions that matter are `moves_first` and the four weathers. `moves_first` needs no additional simulation, since the cell where the slower Pokémon moves first is the same cell regardless of which side supplied it.

Two correctness notes. A global `q(c)` overstates exposure for opponents that never appear on teams setting the relevant condition; fixing that properly requires the team-archetype metagame model. And when the team supplies the same condition, Step 2 already granted it, so take the more favourable of the two readings rather than counting both.

### Step 6: the score

```
score(T) = Σ over V in M of  w(V) · g( p_exposed(T, V) )
```

Because Step 2 applies no discount, this is a ceiling. Report it as a band:

- `score_ceiling`, with all supplied conditions available
- `score_floor`, the same computation with `C(T, v)` reduced to `{fresh}` and `chip(T, V)` set to zero
- `condition_reliance`, equal to `(ceiling − floor) / ceiling`

All three belong on the team card. A team at 0.64 ceiling and 0.58 floor is a safer bet than one at 0.66 and 0.31, and the ceiling alone cannot tell them apart. Since the model carries no reliability priors, this band and the enabler speed tiers are the only signals the reader gets about how much setup a team is asking for.

Positioning is reported alongside the score rather than folded into it. A team's positioning summary is the set of its members' `entry_coverage` figures after teammate tools are applied, plus the opponents no member can safely come in on. Folding it into a single number would hide which of three different problems a low-scoring team has.

Also report `worst_10`, the highest-weight matchups scoring below 0.4; `coverage_breadth`, the count of metagame variants with at least one answer above 0.5; and `setup_profile`, a tally of `mechanism_class` and speed tier across the conditions the team depends on.

---

## Phase 8: Search

Both modes call the same ranking function.

```typescript
type Candidate = {
  variant_id: string;
  marginal_score: number;              // score(T + candidate) - score(T)
  matchups_fixed: MatchupDelta[];      // opponents whose answer improves, sorted by w(V) x improvement
  conditions_added: Array<{ id: ConditionId; speed_tier: 0 | 1 | 2 }>;
  positioning_delta: number;           // improvement to existing members' entry spreads
  positioning_detail: EntryImprovement[];
  score_ceiling: number;
  score_floor: number;
  provisional: boolean;                // true when any figure rests on calc estimates
};

export function rankCandidates(
  partial: VariantId[],
  constraints: SearchConstraints
): Candidate[];
```

A candidate can earn its slot three ways, and the ranking function returns all three so neither the interface nor the beam has to guess which one applies.

Scoring one candidate means, for each of roughly 200 metagame variants, taking a maximum over team members and available conditions, plus a positioning pass over existing members. With seven members and a handful of conditions that is a few thousand table lookups and a few hundred damage calculations. Fast enough to run interactively from a preloaded matrix.

### Hard constraints

Species clause keyed on National Pokédex number, item clause, Mega limit and species legality, all from `lib/format-rules.ts`. Apply them inside `rankCandidates` so illegal candidates never surface, rather than filtering afterwards.

### Guided mode

Call `rankCandidates([])` for the first slot, where every candidate's marginal score is its standalone performance and its positioning figure is its own entry coverage. The user picks one. Call `rankCandidates([first])` and present the new ranking. Repeat to six.

The Build screen from Phase 1 is the whole of this mode. The ranking function returns everything it displays.

### Automatic mode

Beam search from multiple seeds, followed by local refinement.

```
1. Seed. For each of the top 25 variants by standalone score,
   start a partial team of size 1.

2. Expand. Beam search, width 50, depth 6.
   At each depth, for each partial team:
     - Candidates from rankCandidates(partial), filtered to those that either
         (a) improve one of the team's worst 20 matchups by more than 0.05, or
         (b) enable a condition the team cannot currently supply, which at least one current
             member converts on, meaning p(v, V, c) - p(v, V, fresh) > 0.3 for some V
             with w(V) > 0.01, or
         (c) have a positioning_delta above a threshold, meaning they materially improve
             how often existing members reach their good matchups
     - Score each extension and keep the global top 50.

3. Refine. For the top 200 complete teams, hill-climb:
     - try every single swap against the core and extended pools
     - try double swaps among the three lowest contributors only
     - accept improvements until reaching a local optimum.

4. Deduplicate. Cluster by Jaccard similarity on species rather than variants.
   Teams sharing five or more species are the same team; keep the highest scorer.
   Report the top 20 distinct compositions.
```

Greedy selection cannot find pairs that only work together, such as a Trick Room setter and a slow wallbreaker, each of which scores poorly alone. Rules (b) and (c) admit candidates on what they unlock rather than what they beat, and the beam lets a weak partial team at depth 2 survive to depth 3 where the pairing pays off.

Guided mode has the same blind spot in a different form. A user working slot by slot sees marginal scores, and a Trick Room setter or a pivot user will look poor on that column alone. The `conditions_added` and `positioning_delta` columns are the mitigation, and the Build screen should explain any candidate whose value sits mostly outside its marginal score.

When the partial team comes from the user, the beam starts from that team rather than from the top 25 seeds.

### When the condition set grows

Once the roadmap adds conditions beyond the initial five, split the automatic search into two stages. Sweep using the small condition set, emit roughly 2,000 surviving teams, then rescore those survivors against the full set. The survivor list should be generous, since the sweep's job is to avoid discarding good teams rather than to rank them correctly. Validation 9h measures whether it succeeds. Guided mode never needs this.

### Output

`data/generated-teams.json`:

```json
{
  "generated_at": "...",
  "regulation": "M-C",
  "config": {"lambda": 0.25, "shaping": "sigmoid_k6", "beam_width": 50, "conditions": "v0",
             "price_slow_enablers": false},
  "teams": [
    {
      "rank": 1,
      "score_ceiling": 0.641,
      "score_floor": 0.583,
      "condition_reliance": 0.091,
      "members": ["sha256:...", "..."],
      "conditions_supplied": [
        {"condition": "rain",
         "enablers": [{"member": "sha256:...", "mechanism": "ability:Drizzle", "speed_tier": 0}]}
      ],
      "setup_profile": {"switch_in_ability": 2, "support_move": 1, "setup_move": 0,
                        "tier_0": 2, "tier_1": 1, "tier_2": 0},
      "positioning": {
        "member_entry_coverage": [{"member": "sha256:...", "coverage": 0.71}],
        "unreachable_opponents": [{"species": "...", "weight": 0.043}]
      },
      "worst_matchups": [
        {"variant_id": "...", "species": "...", "weight": 0.061, "p_exposed": 0.28,
         "best_answer": {"member": "sha256:...", "condition": "fresh", "p": 0.31}}
      ],
      "member_contributions": [{"variant_id": "...", "marginal_score": 0.048}]
    }
  ]
}
```

`member_contributions` holds the leave-one-out score delta. It is what tells the reader whether the sixth slot is doing anything.

---

## Phase 9: Validation

Without this the project is an expensive random team generator.

**9a. Structural gate validation.** Simulate 200 structurally rejected cells and confirm they match `fresh`.

**9b. Outcome gate validation.** Simulate 200 cells the outcome gate rejected and confirm the win probability matches `fresh` within Monte Carlo noise. If more than about 2% differ materially, the gate has a hole. This is the more important of the two, since the outcome gate removes far more cells and its failure mode is silent.

**9c. Derived chip validation.** Take 100 cells, simulate them again with the chip applied as a real starting state, and compare against the lookup. Report the distribution of errors, not just a mean. Pay attention to pairs near the exclusion boundary, since those are where the truncation assumption strains without quite breaking.

**9d. Usage correlation.** Rank species by appearance across the top 1,000 generated teams and compute a Spearman correlation against Pikalytics usage. A moderate positive correlation is expected, not a near-perfect one, since the model has no bandwagon effect and no notion of how hard a Pokémon is to pilot. A negative correlation means something is broken. Investigate large outliers by hand.

**9e. Known-good teams.** Hand-enter 10 to 15 tournament-winning teams and score them against a distribution of 10,000 randomly sampled legal teams. If real winning teams do not land in the top few percent, the scoring function is wrong. This is the strongest single validation and gates everything downstream.

Two caveats. Real winning teams rely on screens, Intimidate stacking and setup, none of which the initial condition set can see, so some will score poorly for known reasons. Record each failure's cause and confirm it traces to a missing condition rather than a scoring bug; if most point at the same condition, move it to the front of the roadmap. And M-C is new, so until enough events have run, draw the sample from M-B teams and score under M-B legality.

**9f. Backtest.** Run the pipeline against an earlier regulation. Do the generated teams resemble what actually won events then?

**9g. Ablations.** Three separate runs, each disabling one axis: conditions only, positioning only, and matchups only. If disabling an axis leaves the top 20 materially unchanged, that axis is not earning its complexity. Run the positioning ablation first, since it is the newest and least tested of the three.

**9h. Sensitivity and sweep recall.** Sweep λ across 0, 0.25 and 0.5; k across 3, 6 and 10; the `q(c)` values by ±0.1; and the entry-coverage threshold by ±0.1. If the top 20 reshuffles substantially under small parameter changes, say so in the interface. Once a two-stage search exists, also sample 300 teams the sweep rejected, score them at full resolution, and count how many would have made the top 20; the target is zero.

**9i. Provisional estimator accuracy.** Take 500 cells with real simulated results, compute the calc-only provisional estimate for each, and report the error distribution split by how lopsided the matchup is. The estimate should be near-exact where one side outspeeds and knocks out in fewer hits, and the interface should say how wide the error gets in the ambiguous band rather than presenting one confidence for all of them.

**9j. Floor and ceiling separation.** Confirm that ranking by ceiling and by floor produce materially different top-20 lists. If not, the conditional machinery is not changing outcomes.

---

## Known limitations

Document all of these in the README. The first four should also appear in the interface.

1. **The 1v1 endgame is a proxy for doubles.** No double-targeting, no focus fire, no protecting a partner, no positional play within a turn. Positioning recovers part of what this loses, but only the entry half of it.
2. **Conditional credit assumes the condition arrives.** No reliability discount, by design. `score_ceiling` is what a team achieves with its conditions active. The floor-to-ceiling band, `setup_profile` and the enabler speed tiers exist so the reader can apply that judgment.
3. **Enabler speed tier is reported, not priced.** A team whose rain comes from Drizzle and one whose rain comes from a slow Rain Dance score identically by default. The optional self-chip charge is an approximation, since the turn is spent by the enabler while the charge lands on whoever is being scored.
4. **The initial condition set covers speed, weather and chip.** No mitigation, boosts, status, terrain or priority blocking. Expect the output to over-select bulky offense and weather teams.
5. **`moves_first` flattens duration and mechanism.** A permanent speed flip overstates Tailwind at four turns and Trick Room at five, more so in long endgames.
6. **Derived chip assumes a truncated trajectory.** The policy plays differently at lower HP, so the lookup is an approximation. Pairs with recovery or HP-threshold mechanics are excluded and simulated, but the approximation still applies everywhere else.
7. **Chip enablers are assumed to connect.** Spread moves and contact-punish damage are summed as though every source lands, which is optimistic.
8. **Positioning assumes the worst case on entry.** It uses the opponent's maximum-damage move and models no prediction, no Protect, and no opponent switch. It understates every Pokémon roughly equally, which is fine for ranking and misleading in absolute terms.
9. **Teammate positioning does not charge for the tool's turn.** A pivot move costs an action and requires the user to survive, neither of which the model prices.
10. **Cross-Pokémon entry is not modelled.** Positioning asks whether a Pokémon can come in on the opponent it then fights. Coming in on one opponent to fight a different one requires knowing the opponent's team, which the metagame model does not represent.
11. **Joint setup moves are split across conditions.** Once mitigation and boosts arrive, Bulk Up and Calm Mind are credited for one effect or the other, never both at once.
12. **There is no bring-4 model.** The λ term is a rough stand-in for choosing four of six against an opponent who has seen all six. A proper model is the highest-value upgrade available, and open team lists make it more tractable than in a closed-list format.
13. **The metagame is modelled as independent Pokémon rather than teams.** Pikalytics publishes pairing data, and a distribution over team archetypes would be more accurate and would also fix limitations 10 and 14.
14. **Opponent exposure uses a global `q(c)`**, overstating exposure for opponents that never appear alongside the relevant setter.
15. **No SP optimization.** Modal spreads only, and the 66-point budget with a 32-per-stat cap makes those tradeoffs tighter than the old EV system did.
16. **No support moves during simulation**, inherited from `SPEC-sim.md`. This is why conditions are injected as starting states rather than played out.
17. **Self-targeted enablers will be double-counted when the sim gains support moves.** Dragon Dance is an enabler here because the simulator cannot play it. Once setup moves become playable, self-targeted enablers must be removed from the catalog. Leave a comment where the credit is applied.
18. **Guided mode inherits the greedy blind spot.** A user picking slot by slot sees marginal scores, which undervalue Pokémon paying off only in combination.
19. **Provisional figures for custom sets are calc estimates, not simulations.** They read speed order and KO counts, so they are reliable where a matchup is lopsided and weakest exactly where it is close, which is where a user is most likely to be looking.
20. **No difficulty-of-play term.** The model does not know that some teams demand reads and others do not.

---

## Implementation order

1. **Phase 0.** Format rules, regulation configuration and the data contracts. This also unblocks the sim project.
2. **Phase 1.** Interface against fixture data. Iterate until the interaction feels right, then let what it needs settle the Phase 0 contracts. Everything downstream is expensive to rebuild, so the exploratory work belongs here.
3. **Phase 2.** Variant universe, wired into the Movesets screen.
4. **Phase 3.** The five conditions, both gates, and the chip derivation. Write the gates first and measure how many pairs each admits. A Sun structural gate admitting 90% of pairs is wrong.
5. **Phase 4.** Enabler catalog. Shares `lib/effects.ts` with `BACKLOG.md` #08.
6. **Phase 5.** Matrix build, including validations 9a and 9b. Build the core tier first and confirm the data is sane before committing to the extended tier.
7. **Phase 6.** Positioning. It needs the matrix but nothing else, and it is pure derivation, so it can be built and checked independently of the scoring work.
8. **Phase 6b.** Custom sets. Deliberately after the preset pipeline works end to end, since the warm-start logic needs presets to start from and the provisional estimator needs real simulated cells to be checked against.
9. **Phase 7.** Scoring. Pure logic, unit-testable against hand-built fixtures.
10. **Phase 8.** `rankCandidates`, then guided mode against real data, then automatic mode. The Build screen already exists from Phase 1, so this is wiring rather than new interface work.
11. **Phase 9.** Remaining validations. If 9e fails for reasons other than missing conditions, stop and fix the scoring function before adding conditions.
12. **Extension.** Mitigation first, then setup boosts. One at a time, gate first, re-running 9d and 9e after each. A condition that does not change the rankings is a condition to cut. Try the free-boost derivation before building the simulated version, since a derived condition costs no simulation.

Steps 1 through 11 produce a complete, useful system.

---

## Test cases

**Format rules**

- Switching `regulation_id` from M-C to M-B removes the 36 M-C-only Pokémon and the 18 M-C-only items without any code change.
- A team containing Heat Rotom and Wash Rotom is rejected, since both share a National Pokédex number.
- A team with two Pokémon holding Leftovers is rejected.
- A variant whose SP exceeds 66 total or 32 in one stat is rejected on load.
- No variant carries an `ivs` field or a `level` other than 50.

**Gates**

- A Pokémon that outspeeds its opponent and knocks it out in one hit at every damage roll produces exactly two cells: `fresh`, and `moves_first` for the opponent. Every weather cell is removed by the outcome gate.
- A condition turning a probable knockout into a guaranteed one is admitted, since the KO count changes at the maximum roll.
- Sand is admitted by the outcome gate even when no KO count or speed order changes, because it causes residual damage.
- `moves_first` is skipped where the measured Pokémon is already faster, and admitted for every speed tie.
- A Swift Swim Pokémon slower under `fresh` but faster under rain gets the rain cell and not the combination.
- Once terrain arrives, Grassy is admitted for any pair with a grounded Pokémon and skipped only when both are Flying, have Levitate or hold Air Balloon.

**Cell inheritance**

- Every pair-and-condition combination returns a row. No query returns null or unavailable.
- The Floette-against-Scrafty matchup under rain returns the same probability as under `fresh`, with `inherited_from` set to `fresh`.
- A combination cell skipped because the weather changed nothing inherits from the move-order cell, not from `fresh`.
- A cell simulated because a chip exclusion blocked the derived reading is marked `excluded_fallback`, distinguishable from an ordinary simulated cell.

**Derived chip**

- A cell where A wins 60% of battles, and where B's winning battles end at or below 0.2 remaining HP in a quarter of cases, returns 0.70 at a chip of 0.2.
- Chip of 0 returns the unadjusted cell exactly. Chip above the highest stored quantile returns 1.0.
- A pair where either Pokémon holds Focus Sash, has Sturdy, or carries a recovery move is excluded and uses a simulated cell.
- Sand does not appear as a chip enabler at all. A team with Sand Stream gets the simulated sand cell and no chip credit.
- A faster Pokémon dealing 70% per hit against a slower one dealing 96% wins the `fresh` cell and loses the `sand` cell.
- A dedicated chip move does not appear as a chip enabler; a spread move's second target does.
- Chip against a Focus Sash or Sitrus Berry holder falls back to a simulated cell, keyed on the chipped Pokémon rather than the pair.

**Enablers**

- Swift Swim does not appear in the enabler catalog.
- Bulk Up produces two enabler records, one against a damage boost and one against physical mitigation, both self-targeted.
- Reflect produces a mitigation enabler applying to every team member; Iron Defense produces one applying only to itself.
- Drizzle reports speed tier 0 against every opponent. A Prankster Rain Dance reports tier 1 against every opponent. A non-priority Rain Dance reports tier 1 against slower opponents and tier 2 against faster ones.
- Choice Scarf appears in the variant universe and never in the enabler catalog.

**Positioning**

- A Pokémon with no damaging matchups has an `entry_coverage` that may be high and a `conversion` of zero.
- A Pokémon that wins most matchups from full health but takes more than its winning margin on entry against most of the field has high standalone matchup scores and low `switch_in_score`.
- Adding a U-turn user to a team raises `positioning_delta` for members whose `costly_entries` list overlaps the opponents the U-turn user can safely face.
- Adding an Intimidate Pokémon reduces teammates' entry costs against physical threats and leaves special threats unchanged.
- A Pokémon with Intimidate has a lower entry cost against physical attackers than an otherwise identical Pokémon without it.

**Custom sets**

- Two users defining the same set independently produce the same variant ID, and the second waits for no simulation.
- A custom set illegal under the active regulation, or exceeding 66 SP or 32 in one stat, is rejected in the editor before any job is queued.
- A custom set differing from a preset by one unused move reuses that preset's cells wherever the outcome gate finds no change.
- A custom set returns a provisional ranking in under a second and is marked provisional everywhere it appears until its simulations land.
- Custom variants appear as team members but never enter the metagame weights, since they have no usage.

**Scoring**

- Six identical variants score the same as one, plus the λ term. At λ = 0 the two are identical.
- Adding a Pokémon with no wins, no enablers and no positioning tools changes the score by exactly 0.
- A Pokémon at 0.05 under `fresh` and 0.95 under `moves_first`, on a team enabling `moves_first`, produces 0.95 rather than a discounted value.
- Two Tailwind users score the same as one, since supply is binary.
- A team enabling only tier-2 conditions scores identically to one enabling the same conditions at tier 0, unless the optional pricing is switched on.
- `score_floor` ignores every supplied condition and all chip, so a team with no enablers has `condition_reliance` of exactly 0.

**Search**

- `rankCandidates` on an empty team orders candidates by standalone performance, and each candidate's positioning figure equals its own entry coverage.
- Picking the top candidate at every step in guided mode produces the same team as a greedy automatic run with beam width 1.
- A Trick Room setter's `conditions_added` is non-empty for a team containing a slow attacker that converts on `moves_first`, even when its marginal score is low.
- A redirection user with no winning matchups and no conditions still surfaces in the candidate list through rule (c).
- Handing a user-selected partial team of four to automatic mode returns teams containing those four.

**End to end**

- The top 20 contains recognizable cores a VGC player would not find strange, allowing for the known bias toward weather and bulky offense.
- The top 20 by ceiling is not composed entirely of high-`condition_reliance` teams. If it is, the ceiling is being read as an expectation and the interface needs to lead with the band.

---

## Open questions

1. **Universe size.** Cap at three sets per species and item bucket, or let the functional-difference test run unbounded?
2. **Pricing slow enablers.** Leave speed tier advisory, or charge tier-2 enablers a turn of self-chip? The charge is available and approximate; Phase 1 should settle whether users expect it to move the numbers.
3. **Positioning in the score.** Reported alongside, as specified, or folded into a single ranking number? Folding it in hides which of three problems a team has, but leaving it out means the automatic search optimizes something narrower than what the interface displays.
4. **Custom set scope.** Should a custom variant be simulated against the extended tier at all, or is the core tier enough to rank it? The extended tier roughly triples the wait for a marginal gain in accuracy.
5. **Entry move choice.** Positioning uses the opponent's maximum-damage move. Is a usage-weighted expected value closer to how players actually switch, and does the ranking change if so?
6. **Composition floors.** Hard constraints on speed control and priority, a soft bonus, or neither? Starting with neither and inspecting the output is cheaper.
7. **Enabler redundancy.** Supply is binary, so two Tailwind users score the same as one, even though the second is real insurance. Accept as a known gap, or model it?
8. **`moves_first` duration.** Accept the permanent-flip approximation, or split Tailwind and Trick Room into separate conditions once the long-endgame bias is measured?
9. **Joint setup moves.** Split Bulk Up across two conditions, or pay for an atomic condition raising both stats at once?
10. **Stacking chip sources.** Summing magnitude enablers assumes they all land. Is a cap or a diminishing sum closer to reality, and can the difference be measured against simulated cells?
11. **Extrapolated mitigation.** Recording each side's HP at the other's faint makes a mitigation estimate possible without simulation. Is that estimate close enough to a simulated cell to be worth using?
12. **Regulation transitions.** Keep the previous regulation's matrix queryable for comparison, or rebuild in place?

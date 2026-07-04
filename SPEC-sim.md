# Pokémon Champions VGC Battle Simulator — Implementation Spec

## Prerequisite

This spec assumes the Damage Visualization project (`SPEC-damageviz.md`) is complete and its shared infrastructure — the Pikalytics scraper, the variant selection logic, and `data/defender-variants.json` — is available and correct.

## Goal

Build a 1v1 battle simulator that, given two Pokémon Champions VGC variants and a starting condition, returns the probability that the first Pokémon wins the resulting endgame. Run this simulator across the metagame to produce a matchup matrix, then build analysis tools on top.

- **Simulator core:** Drive Pokémon Showdown's simulator programmatically. Both sides pick moves according to a policy that Fable designs (see "Move-selection policy" below).
- **Matchup matrix:** For every pair of variants from `defender-variants.json` (call it C(N, 2) ≈ 500–800 pairings depending on variant count), and for each of a small set of starting conditions, run enough battles to estimate `P(A beats B)`.
- **Team-building analysis:** Given a subset of Pokémon designated as a "team core," identify Pokémon whose matchups complement the core (i.e., cover matchups the core loses).

## Format scope

Same as the damage viz project: **Pokémon Champions, VGC doubles, Regulation M-B (current M-series season).**

The simulator itself will run 1v1 battles because that's the analytical unit ("does Kingambit beat Incineroar in an endgame?"). It uses the doubles game rules — spread reduction, doubles-specific mechanics — but with one Pokémon per side.

## Version scope

- **v1 (this spec):** 1v1 battles with no support-move interactions. No Tailwind, Trick Room, screens, weather-setters, or Terrain-setters as the actor's own action. Weather/Terrain can be present as a *starting condition* (see "Starting conditions"), but neither Pokémon will set new field state during the simulated turns. This scope produces a clean, tractable v1 while still being useful — most 1v1 endgames don't involve turn-1 support moves.
- **v2 (later):** Full support-move interactions. Adds Tailwind, Trick Room, screens as playable moves. Requires the policy to reason about multi-turn state changes and is a substantial extension.

## Tech stack

- **Language:** TypeScript
- **Simulator:** `pokemon-showdown` npm package (drive the `BattleStream` API programmatically)
- **Shared code:** Import `lib/scrape.ts`, `lib/variants.ts`, `lib/pokemon.ts`, `data/defender-variants.json` from the damage-viz project (assume monorepo)
- **Compute:** Node scripts; the matchup matrix is embarrassingly parallel and can use `worker_threads` or child processes
- **Frontend:** React (extend the damage-viz app with new pages)
- **Storage:** SQLite for the matchup matrix — millions of `(variant_A, variant_B, condition, iteration, winner)` rows would be inefficient in JSON. Alternatively Parquet if that plays nicely with the frontend query layer.

## Repo structure (additions to damage-viz)

```
pokemon-champions-viz/
├── data/
│   ├── ... (existing files)
│   └── matchups.sqlite              # New: matchup matrix output
├── lib/
│   ├── ... (existing files)
│   ├── pokemon.ts                   # Refactor: canonical Pokemon construction (see damage-viz spec)
│   ├── sim/
│   │   ├── engine.ts                # Wraps pokemon-showdown BattleStream for a 1v1 battle
│   │   ├── policy.ts                # Move-selection policy (see "Move-selection policy" section)
│   │   ├── condition.ts             # StartingCondition type + application to a fresh battle state
│   │   └── harness.ts               # simulate(A, B, condition, iterations) -> P(A wins)
│   └── analysis/
│       ├── matrix.ts                # Query the matchup matrix
│       └── team.ts                  # Team-building coverage queries
├── scripts/
│   ├── ... (existing scripts)
│   ├── build-matchups.ts            # Run simulator across all pairs × conditions, write matchups.sqlite
│   └── calibrate-policy.ts          # (optional) Compare policy outputs to human-labeled matchups
└── src/
    ├── components/
    │   ├── ... (existing)
    │   ├── MatchupMatrix.tsx        # Grid view of all matchups
    │   ├── MatchupDetail.tsx        # Detailed view of one A-vs-B matchup with conditions selector
    │   └── TeamBuilder.tsx          # Team-building assist UI
    └── App.tsx                      # Add new routes
```

## Phase 0: Simulator smoke test (do this first)

Before committing to the full architecture, confirm the Showdown simulator can be driven headlessly for Champions 1v1 battles.

**Steps:**
1. `npm install pokemon-showdown`.
2. Read the `pokemon-showdown` README and the `sim/README.md` in that package to understand `BattleStream` usage. The API is stream-based: you write JSON commands to the stream (`>p1 move earthquake`, `>p2 move protect`), and it emits battle log messages (`|move|...`, `|damage|...`, `|faint|...`, `|win|...`).
3. Confirm Champions format IDs. Look at `pokemon-showdown/data/formats.ts` or similar for the format string (e.g., `gen9champions_dbmvgc`, `gen9vgc2026regmb`, etc — the actual name needs discovery). If no Champions-specific format ID exists, use the closest doubles VGC format and note the deviation.
4. Write a 50-line smoke test:
   - Instantiate a `BattleStream` for the Champions doubles format
   - Set up two teams (one Pokémon each, so it's effectively 1v1) — Mega Charizard Y vs Incineroar with modal spreads
   - Drive both sides with a trivial policy ("always pick move slot 1")
   - Read the log until the battle ends
   - Print who won
5. Verify Champions mechanics work: Mega Evolution triggers (Charizard Y should become Mega on turn 1 automatically per Champions rules — Reg M-B has a Mega slot mechanic; Fable should figure out the exact API for declaring the Mega), weather auto-sets (Drought should appear in the log), and moves resolve correctly.

**If Champions format ID isn't in the released pokemon-showdown package:**
1. Check the master branch of the smogon/pokemon-showdown GitHub repo — Champions data may be in unreleased code.
2. If not, fall back to Gen 9 VGC 2024 Reg G or the newest available Gen 9 doubles format and accept that Champions data (Grav Apple 90 BP, Growth as Grass-type, etc.) won't be reflected. Log this and add to known v1 limitations.

**Output of Phase 0:** A working `lib/sim/engine.ts` with a clean interface. Suggested shape (Fable may refine):

```typescript
type BattleSetup = {
  side_A: PokemonSet;              // { species, ability, item, moves[], evs, ivs, nature, level }
  side_B: PokemonSet;
  starting_condition: StartingCondition;
  policy_A: MovePolicy;
  policy_B: MovePolicy;
  seed?: number;                   // for reproducibility
};

type BattleResult = {
  winner: 'A' | 'B' | 'draw';
  turns: number;
  log: string[];                   // optional, for debugging
};

export async function runBattle(setup: BattleSetup): Promise<BattleResult>;
```

Don't proceed to Phase 1 until this works end-to-end on the Zard Y vs Incineroar test case.

## Phase 1: Move-selection policy

**Decision deferred to Fable.** The user has explicitly asked for Fable to propose the move-selection policy design. This is one of the highest-leverage decisions in the project — a bad policy gives a wrong matchup matrix, a good one gives useful analysis. Fable should:

1. **Read the space of options** before deciding. At minimum, know that these are all reasonable choices:
   - **Random policy** (baseline, not usable for real analysis but useful for testing the harness)
   - **Damage-max policy** (pick move with highest expected damage this turn — fast, biased away from setup/defensive play)
   - **Depth-N minimax** with alpha-beta pruning, sampling K damage rolls per branch (accurate, expensive)
   - **Expectimax** (like minimax but averages over opponent policy rather than assuming worst case — often more realistic for VGC where opponents don't play adversarially against you specifically)
   - **Monte Carlo Tree Search (MCTS)** (asymptotically strong, requires more implementation)
   - **Adopt an existing bot's policy** (foul-play, pmariglia's bot, showdown-battle-bots — search for currently-maintained ones)

2. **Propose an initial policy** with reasoning. Justify why it's a good starting point for 1v1 Champions endgames specifically. The v1 scope excludes support moves, which simplifies the state space significantly — a policy that would be too expensive for full doubles may be fine here.

3. **Design for pluggability.** `lib/sim/policy.ts` should export a `MovePolicy` interface. Implementations can be swapped without touching the harness. This makes it easy to A/B test policies and to upgrade later.

4. **Sanity-check the policy** against known matchups before running the full matrix. Suggested sanity cases:
   - Mega Charizard Y at 100% HP vs Incineroar at 100% HP, no field effects: Zard Y should win a large majority of the time (Heat Wave/Overheat hits Incineroar for supereffective STAB in Sun; Incineroar's Fire STAB is neutralized by Zard Y's Fire resistance).
   - Kingambit at 100% vs Incineroar at 100% with Iron Head vs Flare Blitz — Incineroar wins if Kingambit lacks a Fighting move; even splits or Incineroar-favored if it has Fake Out (irrelevant in 1v1 endgame but sanity-check the logic).
   - Speed-tied Pokémon should have their coin-flip modeled correctly — run 1000 simulations and confirm ~50/50 on a genuine speed tie mirror match with identical moves.

**Suggested v1 policy for Fable to consider as a starting point** (Fable is free to override): Expectimax with depth 4, sampling 3 damage rolls per action (min, avg, max), with pruning by evaluating each node with a simple heuristic (remaining HP percentage, weighted). This roughly matches what strong VGC players reason about — "if I do this and they do that, where does the HP land, and who's ahead?" — while remaining tractable at maybe 100–500 ms per battle.

**Output of Phase 1:** `lib/sim/policy.ts` with at least one working policy. Document Fable's design choice in the README and in code comments.

## Phase 2: Starting conditions

A starting condition specifies the state of the battle at turn 1, letting us simulate not just "fresh matchup" but "matchup given X."

**v1 conditions to model:**

```typescript
type StartingCondition = {
  // Per-side HP (default 1.0 = full HP)
  hp_A?: number;                   // 0.0 to 1.0
  hp_B?: number;

  // Per-side stat stages (default all 0)
  boosts_A?: Partial<Record<Stat, number>>;  // -6 to +6
  boosts_B?: Partial<Record<Stat, number>>;

  // Per-side status conditions (default none)
  status_A?: 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz' | null;
  status_B?: 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz' | null;

  // Field effects (default none)
  weather?: 'sun' | 'rain' | 'sand' | 'snow' | null;
  weather_turns_remaining?: number;
  terrain?: 'electric' | 'grassy' | 'misty' | 'psychic' | null;
  terrain_turns_remaining?: number;
  tailwind_A?: number;             // turns remaining, 0 = none
  tailwind_B?: number;
  trick_room_turns?: number;       // turns remaining
  screens_A?: { reflect?: number; light_screen?: number };
  screens_B?: { reflect?: number; light_screen?: number };
};
```

**How to apply:** Showdown's `BattleStream` doesn't (by default) accept arbitrary starting state — it starts fresh. Fable will need to either:
1. Find and use Showdown's `debug` or `omniscient` mode for setting state directly, or
2. Simulate the state changes on a fresh battle before the "real" turns begin (send fake preparatory moves that leave the state matching the condition), or
3. Fork the pokemon-showdown package and add a starting-state API.

Fable should investigate option 1 first — Showdown does have some testing hooks — and only fall back if needed. Whatever the mechanism, it should be encapsulated in `lib/sim/condition.ts` behind an `applyCondition(battle, condition)` function.

**Condition set for the matchup matrix:** Not every combination — that's a combinatorial explosion. Instead, define a small enumerated set of "interesting" conditions to sweep:

1. `fresh` — no field state, both Pokémon at 100% HP, no boosts.
2. `tailwind_A` — side A has Tailwind for 4 turns.
3. `tailwind_B` — side B has Tailwind for 4 turns.
4. `trick_room` — Trick Room active for 5 turns.
5. `sun` — Sun weather for 5 turns.
6. `rain` — Rain weather for 5 turns.
7. `A_boosted_atk` — side A at +1 Atk (models Defiant/Competitive activation, or a Swords Dance from earlier).
8. `A_boosted_spa` — side A at +1 SpA (models Growth in Sun, Nasty Plot, etc.).
9. `B_boosted_atk`, `B_boosted_spa` — mirrors.

That's 9 conditions × ~600 pairs (both orderings) ≈ 5400 matchup cells for v1. If each cell needs 100 simulated battles to converge, and each battle takes 300 ms with a reasonable policy, that's 5400 × 100 × 0.3 s ≈ 45 minutes single-threaded. Very tractable with even modest parallelism.

## Phase 3: Battle harness

`lib/sim/harness.ts` exports:

```typescript
type MatchupResult = {
  variant_A_id: string;
  variant_B_id: string;
  condition: string;               // condition ID from the enumerated set above
  n_simulated: number;
  wins_A: number;
  wins_B: number;
  draws: number;
  p_A_wins: number;                // wins_A / n_simulated
  ci_low: number;                  // 95% CI lower bound (Wilson)
  ci_high: number;                 // 95% CI upper bound
  mean_turns: number;              // avg battle length
};

export async function estimateMatchup(
  variant_A: DefenderVariant,
  variant_B: DefenderVariant,
  condition: StartingCondition,
  n: number = 100
): Promise<MatchupResult>;
```

**Reproducibility:** Every battle gets a deterministic RNG seed derived from `hash(variant_A_id, variant_B_id, condition_id, iteration)`. This means re-running the harness on the same inputs gives the same results — critical for debugging.

**Statistical stopping:** For faster convergence, use adaptive sampling. Start with N=20 battles; if the confidence interval is wide (e.g., > 0.1 wide), do more up to N=200. If the answer is clearly one-sided (e.g., wins_A / n > 0.95 or < 0.05) stop early. This can 3× throughput on the easy matchups.

## Phase 4: Build matchup matrix

`scripts/build-matchups.ts`:

1. Load `data/defender-variants.json`.
2. For each pair `(A, B)` where `A != B` (order matters for the "who's on the field" perspective, so run both `(A, B)` and `(B, A)` — this is redundant for symmetric conditions but not for asymmetric ones like `tailwind_A`):
   - For each condition in the enumerated set:
     - Run `estimateMatchup(A, B, condition)`.
     - Insert one row into `data/matchups.sqlite`.
3. Use `worker_threads` to parallelize. Aim for `os.cpus().length - 1` workers.
4. Log progress every 1% of the way. Save incrementally so a crash doesn't lose hours of work.

**Schema for `matchups.sqlite`:**

```sql
CREATE TABLE matchups (
  variant_A TEXT NOT NULL,
  variant_B TEXT NOT NULL,
  condition TEXT NOT NULL,
  n_simulated INTEGER NOT NULL,
  wins_A INTEGER NOT NULL,
  wins_B INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  p_A_wins REAL NOT NULL,
  ci_low REAL NOT NULL,
  ci_high REAL NOT NULL,
  mean_turns REAL NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (variant_A, variant_B, condition)
);
CREATE INDEX idx_A ON matchups(variant_A);
CREATE INDEX idx_B ON matchups(variant_B);
CREATE INDEX idx_condition ON matchups(condition);
```

## Phase 5: Analysis layer

### Matchup query API

`lib/analysis/matrix.ts` exports functions the UI can call:

```typescript
export function getMatchup(A: VariantId, B: VariantId, condition: ConditionId): MatchupResult | null;
export function bestMatchupsFor(A: VariantId, condition: ConditionId, n: number): MatchupResult[];  // A's easiest wins
export function worstMatchupsFor(A: VariantId, condition: ConditionId, n: number): MatchupResult[];  // A's hardest losses
export function coverageDelta(A: VariantId, B: VariantId, condition: ConditionId): Map<VariantId, number>;
  // For each opponent V: (P(A beats V) OR P(B beats V)) - max(P(A beats V), P(B beats V))
  // Positive values = V is better covered when A+B are both threats than either alone
```

### Team-building analysis

`lib/analysis/team.ts`:

**Given a team core** (a set of 1–4 variants, e.g., `[charizard_mega_y, floette_mega]`), rank all other variants by how well they extend the core's matchup coverage:

```typescript
export function suggestPartners(
  core: VariantId[],
  condition: ConditionId,
  metagame_weights: Map<VariantId, number>  // from usage %
): Array<{ variant: VariantId; coverage_score: number; details: string }>;
```

**Coverage score definition:**

For each opponent variant V in the metagame:
- `team_best(core, V)` = `max` over Pokémon P in core of `P(P beats V)`.
- `team_best(core + [candidate], V)` = same, but including candidate.
- `improvement(V)` = `team_best(core + [candidate], V) - team_best(core, V)`.
- `coverage_score(candidate)` = weighted sum over V of `metagame_weights(V) × improvement(V)`.

Rank candidates by `coverage_score` descending. The top results are Pokémon that beat opponents your core loses to, weighted by how common those opponents are.

Refinement: weight improvements more when the core's team_best on V is close to 0.5 (uncertain matchup) or below (losing matchup). A candidate that pushes a 60% matchup to 65% is less valuable than one that pushes a 30% matchup to 65%. Fable can propose the exact weighting function.

## Phase 6: Frontend

Add three pages to the existing damage-viz app:

### `/matchups` — Full matchup grid

- N × N grid of variants (rows = attacker perspective, columns = opponent)
- Cell shading = P(row beats column), diverging scale around 0.5
- Cell text = the percentage (e.g., `72%`)
- Dropdown to select condition (default: `fresh`)
- Click a cell to open MatchupDetail
- Row/column sort options (by usage %, by average win rate, alphabetical)

### `/matchup/:A/:B` — Matchup detail

- Show the specific matchup for A vs B with a condition selector
- Line chart of turn-by-turn HP if we log that
- Small stat block for both Pokémon
- The 9 conditions displayed side-by-side so the user can see how e.g. Tailwind affects it

### `/team-builder` — Team building assist

- User selects 1–4 variants as the "core"
- Below: a ranked list of suggested partners with their coverage_score
- For each candidate, show which opponent variants it covers well (top 5 improvements)
- Condition selector affects the analysis

Frontend loads `matchups.sqlite` — either as a WASM SQLite (sql.js) fetched at page load, or via a lightweight API endpoint. If the sqlite file is < 20 MB, sql.js is simpler. If it grows past that, a small API server (Cloudflare Worker + D1, or a simple Node/Express endpoint) is better.

## Non-goals / known v1 limitations

Document these in the README:

1. **No support moves.** Weather-setters, Tailwind, Trick Room, screens are only available as *starting conditions*, not as playable moves during the simulation. This means matchups involving Pokémon whose value comes from support (e.g., Grimmsnarl, Farigiraf) will underrepresent them. v2 addresses this.
2. **No switching.** 1v1 endgame only. Pokémon that shine through pivoting (like Landorus historically, or Basculegion with Wave Crash recoil setting up revenge kills) are undervalued.
3. **Policy realism.** The chosen policy is not literally what a human plays. Even minimax at depth 4 misses long-horizon plays (Belly Drum turn 1 to set up turns 3–5, for example, or intentional sacs to bring in a stronger threat). The matrix should be read as "under one specific decision policy, who wins" rather than "who wins in real play."
4. **Team preview / spread selection.** Both sides use their variant's modal spread. Real players customize spreads to matchup-specific benchmarks; our matrix doesn't.
5. **Redirection is skipped in 1v1.** Rage Powder / Follow Me have no effect with only one Pokémon per side. This is correct for 1v1 endgame but flags that the sim doesn't cover teammate-dependent value.

## Implementation order

1. **Phase 0** (simulator smoke test) — must work first
2. **Phase 1** (Fable designs move-selection policy) — most critical decision; include reasoning in a design doc
3. **Phase 2** (starting conditions) — before harness, so the harness can accept them
4. **Phase 3** (harness with statistical stopping)
5. **Sanity check** the whole pipeline on 5 well-known matchups before running the full matrix. If Kingambit-vs-Incineroar returns 30% for Kingambit when everyone knows it wins that matchup >70% of the time, stop and debug.
6. **Phase 4** (full matrix build) — long-running; may take an hour
7. **Phase 5** (analysis functions)
8. **Phase 6** (frontend)

## Test cases to verify correctness

Before declaring v1 done, sanity-check these matchups against community consensus:

- **Mega Charizard Y vs Incineroar, fresh condition:** Zard Y wins ~70%+ (STAB Fire in Sun into a 4× weak target, Zard Y outspeeds).
- **Kingambit vs Amoonguss, fresh:** Kingambit wins ~85%+ (STAB Dark hits Amoonguss for 2×, Amoonguss has no relevant offensive answer).
- **Incineroar vs Kingambit, fresh:** Incineroar wins ~65-75% (Flare Blitz 2HKOs Kingambit; Kingambit's Iron Head is neutral into Incineroar's high phys bulk).
- **Garchomp vs Rotom-Wash, fresh:** Rotom-Wash wins ~80%+ (Hydro Pump 2HKOs Garchomp; Levitate means Earthquake does nothing).
- **Speed tie mirror match** (any Pokémon vs the same variant): ~50/50 across 1000 iterations.

If any of these are more than 15 percentage points off from expectations, investigate before running the full matrix.

## Notes for the implementer

- Log the policy version and calc lib version in `matchups.sqlite` (add a `metadata` table). When either changes, regenerate the matrix — old rows become invalid.
- The full matrix regeneration should be reproducible. Given the same inputs (variants, policy, calc lib versions, RNG seeding scheme), it should produce identical output.
- Parallelism: pokemon-showdown battles are pure functions of their inputs given a seed. `worker_threads` should work cleanly. Don't share Node globals between workers.
- Debug logs: for any matchup where the CI is wide (e.g., > 0.15), save the full battle logs so the user can review what happened. Store in `data/debug-battles/` and reference from the matchup detail page.
- Add a CLI subcommand `npm run inspect-matchup -- --A charizard_mega_y --B incineroar --condition fresh --verbose` that runs one battle with full logging. Extremely useful for debugging the policy.

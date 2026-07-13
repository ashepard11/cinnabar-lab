# Backlog

Feature ideas queued for future work, ordered by suggested priority. Sizes:
- **Small** — one session
- **Medium** — two to three sessions
- **Large** — planning session followed by one or more implementation sessions

---

## Priority 1 — do next

### 01. Endgame test suite *(Small)*

Assemble 10–20 known-hard 1v1 endgames with community-consensus outcomes. Examples: Bulk Up Ceruledge, Iron Defense Rest Toxapex, Belly Drum Sitrus Azumarill, Calm Mind Cresselia.

Run the current policy against them and record the delta from expected. Quantifies how bad the policy actually is before deciding how much to invest in fixing it.

**Deliverable:** a test file that runs on CI. Any regression in these matchups fails the build.

### 02. Content-addressed variants and matchup keys *(Medium)*

Give each variant a stable ID derived from a hash of its full spec (species, ability, item, nature, SP spread, moves). Matchup rows keyed on `(variant_A_id, variant_B_id, condition, policy_version, calc_version, sim_engine_version)`.

Foundation for incremental refresh (item 03) and custom set simulation (item 05). Doing it now avoids a data migration later.

**Blocks:** 03, 05

---

## Priority 2 — high value, do soon

### 03. Incremental matrix refresh *(Medium)*

When the scraper produces new variants, diff against existing and only simulate pairs involving new or changed variants. Full rebuild only happens when policy or engine versions change.

Cost per metagame update drops from ~an hour to a few minutes for typical shifts.

**Depends on:** 02

### 04. Defensive item variants *(Medium)*

Extend the item bucketing logic used for offensive items (per-Pokémon, threshold-based, aggregate the rest as "no item") to cover legal defensive items in Reg M-B. Only the most common defensive items per Pokémon get their own variants.

Sim variants will diverge from damage-viz variants. Either split into two files or add a `sim_expanded` flag on shared records.

Requires re-running the matchup matrix. Combine with item 03 to make that cheap.

**Depends on:** 03

### 05. Custom set simulation *(Large)*

Users define a set (species, ability, item, nature, spread, moves) via the UI or by pasting Showdown syntax. System computes the variant ID, checks the cache, and simulates on-demand against the field if not cached.

Once a custom variant exists, all existing analysis (matchups, coverage, condition sensitivity) works automatically.

Deployment tradeoffs: static site + client-side sim (5–10 MB dep, slow) vs adding a small backend for the simulation queue. Decide before implementing.

**Depends on:** 02

---

## Priority 3 — larger investments

### 06. Contextual boost sweeps per Pokémon *(Large)*

Replace the generic ±1 stat-stage sweeps with per-variant "realistic states" based on moveset and ability. Bulk Up Kingambit sweeps +0/+1/+2 Atk. Calm Mind Floette sweeps joint SpA/SpD boosts. Physical attackers without Intimidate immunity sweep -1 Atk.

User prefers keeping each state as its own condition — no marginalization over an artificial state-probability distribution.

**Open question:** variants become asymmetric across the matrix (each Pokémon has different valid conditions). Aggregation for rankings, team builder, and coverage math needs a design pass before implementation.

### 07. Sophisticated decision algorithm for setup endgames *(Large)*

Current policy misses long-horizon setup plans (Bulk Up Bitter Blade Ceruledge, Belly Drum Azumarill, Iron Defense Rest walls). The winning line is often "set up 4 turns, then start winning" and needs 6–10 turn search to see.

Options:
- Hand-coded position patterns that extend search depth on matching subtrees
- MCTS/UCT as a full replacement
- Selective escalation to MCTS only on positions the fast policy can't resolve

Depends on item 01 (test suite) telling us how big the problem actually is. If only a few classes of endgame are broken, patch. If dozens, replace the policy.

**Depends on:** 01

### 08. Team evaluator *(Large)*

New page. User pastes a team (Showdown format) or builds it manually. System produces a multi-dimensional evaluation of the team.

**Input:** 4–6 Pokémon sets (species, ability, item, nature, spread, moves, tera-equivalent if applicable). Support Showdown paste parsing and manual entry.

**Evaluation dimensions:**

- **Worst matchups.** Same ranking logic as team builder's weakest-matchups list (lexicographic on best/second-best coverage, metagame-weighted). Reuse that component.

- **Type matchup matrix.** For each attacking type × the team's defensive typing, bucket the interaction into extremely effective (4×), super effective (2×), neutral (1×), resist (0.5×), highly resist (0.25×), and immune (0×). Account for defensive abilities that modify type effectiveness (Levitate, Thick Fat, Water Absorb, Volt Absorb, Flash Fire, Sap Sipper, Storm Drain, Lightning Rod, Motor Drive, Fluffy, etc.). Compute the same matrix in reverse for the team's *offensive* movepool. Display as two heatmaps or grouped tallies. Bug when Reg M-B has type-changing items like Terapagos ability considerations — verify against the current metagame.

- **Total relevant BST.** Sum of stats across the team, excluding stats that aren't used (e.g., Atk if a Pokémon has zero physical moves; SpA if it has zero special moves; Speed on a Trick Room setter is complicated — probably include but flag). Show per-Pokémon breakdown and team total.

- **Board control inventory.** Enumerate what the team has for each category. This is a movepool + ability scan producing structured tallies:
  - **Speed control:** Tailwind, Trick Room, Thunder Wave, Icy Wind, Electroweb, Bulldoze, priority moves (Fake Out, Extreme Speed, Sucker Punch, Grassy Glide, Bullet Punch, Aqua Jet, etc.), Prankster, Gale Wings.
  - **Weather control:** setting abilities (Drought, Drizzle, Sand Stream, Snow Warning) and moves (Sunny Day, Rain Dance, Sandstorm, Snowscape); counter-abilities (Cloud Nine, Air Lock).
  - **Terrain control:** setting abilities (Grassy Surge, Electric Surge, Psychic Surge, Misty Surge) and moves (Grassy Terrain, Electric Terrain, Psychic Terrain, Misty Terrain); disruptors (Ice Spinner, Steel Roller, Splintered Stormshards).
  - **Targeting control:** Follow Me, Rage Powder, Fake Out, Ally Switch, redirection-immune moves.
  - **Damage mitigation:** Reflect, Light Screen, Aurora Veil, Intimidate, Friend Guard, Charm, Snarl, Will-O-Wisp, Wide Guard, Quick Guard, Protect variants, Cotton Guard, Iron Defense.
  - **Pivoting:** U-turn, Volt Switch, Flip Turn, Baton Pass, Parting Shot, Teleport, Roar, Whirlwind, Dragon Tail, Circle Throw.
  - **Option control:** ability-based blocks (Armor Tail / Dazzling / Queenly Majesty blocking priority; Electric Terrain blocking sleep; Sweet Veil blocking sleep; Misty Terrain blocking status; Aroma Veil blocking Taunt/Encore/Disable) and move-based blocks (Wide Guard, Quick Guard, Encore, Disable, Taunt, Torment, Heal Block, Imprison).

  Display as a table: rows are categories, columns are team members, cells show what each Pokémon contributes.

- **RNG exposure.**
  - **Favorable RNG:** enhanced crit rate (Focus Energy, Super Luck, Razor Claw, high-crit moves like Slash / Night Slash / Stone Edge), secondary chances the team wants to hit (Heat Wave burn, Rock Slide flinch, Air Slash flinch, Iron Head flinch, Sludge Bomb poison, sleep-inducing moves with multi-turn sleep RNG, Serene Grace doubling secondaries).
  - **Unfavorable RNG:** accuracy < 100% on frequently used moves (Rock Slide 90, Hurricane 70, Focus Blast 70, Stone Edge 80, Hydro Pump 80, High Jump Kick 90 with crash penalty, OHKO moves).

  Tally counts per category; list the specific interactions. This helps the user see "I'm running four sub-100 accuracy moves" or "I have no proactive RNG upside, so I need every roll to go my way."

**Layout:** stacked sections, each collapsible so the user can focus on one dimension at a time. Team roster fixed at the top of the page. Route: `/team-evaluator`.

**Data sources:** move metadata (type, BP, category, accuracy, priority, secondary effects) from PokéAPI or Showdown data. Ability effect table needs to be assembled — probably hand-curated for the abilities that matter for board control and type interactions. Matchup data pulled from `data/matchups.sqlite` for the worst-matchups section.

**Open questions before implementation:**
- How to handle move slot changes on the fly (edit team, re-evaluate)
- Whether to compare against a "baseline" team so the numbers have context ("your team has 3 speed control options — the metagame average is 2.1")
- Whether team members that aren't in `defender-variants.json` (custom sets) can be evaluated. Requires item 05 to fully support.

**Partial dependency on:** 05 (for evaluating custom sets against the metagame).

**Prework:** write a full spec (`SPEC-team-evaluator.md`) before starting implementation. Enumerate the board-control tag taxonomy in full, decide the ability-modified-vs-raw type chart question, lock the RNG scoring approach, and pin down the ability effect table. Follow the same structure as `SPEC-damageviz.md` and `SPEC-sim.md`.

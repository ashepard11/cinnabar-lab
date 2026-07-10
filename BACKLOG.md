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

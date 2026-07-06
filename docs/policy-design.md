# Move-selection policy design (SPEC-sim.md Phase 1)

The policy decides, each turn, which of ≤4 moves each side clicks. It is the
single largest determinant of matchup-matrix quality: a myopic policy produces
a matrix that answers "who wins if both players play badly," which is not the
question. This doc surveys the option space, proposes a policy for v1, and
defines how we validate it before trusting the matrix.

## 1. The decision problem

A Champions 1v1 endgame with the v1 scope (no support moves, no switching) is
a **two-player zero-sum simultaneous-move stochastic game** with a small state
space:

- State ≈ (HP ×2, stat stages ×2, status + counters ×2, PP, protect/stall
  counter, choice lock, first-turn flag, weather + turns, terrain + turns,
  Tailwind/Trick Room/screen turns). Nearly all battles are decided in 2–6
  turns.
- Simultaneity matters: both sides commit moves before either resolves.
  A policy that assumes it sees the opponent's move first (classic minimax)
  is systematically paranoid; one that assumes the opponent is a fixed
  automaton is exploitable in exactly the spots that decide close endgames
  (Protect timing, Sucker Punch vs. status, setup vs. attack).
- Chance nodes: 16 damage rolls per hit, accuracy, crits, speed ties,
  secondary effects, sleep/paralysis turns.

**Scale constraint.** Our metagame has 89 variants → 3,916 unordered pairs
× 10 starting conditions ≈ 39k unique matchup cells (mirrors are derived, see
Phase 4). With adaptive sampling averaging ~40 battles/cell that is ~1.6M
battles. The per-battle time budget that keeps the full matrix build in the
"one to two hours on a desktop" range is **~10–50 ms**, i.e. ~2–10 ms per
policy call. This rules out anything that steps or clones the real Showdown
battle inside the search (~1–5 ms per clone, hundreds of clones per turn).

## 2. Option space (from the spec)

| Option | Verdict for 1v1 Champions endgames |
|---|---|
| **Random** | Baseline for harness testing only. Kept as `random` policy. |
| **Damage-max** | Fast, and near-optimal in pure KO races. But it never sets up, never uses recovery or Protect purposefully, ignores accuracy trade-offs (always clicks Zap Cannon over Thunderbolt if it deals more), and suicides into recoil. It systematically misprices exactly the Pokémon whose endgame value is stalling, statusing, or boosting (Amoonguss, Rotom-W, Dondozo-likes). Kept as `damage-max` baseline for A/B comparison. |
| **Depth-N minimax + alpha-beta** | Sound for sequential games; wrong turn model here. Sequentializing a simultaneous game either leaks our choice to the opponent (paranoid: never clicks Sucker Punch, overvalues Protect) or leaks theirs to us (clairvoyant: overvalues coin-flip lines). Alpha-beta also prunes poorly with chance nodes interleaved. |
| **Expectimax over a fixed opponent model** | The spec's suggested starting point. Tractable and averages over chance correctly, but the fixed opponent model is the weak joint: if the opponent is modeled as damage-max, expectimax learns to exploit an automaton (e.g. Protect is "free" every other turn). Fine for lopsided matchups, biased in close ones — and close cells are the ones the team-builder cares about. |
| **MCTS** | Asymptotically right but needs a fast forward model anyway, plus rollout variance forces many iterations per decision. For a game this small, exact solving of the per-turn matrix beats sampling it. |
| **Adopt an existing bot** (foul-play, pmariglia/poke-engine, showdown-battle-bots) | All are Gen 9 singles-focused and none has Champions data. Champions' level-independent stat formula (`HP = base + SP + 75`) breaks their damage models at the root; poke-engine is a Rust dependency with its own mechanics reimplementation we'd have to patch for Champions. Integration cost exceeds writing a 1v1-scoped model, and we'd still have to validate it against the same sanity matchups. |

## 3. Chosen policy: depth-limited equilibrium search (`nash-d2`)

Per-turn, the policy builds the **payoff matrix over legal move pairs** using
a fast forward model, recursing to depth *D* (default 2 turns), and solves
each matrix game for an equilibrium instead of assuming either sequential
order or a fixed opponent:

```
solve(state, depth):
  if terminal(state): return 1 / 0 / 0.5        # A wins / loses / draw
  if depth == 0:      return eval(state)
  for each legal pair (a, b):
    Q[a][b] = E over chance branches of solve(step(state, a, b), depth - 1)
  σ_A, σ_B, v = equilibrium(Q)                   # fictitious play, ≤80 iters
  return v                                       # (and σ_A at the root)
```

- **Root behavior:** the policy samples its move from its equilibrium mixed
  strategy σ_A using a battle-seeded PRNG. In most states the equilibrium is
  pure (attack/attack) and this is deterministic; in genuine mind-game states
  (Protect timing, Sucker Punch vs. Will-O-Wisp) mixing is the *correct*
  behavior and keeps the policy unexploitable by construction. Seeding keeps
  every battle reproducible.
- **Equilibrium solver:** fictitious play on the ≤5×5 matrix (a few thousand
  float ops). No LP needed; FP converges to the zero-sum game value and the
  average strategies are an ε-equilibrium, plenty for move ranking.
- **Why equilibrium and not expectimax:** it degrades gracefully. In
  lopsided states it returns the same answer as damage-max/expectimax; in
  close states it neither panics (paranoid minimax) nor exploits a strawman
  (fixed-model expectimax). VGC players do not play adversarially against
  *you specifically*, but they also aren't automatons; the equilibrium is
  the assumption-free middle and is exactly solvable at this scale.

### 3.1 Forward model

The search runs on a **planning model**, not the real battle: a ~15-field
state struct plus a transition function. Ground truth is always the real
Showdown battle — the model only has to *rank moves*, and any divergence
(unmodeled secondary effect, crit) simply lands the policy in a new real
state where it re-plans.

- **Damage:** `@smogon/calc` (the vendored Champions build already validated
  in the damage-viz project), called with the full planning state — boosts,
  status, weather, terrain, screens, items, abilities. Calls are memoized on
  (matchup, move, relevant-state) — within one matchup cell (20–200 battles
  of the same pair) the hit rate is near-total, so the amortized cost is
  microseconds.
- **Chance handling:** per hit, two branches — *KO* with exact probability
  `P(roll ≥ defender HP)` from the calc's 16-roll array, else *mean of
  non-KO rolls*. KO probability is the quantity that decides races, so it is
  exact; within-turn damage variance otherwise collapses to the mean.
  Accuracy adds a hit/miss branch when < 100%; speed ties branch 50/50.
  Crits and unlisted secondaries are ignored in planning (symmetric noise,
  present in execution).
- **Mechanics covered** (driven by dex data, not per-move code, wherever
  possible): move order (priority incl. Psychic Terrain / Grassy Glide,
  effective speed with boosts, paralysis, Tailwind, Trick Room, weather
  speed abilities), protect family with stall-counter success decay,
  Fake Out (first-turn flag + flinch), Sucker Punch conditionality, recoil /
  drain / self-KO, recovery moves (incl. weather-scaled), setup and
  stat-drop moves, primary status moves with immunity checks, residual
  damage (burn, toxic ramp, sand, Leech Seed), charge moves (Solar Beam in
  sun, Hyper Beam recharge), fixed-damage moves, multi-hit expectation,
  choice lock, PP → Struggle.
- **Deliberately approximated:** Encore/Disable/Perish Song/After You are
  modeled as no-ops in planning (the real battle still executes them; the
  policy just doesn't chase their value — a v1-documented limitation),
  Last Respects/Rage Fist stay at base power (consistent with damage-viz
  D17), sleep/freeze modeled at expected turns rather than full branching.

### 3.2 Leaf evaluation: the KO race

`eval(state)` maps to a win-probability-like score in [0, 1] built around the
**KO race** — expected turns-to-KO for each side from the current state:

```
ttk_S  = ceil( opp_HP / best_expected_per_turn_damage(S) )
score  = 0.5 + 0.5 · tanh( 0.8·(ttk_B − ttk_A) + 0.6·speed_edge
                           + 0.5·(hp_A − hp_B) + boost_term + status_term )
```

`best_expected_per_turn_damage` is max over the side's damaging moves of
mean rolls × accuracy, from the same memoized calc as the search — so burn,
boosts, screens and weather are priced into the race automatically.

An earlier draft used plain HP difference as the core signal; testing showed
the classic horizon effect — Protect reads as a free turn (loss pushed past
the search depth), and Will-O-Wisp reads as ~zero value (its payoff is all
future turns). The race eval fixes both *structurally*: delay doesn't change
ttk, and burn doubles the opponent's ttk. With it, depth 2 is sufficient for
the sanity suite; the HP/boost/status terms remain as small tie-breakers,
deliberately down-weighted because the calc already reflects them in the
race. The sanity suite (§4) is the check on these numbers.

### 3.3 Depth and budget

Default **D = 2** (this turn + response turn, then eval). Depth 2 captures KO
races, "can I afford to set up," and recovery-loop viability. The spec
suggests D = 4 at 100–500 ms/battle; our matrix is ~10× the spec's cell
estimate, so we start at D = 2 (~5–20 ms/battle target) and raise the depth
only if the sanity checks demand it. Depth is a constructor parameter and the
policy id (`nash-d2`, `nash-d3`, …) is recorded in the sqlite metadata so a
depth change forces a matrix rebuild.

### 3.4 Pluggability

`lib/sim/policy.ts` exports the `MovePolicy` interface (already consumed by
`engine.ts`), a registry (`getPolicy(id)`), and three implementations:
`random`, `damage-max`, `nash-d2`. Policies are constructed per battle but
share the damage-calc memo per matchup cell. The harness takes policies as
parameters; swapping or A/B-testing policies never touches engine or harness.

## 4. Sanity-check plan

Gate before the Phase 4 matrix build (per spec + user instruction: stop and
debug if any expected-win-rate check is > 15 pp off):

1. **Zard Y vs Incineroar, fresh** — expect Zard Y ≥ ~70%.
2. **Kingambit vs Amoonguss, fresh** — expect Kingambit ≥ ~85%.
3. **Incineroar vs Kingambit, fresh** — expect Incineroar ~65–75%.
4. **Garchomp vs Rotom-Wash, fresh** — expect Rotom-W ≥ ~80%.
5. **Speed-tie mirror** (identical variant vs itself, 1000 battles) —
   expect 50/50 ± sampling noise; also validates the seeding scheme (battles
   must not share RNG streams).

Plus structural invariants:

- **Policy dominance:** `nash-d2` must beat `random` and at least match
  `damage-max` head-to-head in aggregate across a sample of matchups — a
  smarter policy that loses to a dumber one signals a forward-model bug.
- **Termination:** no battle hits the 500-turn draw cap in the sanity set;
  mean turns in single digits for standard matchups (Protect-loop guard).
- **Reproducibility:** same seed → identical battle log, across runs and
  across worker processes.
- **Timing:** mean battle time within the ~50 ms budget, measured on the
  sanity matchups, before committing to the full build.

## 5. Risks and the upgrade path

- **Forward-model divergence** is the main risk (mispriced mechanic → wrong
  move ranking → biased cell). Mitigations: ground truth stays in Showdown;
  the model is data-driven from the dex; the sanity gate is mandatory; and
  `inspect-matchup --verbose` (Phase 3) exists to audit any suspicious cell
  turn by turn.
- **Eval coefficients** are hand-set. If sanity checks land inside 15 pp but
  near the edge, tune eval before touching depth (cheaper, less variance).
- **v2:** support moves expand the state space (field timers interacting
  with move choice) but the architecture holds — extend the transition
  function, raise depth if needed, register as `nash-v2-dN`. MCTS on top of
  this forward model is the natural escalation if exact depth-limited search
  stops being tractable.

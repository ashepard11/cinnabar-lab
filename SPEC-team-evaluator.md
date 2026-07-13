# Pokémon Champions VGC Team Evaluator — Implementation Spec

## Prerequisite

This spec assumes both prior projects are complete: the damage-viz infrastructure
(`SPEC-damageviz.md` — scraper, variant builder, `data/defender-variants.json`,
the vendored Champions `@smogon/calc`) and the sim project (`SPEC-sim.md` —
`data/matchups.sqlite`, the analysis layer in `lib/analysis/`, the client-side
mirror in `src/lib/matchupDb.ts`, and the vendored Champions `pokemon-showdown`
package). It also assumes content-addressed variant ids (BACKLOG item 02) are
merged: variants carry a `cid`, and `lib/variant-cid.ts` exposes
`canonicalSpec` / `variantCid`.

## Goal

A new page at `/team-evaluator`. The user pastes a team (Showdown export
format) or builds it manually. The system produces a multi-dimensional,
static-analysis evaluation of the team:

1. **Worst matchups** — reusing the team builder's weakest-matchups ranking.
2. **Type matchup matrix** — defensive and offensive, ability-aware.
3. **Total relevant BST** — stat totals excluding stats the set doesn't use.
4. **Board control inventory** — structured tallies of speed / weather /
   terrain / targeting control, damage mitigation, pivoting, option control.
5. **RNG exposure** — favorable and unfavorable variance the team is exposed to.

Everything except the worst-matchups section is a pure function of the parsed
team plus static dex data — no simulation, no network calls beyond the initial
data fetch. The worst-matchups section queries the existing matchup matrix.

## Deferred elements — blocked on other backlog items

These are specified here so the v1 code leaves the right seams, but they
**cannot be implemented until the items they depend on are complete**:

| Deferred element | Blocked on | v1 behavior |
|---|---|---|
| **Exact-set worst matchups.** Matchup rows for the *pasted* set (its real moves/spread), rather than the nearest known variant. Requires computing the set's cid, checking the matchup cache, and simulating on demand. | **Item 05** (custom set simulation; its deployment question — client-side sim vs. backend queue — is still undecided) | Approximate each team member by its nearest known variant (matching rules in Phase 6). Members with no matching variant are **excluded** from the worst-matchups section with a visible explanation. |
| **Custom-set evaluation against the metagame** generally (the backlog's open question "whether team members that aren't in `defender-variants.json` can be evaluated"). | **Item 05** | Static sections (types, BST, board control, RNG) work for *any* legal set — they need only dex data. Only the matchup section degrades. |
| **Defensive-item matching fidelity.** A pasted set holding Leftovers, Sitrus Berry, etc. currently buckets to a no-item/aggregate variant, because defensive items don't get their own variants yet. | **Item 04** (defensive item variants) | Match on species + mega flag, then offensive item if a variant for it exists, else the species' aggregate variant. The "approximated as …" badge (Phase 6) makes the mismatch visible. |
| **Metagame baseline comparison** ("you have 3 speed-control options; the metagame average is 2.1"). A true baseline needs team-level composition data; Pikalytics gives per-Pokémon usage, not full teams. A variant-usage-weighted expectation is computable today but answers a different question ("what does an average *slot* carry"), and would be misleading labeled as a team average. | No single item — needs either scraped team data or a corpus of item-05 custom teams | Omit. Section headers show raw tallies only. Leave the tally data structures pure (tag table in, tallies out) so a baseline column can be added without rework. |

When item 05 lands, the intended upgrade path for the matchup section is:
compute `variantCid(parsedSet)` (the cid pipeline already accepts arbitrary
sets via `canonicalSpec`), look up matchup rows keyed on cid, request
simulation for missing pairs, and drop the nearest-variant approximation.

## Format scope

Same as the prior projects: **Pokémon Champions, VGC doubles, Regulation M-B.**
The evaluator is static analysis, so doubles-specific interpretation shows up
only in the taxonomy (e.g. spread moves, redirection, Ally Switch matter; they
would be dead weight in a singles evaluator).

Champions caveats that shape this spec:

- The **authoritative dex is the vendored `@smogon/calc` generation 0** (see
  `lib/pokemon.ts`). It is *trimmed to the Champions roster* — verified during
  spec work: `Teleport`, `Heal Block`, `Splintered Stormshards` are absent
  among moves; `Serene Grace`, `Dazzling`, `Air Lock`, `Storm Drain`,
  `Well-Baked Body`, `Wonder Guard` are absent among abilities. The vendored
  `pokemon-showdown` Champions mod (`Dex.forFormat('gen9championsbssregmb')`)
  **inherits the full gen-9 dex**, so `exists` is true there even for content
  not in Champions. Consequence: *metadata comes from the Showdown mod;
  existence comes from the calc dex* (Phase 0).
- Spreads are **SP (0–32 per stat)**, not EVs. Showdown pastes carry EVs;
  convert with the existing `evsToSps` (`lib/pokemon.ts`), which matches the
  official damage-calc UI. Manual entry edits SP directly.
- Stats are level-independent; level in pastes is ignored.
- **Type-changing mechanics:** Phase 0 must verify whether any Reg M-B
  metagame Pokémon changes type via ability/item (Terapagos-style; the
  Champions dex may carry `???`-type placeholders — see the vendored-calc
  notes). If present, v1 evaluates the *base* typing and flags the Pokémon in
  the type matrix with a warning marker; do not attempt to model the
  transformation.

## Tech stack and data sources

- **No PokéAPI.** The backlog offered "PokéAPI or Showdown data"; decision:
  vendored Showdown/calc data only. PokéAPI has no Champions balance changes
  (Grav Apple 90 BP, Growth's type, SP semantics) and would disagree with the
  rest of the pipeline. Both vendored packages are already in the repo.
- **Build-time dex export.** The frontend currently ships no dex — it fetches
  prebuilt JSON + sqlite. Keep that architecture: a new script exports a
  trimmed dex (`data/evaluator-dex.json`) with exactly the fields the
  evaluator needs. Do **not** bundle `pokemon-showdown` into the browser (it
  is Node-oriented and huge).
- **Shared pure logic in `lib/evaluator/`** (imported by both Node test
  scripts and the React app, like `lib/analysis/` + `src/lib/matchupDb.ts`
  pair today — but here the logic is dex-driven and browser-safe, so one
  implementation serves both; no client-side mirror needed).
- **Matchup data** from `data/matchups.sqlite` via the existing sql.js loader
  (`src/lib/matchupDb.ts`) — the worst-matchups section reuses
  `weakestMatchups` / `weakMatchupFor` and the `WeakMatchupCard` /
  `ConditionSensitivity` components as-is.

## Repo structure (additions)

```
├── data/
│   └── evaluator-dex.json           # New: trimmed Champions dex for the browser
├── lib/
│   └── evaluator/
│       ├── dex.ts                   # EvaluatorDex types + load/validate helpers
│       ├── parse.ts                 # Showdown paste parser -> TeamSet[]
│       ├── typechart.ts             # defensive/offensive matrices, ability-aware
│       ├── bst.ts                   # relevant-BST computation
│       ├── tags.ts                  # board-control taxonomy (rules + curated tables)
│       ├── rng.ts                   # RNG exposure scan
│       └── match.ts                 # pasted set -> nearest defender-variant id
├── scripts/
│   ├── build-evaluator-dex.ts       # Showdown-mod metadata ∩ calc-dex existence
│   └── test-evaluator.ts            # unit tests (run in `npm test` + CI)
└── src/
    ├── pages/TeamEvaluatorPage.tsx
    └── components/evaluator/
        ├── TeamInput.tsx            # paste box + manual editor + roster chips
        ├── TypeMatrix.tsx           # the two heatmap grids
        ├── RelevantBst.tsx
        ├── BoardControlTable.tsx
        ├── RngExposure.tsx
        └── EvalSection.tsx          # collapsible section wrapper
```

## Phase 0: Evaluator dex export

`scripts/build-evaluator-dex.ts` produces `data/evaluator-dex.json`:

1. Open the Showdown Champions mod (`Dex.forFormat('gen9championsbssregmb')` —
   same format id as `lib/sim/engine.ts`) and the calc dex (`GEN` from
   `lib/pokemon.ts`).
2. **Species** (every species in the calc dex): name, types, base stats,
   abilities (the legal slots), `isMega` flag if derivable (mirror however
   `lib/variants.ts` marks megas).
3. **Moves** (every move in the calc dex): name, type, category, base power,
   accuracy (`true` → 101 sentinel or a `alwaysHits` boolean — pick one and
   document), priority, crit ratio, and the structured effect fields used by
   the tag rules: `selfSwitch`, `forceSwitch`, `sideCondition`,
   `pseudoWeather`, `weather`, `terrain`, `volatileStatus`, `status`,
   `boosts`, `secondaries` (chance + status/volatileStatus/boosts), and the
   flags needed downstream (`contact` is not needed; `protect` is not needed;
   include `charge`, `recharge`, and `ohko` if the mod exposes them —
   otherwise curate OHKO moves, the list already exists in `lib/moves.ts`).
4. **Abilities** (every ability in the calc dex): name only — ability
   *semantics* live in the curated tables (`lib/evaluator/tags.ts`,
   `lib/evaluator/typechart.ts`), not in the dex export.
5. **Natures**: name, plus/minus stat.
6. **Validation & size**: fail the build if any species in
   `data/defender-variants.json` is missing from the export. Log the export's
   entry counts and gzipped size; expect well under 500 KB. Fetch it like the
   other JSON artifacts.

Where the Showdown mod and the calc dex disagree on existence, the calc dex
wins (it is what the damage pipeline and variant builder use). Log every move
or ability that a curated table references but the calc dex lacks — **drop
with a build warning, never hard-fail** — so a Champions dex-gap doesn't brick
the build, but silent taxonomy rot is impossible. Known drops as of spec time
are listed in "Format scope" above; re-verify at implementation time, and
record surprising ones (e.g. if `Serene Grace` is a dex gap rather than a true
Champions absence) in `DECISIONS.md`.

**Test cases to verify correctness (Phase 0):**
- Every species in `defender-variants.json` resolves in the export.
- `Rock Slide` carries accuracy 90, secondary `{chance: 30, flinch}`; `Icy
  Wind` carries a 100%-chance `spe: -1` secondary; `U-turn` has `selfSwitch`;
  `Tailwind` has `sideCondition`; `Trick Room` has `pseudoWeather`.
- `Grav Apple` base power is 90 (Champions balance change, the canary used in
  damage-viz Phase 0).
- No dropped-entry warnings other than the expected known list.

## Phase 1: Team input

### Parsing

`lib/evaluator/parse.ts`: a hand-rolled parser for Showdown export format
returning `TeamSet[]`. The format is line-oriented and small (name/species +
item line, `Ability:`, `EVs:`/`IVs:`, `X Nature`, `- Move`); do not import
`pokemon-showdown`'s `Teams` into the browser. **Parity test:** in Node,
`scripts/test-evaluator.ts` runs both our parser and `Teams.import()` from the
vendored package over the same fixture pastes and asserts field-level
agreement (species, item, ability, nature, EVs, moves) — the vendored parser
is the semantics oracle, ours is the shippable implementation.

```typescript
interface TeamSet {
  species: string;          // dex-validated
  item: string | null;
  ability: string;
  nature: string;
  sps: StatsTable;          // converted from pasted EVs via evsToSps
  moves: string[];          // 1–4, dex-validated
  warnings: string[];       // per-set validation notes, shown in the roster UI
}
```

Validation is *lenient*: unknown species is a hard error for that set; an
unknown move/item/ability produces a warning and the entry is kept out of the
computed sections but shown struck-through in the roster. Nicknames, genders,
shiny flags, levels, happiness are accepted and discarded. Team size 1–6
accepted; a note appears when fewer than 4 sets are present ("evaluation
assumes a full bring-4"; the backlog's input contract is 4–6).

### Manual entry & editing

The roster is always editable in place — parsing a paste populates the same
editor state the manual path uses (species combobox from the dex, item/ability/
nature dropdowns, SP inputs, four move comboboxes filtered to the species'
learnset if the Showdown mod exposes one for Champions; otherwise unfiltered
with dex validation). Every edit re-runs the evaluation synchronously — all
sections are pure functions of `TeamSet[]`, so "re-evaluate on the fly" (the
backlog's first open question) falls out of the architecture; there is no
explicit re-evaluate button.

### Persistence & sharing

Serialize `TeamSet[]` (compact JSON → base64url) into a `?team=` query param,
mirroring the team builder's URL-state pattern. A 6-set team is ~600–900
chars — fine for URLs. Also mirror to `localStorage` so an accidental
navigation doesn't eat a hand-built team; on load, query param wins over
localStorage.

**Test cases to verify correctness (Phase 1):**
- Round-trip: parse(export(team)) == team for a 6-set fixture.
- Parity with `Teams.import()` on ≥5 fixture pastes including: EVs line with
  4 HP special case (→ SP 1), no-item set, nicknamed set, set with fewer than
  4 moves.
- A paste with one unknown species yields 5 valid sets + 1 error entry, and
  the URL round-trip preserves all 6 (errors re-derived, not serialized).

## Phase 2: Type matchup matrix

`lib/evaluator/typechart.ts`.

### Decision: ability-modified is the primary view

The displayed multiplier is the **effective** one — raw type chart composed
with the set's *actual* ability (only the pasted ability; a Levitate-capable
species running a different ability gets no Ground immunity). Cells whose
effective value differs from the raw chart get a marker (dot in the corner)
and a tooltip showing `raw × ability → effective`. A toggle switches the grid
to raw values; both are computed in one pass, so the toggle is free. Rationale:
the effective chart is what play decisions are made on, but hiding the raw
chart entirely would mask "this immunity is one Mold Breaker/ability-suppression
away from gone."

### Defensive matrix

Rows = the attacking types present in the Champions dex (enumerate from the
dex export — do not hardcode 18; Champions may lack types or include `???`).
Columns = team members. Cell = effective multiplier of a single-typed attack
of that row's type into that member (dual defensive typing multiplied, then
the ability modifier applied), bucketed exactly as the backlog specifies:

`4×` extremely effective · `2×` super effective · `1×` neutral · `0.5×`
resist · `0.25×` highly resist · `0×` immune. Intermediate values produced by
abilities (e.g. Thick Fat's 0.5 on a neutral hit; Fluffy's 2× Fire on a
neutral hit) bucket to the nearest listed bucket for color, with the exact
multiplier in the cell tooltip. A per-row summary column tallies the team
(e.g. Ground: 2 weak / 1 immune / 3 neutral).

### The ability table (type interactions) — pinned

Curated in `typechart.ts`, validated against the calc dex at build/test time
(drop-with-warning policy as in Phase 0). This is the **complete v1 list**;
additions require a DECISIONS.md entry:

| Ability | Effect on incoming type |
|---|---|
| Levitate | Ground → 0× |
| Flash Fire | Fire → 0× |
| Water Absorb, Dry Skin*, Storm Drain† | Water → 0× |
| Volt Absorb, Lightning Rod†, Motor Drive | Electric → 0× |
| Sap Sipper | Grass → 0× |
| Earth Eater | Ground → 0× |
| Well-Baked Body† | Fire → 0× |
| Wind Rider | wind moves → 0× (move-flag based, not a type; include only if the dex export exposes the `wind` flag — otherwise defer with a code comment) |
| Thick Fat | Fire, Ice → ×0.5 |
| Heatproof | Fire → ×0.5 |
| Water Bubble | Fire → ×0.5 |
| Purifying Salt | Ghost → ×0.5 |
| Fluffy | Fire → ×2 (the contact-move halving is not type-based; note in tooltip only) |
| Dry Skin* | Fire → ×1.25 |
| Wonder Guard† | everything not super-effective → 0× |

\* Dry Skin appears twice (Water immunity, Fire vulnerability).
† Verified absent from the Champions calc dex at spec time — expected to be
dropped by validation; kept in the table so nothing needs re-research if the
dex gap closes.

Out of scope for v1 (document in the page's footnote): item-based modifiers
(Air Balloon, Ring Target), Tera/type-changing mechanics, ability suppression
(Mold Breaker), and weather-conditional immunities.

### Offensive matrix

Rows = defending types (same enumeration). Columns = team members. Cell = the
**best** effectiveness among that member's *damaging* moves (category ≠
Status) against a single-typed defender of the row's type, using each move's
type from the dex. Attacker-side ability effects are out of scope for v1
except **Scrappy** (Normal/Fighting hit Ghost at 1×) — it is cheap, curated in
the same table structure, and common enough to matter. Note in the UI that
real defenders are dual-typed; this grid shows per-type reach, not field
coverage (field coverage is what the matchup section measures).

**Test cases to verify correctness (Phase 2):**
- Garchomp (Dragon/Ground): Ice → 4×, Electric → 0×, Fire → 0.5×.
- Rotom-Wash with Levitate: Ground → 0× effective, 1× raw, cell marked.
- Thick Fat member: Fire and Ice cells marked, e.g. Ice 2× → 1× on a
  Snorlax-like neutral base.
- Offensive: a member with Earthquake + Ice Beam shows Ground-row… (careful:
  offensive matrix rows are *defending* types) — Steel-row cell 2× (from
  Earthquake), Flying-row cell 2× via Ice Beam, 0× nowhere unless its only
  hits are Normal/Fighting vs Ghost row without Scrappy.
- A member whose only damaging move is Ghost-type: Normal row shows 0×.

## Phase 3: Total relevant BST

`lib/evaluator/bst.ts`. Per member, sum base stats **excluding** stats the set
demonstrably doesn't use; show the per-stat breakdown with excluded stats
struck through, per-member totals, and the team total.

Exclusion rules (locked; anything subtler is a flagged note, not an exclusion):

- **Atk** excluded if the set has zero physical damaging moves. Physical
  moves that don't use the user's Atk stat — **Body Press** (uses Def) and
  **Foul Play** (uses target's Atk) — do *not* count as "using Atk"; a set
  whose only physical moves are those still excludes Atk (and Body Press adds
  a note that Def is doing double duty).
- **SpA** excluded if zero special damaging moves.
- **HP, Def, SpD** always included — every Pokémon takes hits.
- **Spe** always included, but **flagged** (not excluded) when the team has a
  Trick Room setter (a member whose moves include Trick Room): "Speed value is
  ambiguous under Trick Room." Per the backlog: probably include but flag.
  The flag is team-level, on the total, plus a marker on the slowest members.

Sanity guard: fixed-damage-only sets (Seismic Toss) count as having no
physical *scaling* moves — reuse the `basePower > 0` classification logic from
`lib/moves.ts` rather than re-inventing it.

**Test cases to verify correctness (Phase 3):**
- A special attacker with 4 special moves: Atk struck, total = BST − base Atk.
- A Body-Press-only "physical" set: Atk still struck, Def note present.
- Team with a Trick Room setter: team total flagged; no stat excluded by it.

## Phase 4: Board control inventory

`lib/evaluator/tags.ts`. Output: `Map<Category, Map<memberIndex, Tag[]>>`
rendered as the backlog's table — rows = categories, columns = members, cells
list what each member contributes (move names / ability names). Empty rows
still render (an empty "Speed control" row *is* the finding).

### Design: derive from metadata where possible, curate the rest

Each category is defined by a **rule** over the exported move fields plus a
**curated supplement** (mostly abilities, whose effects aren't in the data).
Rules keep the taxonomy from rotting as the dex shifts; the curated tables are
validated with the same drop-and-warn policy. The taxonomy below is the
**complete v1 enumeration** (the backlog's prework item); changes require a
DECISIONS.md entry.

**1. Speed control**
- Rule: damaging moves with `priority > 0`; status moves with `priority > 0`
  that affect the opponent are out of scope (none matter here). Moves whose
  `secondaries`/`boosts` lower the target's `spe` (Icy Wind, Electroweb,
  Bulldoze, Rock Tomb, …) — derived, 100%-chance secondaries only (Bulldoze
  qualifies; a 10% Bubble Beam does not). `sideCondition: 'tailwind'`.
  `pseudoWeather: 'trickroom'`. `status: 'par'` moves (Thunder Wave, Glare;
  Nuzzle arrives via its 100% secondary).
- Curated abilities: Prankster, Gale Wings, Quick Draw, Unburden (annotation
  "conditional"), Chlorophyll / Swift Swim / Sand Rush / Slush Rush (each
  annotated with the weather it needs, and cross-linked: shown dimmed unless
  the team also has the matching weather setter), Surge Surfer (Electric
  Terrain), Quark Drive / Protosynthesis ("conditional").
- Display sub-groups: priority · speed drops · Tailwind · Trick Room ·
  paralysis · abilities.

**2. Weather control**
- Rule: moves with a `weather` field (Sunny Day, Rain Dance, Sandstorm,
  Snowscape, plus Chilly Reception if in dex).
- Curated abilities — setters: Drought, Drizzle, Sand Stream, Snow Warning,
  Orichalcum Pulse ("sun + Atk boost" annotation); neutralizers: Cloud Nine,
  Air Lock (dex-gap expected; drop-warn).
- Mega-evolution weather quirk: if `lib/variants.ts` / sim work established
  that Champions megas with weather abilities auto-set on mega (Charizard Y),
  tag the *mega forme's* ability — the parser must resolve mega formes the
  same way the variant builder does.

**3. Terrain control**
- Rule: moves with a `terrain` field. Terrain *removal*: Ice Spinner, Steel
  Roller (curated — removal isn't a structured field). Splintered Stormshards
  is not in Champions (verified); do not carry it.
- Curated abilities: Grassy/Electric/Psychic/Misty Surge; Seed Sower
  ("conditional" annotation).

**4. Targeting control**
- Rule: `volatileStatus: 'followme'`-class moves (Follow Me, Rage Powder).
- Curated: Fake Out (flinch pressure — also appears under speed control via
  priority; double-listing is correct, the categories answer different
  questions), Ally Switch. Redirection *immunity* annotations: members whose
  ability (Stalwart, Propeller Tail) or moves (Snipe Shot) ignore redirection,
  and Grass-types' immunity to Rage Powder (derived from typing) — rendered as
  a second line in the cell ("ignores redirection: …").

**5. Damage mitigation**
- Rule: `sideCondition` ∈ {reflect, lightscreen, auroraveil, wideguard,
  quickguard}. Moves with 100%-chance offensive-stat drops on the target:
  `atk`/`spa` drops via `boosts` or 100% secondaries (Charm, Feather Dance,
  Eerie Impulse, Snarl via its 100% SpA-drop secondary, Lunge, Breaking
  Swipe). `status: 'brn'` moves (Will-O-Wisp; Scald/Lava Plume's 30% burns do
  **not** qualify — those live in RNG exposure). Self defensive boosts ≥ +2 or
  cumulative defensive-boost moves (Iron Defense, Cotton Guard, Acid Armor,
  Amnesia — derived from self `boosts` on def/spd ≥ +2). Protect-class:
  `volatileStatus` ∈ {protect, banefulbunker, burningbulwark, silktrap,
  spikyshield, kingsshield, obstruct} plus Detect — derived where the field
  exists, curated fallback list otherwise.
- Curated abilities: Intimidate, Friend Guard, Multiscale, Fur Coat, Ice
  Scales, Fluffy ("contact only"), Armor Tail-class *isn't* mitigation (it's
  option control, below).
- Display sub-groups: screens · guards · Protect-class · stat drops · burn ·
  self-boosts · abilities. (Protect on nearly every set is expected — the
  sub-group keeps it from drowning the interesting rows.)

**6. Pivoting**
- Rule: damaging or status moves with `selfSwitch` (U-turn, Volt Switch, Flip
  Turn, Parting Shot, Baton Pass, Teleport†, Chilly Reception, Shed Tail);
  `forceSwitch` moves (Roar, Whirlwind, Dragon Tail, Circle Throw). †Teleport
  verified absent from Champions dex — expect the drop warning.
- Curated abilities: Regenerator (annotation "rewards pivoting"), Emergency
  Exit / Wimp Out ("involuntary").

**7. Option control** (denying the opponent choices)
- Curated abilities: Armor Tail, Dazzling†, Queenly Majesty (block priority);
  Sweet Veil, Vital Spirit, Insomnia (block sleep); Aroma Veil (blocks
  Taunt/Encore/Disable-class); Oblivious ("Taunt-immune + attract"); Own
  Tempo, Inner Focus, Scrappy (Intimidate-immune — annotation); Good as Gold
  (status-move immunity); Magic Bounce.
- Rule-derived moves: Encore, Disable, Taunt, Torment, Imprison, Heal Block†
  (volatileStatus-based where exposed, curated fallback); Wide Guard / Quick
  Guard (double-listed with damage mitigation — they deny *spread/priority
  options* and mitigate; both readings are useful); terrain double-listing:
  Electric/Misty Terrain rows in *terrain control* get an "also blocks
  sleep/status (grounded)" annotation rather than a duplicate row here.
- †Expected dex-gap drops.

**Test cases to verify correctness (Phase 4):**
- A fixture team (write it as a Showdown paste in the test file) containing
  Tailwind + Fake Out + Icy Wind + Follow Me + U-turn + Will-O-Wisp + Encore
  produces exactly the expected cell contents per category (golden-object
  assertion, not snapshot — failures must read clearly).
- Fake Out appears in both speed control and targeting control.
- A team with Chlorophyll but no sun setter renders the ability dimmed with
  the "needs sun" annotation; adding Drought to another member un-dims it.
- Every move/ability name in every curated table resolves in the calc dex or
  is on the expected-drop list (this is the taxonomy-rot gate, run in CI).

## Phase 5: RNG exposure

`lib/evaluator/rng.ts`.

### Decision: tallies + per-interaction expected values; no team-level scalar

Locked approach: the section reports **counts per bucket and an itemized
list**, each item annotated with its per-use probability, derived from move
metadata. No aggregate "RNG score" — summing a flinch chance, a miss chance,
and a crit rate into one number has no defensible semantics, and the backlog's
stated user need ("I'm running four sub-100-accuracy moves") is served by
tallies. If a scalar is ever wanted, it goes through a DECISIONS.md entry.

**Favorable RNG** (variance the team can *exploit*):
- Enhanced crit: moves with `critRatio > 1` (derived); Focus Energy
  (`volatileStatus`); abilities Super Luck, Sniper ("crit payoff"), Merciless
  ("vs poisoned"); items Scope Lens, Razor Claw (curated item table — validate
  against the calc *items* dex).
- Wanted secondaries: damaging moves with `secondaries` whose chance is in
  (0, 100) — flinch, burn, para, poison, freeze, stat drops (Rock Slide 30%
  flinch, Heat Wave 10% burn, Sludge Bomb 30% poison, Air Slash, Iron Head…).
  Derived entirely from metadata; list shows `move — chance% effect`.
  Serene Grace (curated; expected dex-gap drop) doubles listed chances when
  present.
- Sleep moves: status-inflicting moves with `status: 'slp'` and accuracy < 101
  (Spore at 100 still counts — the *duration* is RNG; annotate "1–3 turn
  sleep").

**Unfavorable RNG** (variance the team must *survive*):
- Accuracy: damaging or status moves with numeric accuracy < 100 —
  `move — acc%`, sub-grouped <80 / 80–89 / 90–99. No Guard and moves with
  `accuracy: true` are exempt (annotate No Guard's two-way nature: it also
  makes *incoming* moves sure-hit — listed as a note, not a tally).
- Crash/recoil-on-miss: High Jump Kick-class (`hasCrashDamage` if exported,
  else curated).
- OHKO moves: reuse the `lib/moves.ts` OHKO list; annotate "30%+ acc".
- Self-inflicted variance: confusion moves (Outrage-class `volatileStatus:
  'lockedmove'`), full-para/infatuation exposure is out of scope (opponent-
  dependent, not a property of the team sheet).
- Sheer Force (curated): listed as *removing* the member's own secondary-
  effect RNG (its wanted-secondary entries render struck-through with a
  "Sheer Force: traded for power" note).

**Test cases to verify correctness (Phase 5):**
- Rock Slide set: appears in favorable (30% flinch) *and* unfavorable
  (90 acc, 90–99 bucket).
- Hurricane: unfavorable <80 bucket at 70; its 30% confusion in favorable.
- A No Guard member with Dynamic Punch: no accuracy entry, note rendered.
- A team with zero favorable entries renders the explicit "no proactive RNG
  upside" callout (the backlog's example insight — make it a real UI state,
  not an empty table).

## Phase 6: Worst matchups

Reuse, don't rebuild: the section calls `weakestMatchups(db, coreIds,
condition, weights)` from `src/lib/matchupDb.ts` with `coreIds` = the matched
variant ids of the team (up to 6 — the function has no core-size cap; only the
team-builder *UI* capped at 4), renders with `WeakMatchupCard`, and includes
the `ConditionSensitivity` chart and a condition selector, exactly as the
team-builder page does. Extract shared rendering into
`src/components/evaluator/`-adjacent modules only if the reuse demands it —
prefer importing the existing components untouched.

### Variant matching (`lib/evaluator/match.ts`)

Maps a `TeamSet` to a `defender-variants.json` id, best-effort:

1. Filter variants by species (and mega forme, resolved as in Phase 4's
   weather note).
2. Among those, exact item match wins.
3. Else, the species' aggregate/no-item variant if one exists (this is where
   defensive items land until **item 04**).
4. Else — no variant for the species at all — the member is **unmatched**.

Each matched member renders an "approximated as *{variant label}*" badge when
the match is inexact (different item, or any difference in moves/spread —
compare via `canonicalSpec` against the variant's resolved set; the cid
machinery from item 02 makes this a one-call check). Unmatched members are
listed above the section: "not in the metagame variant set — matchup analysis
requires custom-set simulation (backlog item 05)." The section header shows
"based on N of M team members" when N < M.

**This section is the one that upgrades when item 05 lands** — see "Deferred
elements." Keep `match.ts` interface-compatible with a future
`resolveOrSimulate(set): Promise<MatchupSource>`.

**Test cases to verify correctness (Phase 6):**
- A pasted Garchomp @ Life Orb with the modal moves matches
  `garchomp_life_orb` with no badge (if moves/spread match the variant's
  resolved set) or with the badge (if they differ) — assert both fixtures.
- A pasted Garchomp @ Leftovers falls to the aggregate variant with a badge.
- A species absent from `defender-variants.json` yields unmatched + the
  item-05 note, and `weakestMatchups` is called without it.

## Phase 7: Page assembly

- Route `/team-evaluator`, nav link alongside the existing pages.
- Team roster (chips + editor) **fixed at the top** (sticky), sections stacked
  below in the order: Worst matchups · Type matchups · Board control ·
  RNG exposure · Relevant BST. Each section is collapsible
  (`EvalSection.tsx`; collapsed state in component state, not the URL — the
  URL carries the team and condition only). All sections except worst
  matchups render synchronously from `TeamSet[]` + `evaluator-dex.json`; the
  matchup section shows the existing sqlite-loading state.
- Heatmap cells follow the existing dataviz conventions on the site (the
  Heatmap component and its palette) — extend, don't fork, unless the bucket
  legend genuinely doesn't fit, and note it in DECISIONS.md if so.
- Empty state: no team yet → a short explainer with a "paste a team" box and
  an example-team button (use the Phase 4 fixture team).

## Non-goals / known v1 limitations

Document these in the README and as page footnotes where visible:

1. **Nearest-variant matchup approximation** (and its item-04/05 upgrades) —
   see "Deferred elements."
2. **No metagame baseline column** — see "Deferred elements."
3. **Static analysis only.** Board control and RNG tallies count *options*,
   not their in-game value; a Trick Room on a fast team tallies the same as on
   a dedicated TR team. The matchup section is where interaction quality
   lives.
4. **Type matrix is mono-type per axis.** Real defenders are dual-typed;
   spelled out in the offensive-matrix note.
5. **No item effects** beyond RNG items and variant matching (no Air Balloon
   in the type chart, no Covert Cloak "blocks secondaries against you" — the
   latter is a nice v2 row for option control).
6. **No ability suppression / Mold Breaker / Tera-style type changes.**
7. **Champions dex gaps** may silently thin curated tables — mitigated by the
   drop-warnings in CI, not eliminated.

## Implementation order

1. **Phase 0** (dex export) — everything else consumes it.
2. **Phase 1** (parsing + input) — the page's spine; ship the page with just
   the roster editor working.
3. **Phase 2** (type matrix) — highest value-to-effort static section.
4. **Phase 4** (board control) — the big curated-table lift; doing it before
   RNG lets the tag-rule helpers stabilize.
5. **Phase 5** (RNG exposure) — reuses Phase 4's rule helpers.
6. **Phase 3** (relevant BST) — small, independent.
7. **Phase 6** (worst matchups) — reuse of existing components; needs
   `match.ts`.
8. **Phase 7** (assembly polish, collapsible layout, URL/localStorage).

Commit per phase (house rule); Phases 2–6 are naturally reviewable PRs if
split — at minimum split "input + dex" / "static sections" / "matchup section."

## Test cases to verify correctness (suite-level)

`scripts/test-evaluator.ts`, added to `npm test` and as a CI step (fast, pure;
no simulation). Beyond the per-phase cases above:

- **Taxonomy-rot gate:** every curated move/ability/item name resolves in the
  calc dex or is on the expected-drop list; the expected-drop list itself is
  asserted (an entry *appearing* in the dex should fail the test too, so the
  list gets pruned when dex gaps close).
- **Fixture team end-to-end:** one golden test parsing the example team and
  asserting the full evaluation object (all five sections) — the regression
  net for refactors.
- **Typecheck** already covers both tsconfigs; the new page must compile under
  `tsconfig.web.json` (guards against accidentally importing
  `pokemon-showdown` or Node APIs into `lib/evaluator/`).

## Notes for the implementer

- `lib/evaluator/` must stay browser-safe: no Node imports, no
  `pokemon-showdown`, no `@smogon/calc` (the dex export carries everything
  needed). The only allowed cross-import from existing lib code is types and
  pure helpers that are themselves browser-safe (`evsToSps` qualifies; check
  before importing anything from `lib/pokemon.ts`, which imports
  `@smogon/calc` at module top — if that's a problem, lift `evToSp` into a
  shared pure module rather than duplicating it).
- Double-listing across categories (Fake Out, Wide Guard) is intentional;
  implement tags as independent per-category rules over the same move data,
  not a partition.
- Curated tables are data (`const` arrays of `{name, annotation}`), not
  conditionals — the validation gate and any future baseline column both want
  to iterate them.
- When the Showdown mod exposes a structured field this spec says to derive
  from, prefer the field over a curated list even if the list is short —
  curation is for *semantics the data lacks*, and every curated entry is a
  future maintenance obligation.
- Record every deviation from this spec, and the resolution of the Phase 0
  type-changing-Pokémon verification, in `DECISIONS.md`.

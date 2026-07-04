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

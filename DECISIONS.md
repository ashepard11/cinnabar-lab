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

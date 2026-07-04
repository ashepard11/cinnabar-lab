# Pokémon Champions VGC Analytics — Project Handoff

## What this repository will contain

Two sequential projects, both operating on the current Pokémon Champions VGC metagame (Regulation M-B doubles):

1. **Damage Visualizations** (`SPEC-damageviz.md`) — two charts showing where damage comes from in the metagame and where the field is weakest. Small project, ~1–2 days of Fable time. Builds the shared scraper, variant selector, and Pokémon construction helpers used by project 2.

2. **Battle Simulator + Analysis** (`SPEC-sim.md`) — 1v1 battle simulator driving Pokémon Showdown's sim engine, matchup matrix across the metagame, and team-building analysis on top. Larger project, ~1 week of Fable time. Depends on project 1's data outputs.

Both specs are self-contained and include phase-by-phase implementation guidance, test cases, and known limitations.

## Implementation order

**Sequential.** Fable finishes and commits the damage-viz project (project 1) before starting the sim project (project 2). This isn't just about dependencies — the damage viz is a fast feedback loop that validates the scraper and variant selection logic before those become foundations for a much larger project.

## Running this with Claude Fable 5

### Setup

1. **Create a GitHub repo** for the project (empty, `main` branch). Clone it locally.
2. **Update Claude Code** to v2.1.170 or later: `claude update`. Fable 5 doesn't appear in the model picker on older versions.
3. **Copy the three spec files** (`README.md`, `SPEC-damageviz.md`, `SPEC-sim.md`) into the repo root and commit them.
4. **Add a `CLAUDE.md`** at the repo root with the following contents (adjust as needed):

   ```markdown
   # Project instructions

   This repo contains two sequential projects. Start with SPEC-damageviz.md. When it is complete, tested, and committed with a green build, move on to SPEC-sim.md.

   Working style:
   - Commit after each phase. Meaningful commit messages.
   - When a phase completes, verify the "Test cases to verify correctness" section for that phase before moving on.
   - If you get stuck or need to make a design decision the spec doesn't cover, document the decision in a `DECISIONS.md` file with your reasoning.
   - Prefer small, focused PRs when the work is naturally decomposable.
   - Do not modify SPEC-*.md files without explicit user approval.
   ```

5. **Decide on the permission model.** Three options:
   - **Auto mode (recommended).** Fable runs without prompting for most actions; a classifier reviews each action before it runs and blocks dangerous ones. No sandbox required. Best default for long autonomous coding.
   - **Dev container + `--dangerously-skip-permissions`.** Anthropic's reference dev container with firewall-restricted network access. Stronger isolation. Use if you want extra caution.
   - **claude-pod (community docker wrapper).** Small unofficial Docker sandbox mounting only the project folder. Middle ground.

### Launching Fable

**Interactive (recommended for first-time users):**

```bash
cd ~/projects/pokemon-champions-viz
claude --model fable
# in-session:
/output-style proactive
# Then paste in this exact prompt:
```

Prompt to hand Fable:

> Read `README.md`, `SPEC-damageviz.md`, and `SPEC-sim.md`. Then implement the damage visualization project (`SPEC-damageviz.md`) end to end, following its phases in order. Commit after each phase. Run the sanity-check test cases before declaring the project complete. When it is complete and green, stop and message me — do not start the sim project yet.

Then walk away. Come back in a few hours, review the commits, run the visualizations locally, and if everything looks good, start a fresh session:

```bash
claude --model fable
# in-session:
```

> The damage viz project is complete. Now implement the battle simulator project (`SPEC-sim.md`) end to end. Follow the same commit-per-phase pattern. When Phase 1 (move-selection policy) begins, write a design doc justifying your choice before implementing.

**Headless (fully unattended):**

```bash
claude --model fable -p "$(cat << 'EOF'
Read README.md, SPEC-damageviz.md, and SPEC-sim.md. Implement the damage viz project first, following its phases in order. Commit after each phase. Run sanity checks before declaring complete. When the damage viz project is done and all its tests pass, proceed immediately to the sim project. Same discipline. Do not stop between projects unless a phase fails.
EOF
)" --output-format stream-json > run.log 2>&1 &
```

### Cost expectations

- Fable is $10/$50 per million input/output tokens (2× Opus 4.8 pricing).
- On subscriptions (Pro/Max/Team): Fable draws from the same 5-hour and weekly limits as other models but consumes them ~2× as fast.
- Realistic total cost for both projects: **$50–$200** in API credits, depending on how many blind alleys Fable goes down. Cap at ~$300 by killing the session if it burns past that.

### What Fable is (and isn't) good at

Based on Anthropic's guidance:
- **Good at:** long-horizon coding, multi-file refactors, root-cause debugging, architecture decisions, sustained autonomous sessions
- **Less useful for:** simple edits, quick answers (Sonnet or Opus is more cost-effective)
- **Will do without prompting:** verify its own work, plan before implementing, catch design holes

For this project specifically:
- The damage viz project is on the small side for Fable — Sonnet 4.6 would probably also handle it. Consider Sonnet for the damage viz and Fable for the sim if you want to save cost.
- The sim project is squarely in Fable territory — long-running, ambiguous design decisions (policy choice), multi-file architecture, needs sanity-checking against Pokémon-mechanics ground truth.

### Watch-outs

- **Automatic model fallback.** Fable's safety classifiers can bounce requests in cybersecurity/biology domains, causing silent fallback to Opus. Nothing in this project should trigger this, but if you see the model switch, that's why.
- **Context management.** Very long sessions can lose early context. If Fable seems to forget the spec halfway through the sim project, break the work into more sessions rather than one giant run.
- **Data retention.** Fable requires 30-day data retention for its safety classifiers (Anthropic keeps prompts/outputs for 30 days). Not usable under Zero Data Retention.

## Human-in-the-loop moments

Fable can run autonomously for most of both projects, but three moments benefit from human review:

1. **End of damage viz Phase 0.** Confirm `@smogon/calc` is producing sensible Champions damage numbers before the whole pipeline gets built on top of it.
2. **Start of sim Phase 1.** Fable proposes the move-selection policy. Read the design doc, push back if the choice seems wrong. This is the single decision most likely to make the final output wrong.
3. **After sim Phase 3.** Sanity-check the 5 well-known matchups (Zard Y vs Incineroar, Kingambit vs Amoonguss, etc.) before letting the full matrix build run for an hour.

Everything else Fable can drive on its own.

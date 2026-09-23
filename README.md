# sc2-astra-jev

A StarCraft II Protoss bot with a two-speed brain:

- **Astra** (`openai/gpt-6-astra`, system 2) writes the plan once per engagement: intent, target, rally, and for every squad a role, objective, focus priority, and plain-language `engageWhen` / `retreatWhen` conditions.
- **Jev** (`typesafe-ai/jev`, system 1) runs every squad and key unit about twice a second of game time (every 11 game loops). Each call is one `experimental_evaluate` with the squad's local state and typed questions (`engage`, `retreat`, `focus`, plus `blinkBack` / `forcefield` / `guardianShield` where they apply). The answers are probabilities, and thresholds turn them into a stance.
- A scripted layer does the per-frame work: kiting on weapon cooldown, focus fire on the weakest target of the chosen type, blinking out damaged stalkers, placing force fields. It also plays the full macro game: a 2-gate robo expand into blink stalkers, sentries, and immortals.

Everything is TypeScript. The game client is a thin protobuf-over-websocket implementation of Blizzard's s2client protocol (`proto/` is vendored from `Blizzard/s2client-proto`).

## Setup

```sh
pnpm install
echo "AI_GATEWAY_API_KEY=..." > .env
pnpm maps            # installs the 2019 Season 3 ladder pack into /Applications/StarCraft II/Maps
```

## Run

```sh
pnpm play                                   # vs random Medium AI on Acropolis, Astra + Jev
pnpm play --difficulty VeryHard --race zerg
pnpm play --no-llm                          # scripted baseline, same macro and micro, no models
pnpm play --realtime                        # game runs at real speed, Jev calls never block
pnpm play --no-camera                       # leave the camera where you put it
pnpm smoke                                  # 800 loops, no models: checks the protocol layer
pnpm probe:jev && pnpm probe:astra          # one canned call to each model
```

By default the game is stepped: the loop waits for in-flight Jev calls before advancing, so decisions happen at a fixed game-time rate no matter how slow the network is. Astra never blocks the loop. Squads fight on a scripted default plan until Astra's plan arrives (about 20–30s wall time).

The camera follows the action: the biggest fight first, then the latest build / warp-in / blink / force field, otherwise the army. Each shot holds about 3 game seconds unless a fight outranks it.

A live decision panel opens in your browser at `http://127.0.0.1:8765` (`--no-panel` to skip, `--panel-port` to move it). Every squad gets a card: Astra's orders for it (objective, engage-when, retreat-when, focus order, which plan they came from) right above Jev's current verdict (stance, probability bars against the thresholds, focus target). Beside it are Astra's plan and plan history, a filterable feed of every decision (Jev calls tagged with the plan they judged against, Astra plans, mode changes, builds / warp-ins / spells), and live cost plus rejected-order counts. `?static` renders one snapshot without the live stream.

The game window keeps only map markers: a label over each squad, a line from each squad to its Astra target in its Jev stance color, and spheres on Astra's target and rally.

## Output

- `logs/game-*.jsonl`: every Astra plan (trigger, latency, full plan), every Jev call (state, answers, resulting stance, latency), mode changes, status snapshots every minute, and a final summary.
- `replays/*.SC2Replay`: the replay of every game.

## Layout

```
src/sc2/       launcher, protobuf connection, client, ids
src/state/     map context (expansions, grids), per-tick world, enemy memory
src/macro/     build order, economy, placement, production
src/army/      squads, commander (engagement triggers -> Astra)
src/brain/     astra.ts, jev.ts, decisions.ts, tactician.ts (Jev scheduling), summary.ts
src/micro/     per-frame behaviors, command dedupe
src/hud/       in-game debug overlay
```

# agent-toolbelt

Claude Code mods (function-hooks plugins), one per folder under `plugins/`, each with its own `CLAUDE.md`. README `## Developing` has the run, validate and test commands.

## Conventions

- Commit straight to `main`; this is a personal repo with no branches or PRs.
- Each mod is self-contained: an install copies only its folder, so code is shared by copying, never by importing across `plugins/`.
- Design specs and plans live in `docs/superpowers/`, which is gitignored. They name paths on the author's machine.
- The author's configs load mods straight from this checkout (`CLAUDE_CODE_PLUGIN_DIRS`), so every commit on `main` must load: run `claude plugin validate` and `claude plugin test` on each mod you touch.
- A new mod also gets a `plugins` entry in `.claude-plugin/marketplace.json`, a README section and a line in the README's `## Install` block.

## Engine gotchas

Each of these has broken a mod here before. The API's own types are the authority: load the `plugin-authoring` skill for the current types path.

- **`$` only reaches top-level functions.** The engine's static scan refuses a module that passes `$` into a closure declared inside `register`. Declare such helpers at module top level. Keep per-load state in an object created in `register` and pass it in (model-router's `router`, subagent-pane's `Poll`).
- **Timers are handles.** `$.clock.every` and `$.clock.after` return a `Timer`; stop one with `timer.cancel()`.
- **Tool inputs are flat.** On `tool.call`, the tool's parameters sit directly on `e` (`e.file_path`, `e.isolation`); there is no `e.input`.
- **Gating hooks pass through on failure.** Give `tool.call` and `agent.spawn` hooks `.catch(($, e, next) => next(e))`. `next` is replay-safe there, so the engine's answer stands and nothing runs twice.
- **Types come from loading.** The engine writes `.claude-plugin/types/` and `tsconfig.json` (both gitignored) when it loads a mod. Before that, type-check with a scratch tsconfig that includes the skill's `claude-code.d.ts`. `tsc` catches API-shape mistakes the test kit lets through.

## Tests (`claude-code/testing`)

- **No state reads.** The test `$` has no `state` noun, so assert through what a hook draws: `$.ui.mount(...)`, then `find({ key })`.
- **Test hooks can't call `$`.** A test's own hooks stand for the engine. To make something happen mid-call (a spawn during an Agent call), hold the hook on a promise and act from the test body.
- **Noun calls answer `{ value }`.** A test hook answers a noun call (`agent.list`, `ui.open`, `session.usage`) with `{ value: ... }`, and an event (`agent.spawn`, `turn.step`) with its result directly.
- **Clock and store are mocked.** `mock.clock(on, { now })` holds every timer until the test calls `advance` or `settle`; `mock.store` and `mock.env` stand in for the store and the environment.

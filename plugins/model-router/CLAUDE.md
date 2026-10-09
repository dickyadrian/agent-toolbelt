# model-router

Phase 1 of a router: it measures and routes nothing. It tags each prompt `trivial` / `normal` / `hard`, logs every turn's cost, and `/model-router report` answers whether routing trivial prompts to a cheaper model would pay off. The README marks it as in testing: the log format and the report may still change.

## Behaviour that is deliberate

- **Never blocks a turn.** Classification starts at `turn.start` and runs in the background. Jev (`typesafe-ai/jev` through Vercel AI Gateway) gets 5s; on any failure the built-in classifier (`$.model.classify`, Haiku) takes over, and `jevError` records why. Only the first failure of a session raises a toast.
- **Classifier input.** The classifier sees the prompt (first 1000 characters) plus the end of the previous reply (last 500), so a bare "yes, do it" is judged by the work it approves.
- **Log files.** Each turn is written to its own file, deferred with `$.clock.after(0, ...)` so the write never sits on the turn's path. Subagent runs get their own records, tied to the main turn they ran under.
- **Weighted tokens.** They use the API's price ratios (output 5x, cache write 1.25x, cache read 0.1x) as a proxy for quota.
- **Phase 2 gate.** Phase 2 is gated by `READY` in `hooks/report.ts` (300 prompts, 50 trivial, 7 days) and by trivial prompts taking at least 15% of weighted tokens.

## Gotchas

- **One log folder for every config.** Logs go to `$HOME/.claude/model-router/turns/`, hardcoded, not under `CLAUDE_CONFIG_DIR`, so a session under another config dir writes into the same folder.
- **Configuration is env only.** It's read from the env (`MODEL_ROUTER_JEV_KEY`, `MODEL_ROUTER_JEV`, `MODEL_ROUTER_JEV_ZERO_RETENTION`). `switchOf` accepts on/off, true/false, 1/0 and yes/no.
- **Prompt text leaves the machine.** It goes to Jev and is kept in the logs (first 500 characters). That's documented in the README; keep it that way when changing what's sent or stored.

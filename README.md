# agent-toolbelt

Mods for [Claude Code](https://claude.com/claude-code), published as a plugin marketplace. Each mod lives in its own folder under `plugins/` and installs on its own.

## Install

Install every mod:

```
/plugin install usage-bar --marketplace dickyadrian/agent-toolbelt
/plugin install model-router --marketplace dickyadrian/agent-toolbelt
/plugin install subagent-pane --marketplace dickyadrian/agent-toolbelt
```

The first command asks to add the marketplace: answer `y`. Each install then asks for a scope. To pick only some mods, run just their lines. Each mod's section below has its own command too.

## Mods

### usage-bar

Shows your subscription usage above the prompt, so you don't have to run `/usage` or open the website.

```
5h ███████░░░░░░░  48%  resets 3:40pm    7d █████████████░  92%  resets Mon 9am
```

- One row when the terminal is wide enough for both windows, one row per window when it isn't. The band never grows wider than it needs to.
- Bars turn yellow at 70% and red at 90%.
- Once a window's reset time has passed, it shows 0% until the next reply brings fresh numbers.
- `/usage-bar` hides or shows the band. Your choice is remembered across sessions.
- Optional account badge, for when you run more than one Claude Code config. Set it per config in the `env` block of that config's `settings.json`:

  ```json
  "env": {
    "USAGE_BAR_BADGE": "work",
    "USAGE_BAR_BADGE_COLOR": "warning"
  }
  ```

  `USAGE_BAR_BADGE` is the label, cut to 12 characters. No label means no badge. `USAGE_BAR_BADGE_COLOR` is a theme color name (`claude`, `suggestion`, `success`, `warning`, `error`, `planMode`, ...) or `#rrggbb`. Anything else falls back to `claude`.

The numbers come from Claude's API responses, so the band appears after the first reply of a session. It only shows on a Claude subscription. With an API key there are no usage windows to show.

Install:

```
/plugin install usage-bar --marketplace dickyadrian/agent-toolbelt
```

Answer `y` to add the marketplace, then pick a scope.

### model-router

> [!WARNING]
> Still in testing. It only measures for now, and its classifier, its log format and the report can change between versions without a migration. Use it to collect data, not to make routing decisions yet.

Phase 1 of a model router: it measures, it doesn't route. Nothing changes which model answers. It answers one question: how much of your quota goes to prompts a cheaper model could have handled?

- Every prompt you send is tagged `trivial`, `normal` or `hard` in the background, so the turn never waits for it. The classifier sees the prompt (first 1000 characters) and the end of the previous reply (last 500), so a "yes, do it" is judged by the work it approves.
- Every turn is written to `~/.claude/model-router/turns/<session>/<turn>.json`: the prompt (first 500 characters), its tag, the 5h/7d quota before and after, and each model request's model, effort and token counts. Subagent runs get their own file, with their agent type and the main turn they ran under.
- The classifier is TypeSafe's Jev (`typesafe-ai/jev`), a decision model, through Vercel AI Gateway. It answers one choice question over the three tiers and gives the probability of each, which goes in the record. Without Jev, Claude Code's built-in classifier (Haiku) tags prompts instead.
- Jev never holds up a turn. If it fails (error status, an answer that isn't a tier, no answer within 5 seconds), the built-in classifier takes over, the record says why in `jevError`, and the first failure of a session shows a toast.

Configure Jev in the `env` block of `settings.json`:

```json
"env": {
  "MODEL_ROUTER_JEV_KEY": "<your AI Gateway key>",
  "MODEL_ROUTER_JEV": "on",
  "MODEL_ROUTER_JEV_ZERO_RETENTION": "off"
}
```

- `MODEL_ROUTER_JEV_KEY`: an AI Gateway API key (`vercel ai-gateway api-keys create`). Jev is used only when it's set.
- `MODEL_ROUTER_JEV`: `on` (the default) or `off`. Turns Jev off without removing the key.
- `MODEL_ROUTER_JEV_ZERO_RETENTION`: `on` or `off` (the default). On, every request requires zero data retention. If the gateway can't guarantee it, the request fails and the built-in classifier tags the prompt; the toast and `jevError` say so. The record's `zeroRetention` field says which way each prompt was sent.

Values `true`/`false`, `1`/`0` and `yes`/`no` work too. With Jev off, every prompt goes to the built-in classifier, which counts toward your Claude usage.

Prompt text is sent to the classifier and kept in the log files. Don't use it in sessions where that's not okay.

`/model-router report` reads every log file and shows:

- prompts, weighted tokens and 5h/7d quota points by tier. Weighted tokens count output 5x, cache writes 1.25x and cache reads 0.1x, as the API prices them. A subagent run's tokens count toward the prompt that started it.
- which classifier tagged the prompts, and the most common reasons Jev failed
- how sure Jev was about the prompts it tagged trivial, in probability bands
- whether there's enough data for phase 2 yet (300 prompts, 50 of them trivial, 7 days), and whether trivial prompts take enough of your tokens (15% or more) to be worth routing
- ten prompts tagged trivial, picked at random, for you to check by hand

Install:

```
/plugin install model-router --marketplace dickyadrian/agent-toolbelt
```

### subagent-pane

A side pane that lists your subagents and what each one runs on, so you can check that the model you asked for is the one doing the work.

```
Subagents · 2 running
● refactor auth module              12m
  opus-5-5 · high · ctx 142k
  bg · worktree · @auth
● migrate test fixtures              4m
  sonnet-4-5 · medium · ctx 61k · bg

Recent
✓ find callers of parseToken     done 1m
  haiku-4-5 · low · ctx 22k
```

- One row per subagent, foreground and background: its task, how long it has run, its model, its effort, and how big its context is right now (the input tokens of its last request).
- Badges show only when they apply: `bg` (runs in the background), `worktree` (its own git worktree), `cwd <dir>` (a different directory), `@name` (the name SendMessage reaches it by).
- Finished agents move to `Recent`, dimmed. The last 10 are kept.
- The agent whose transcript you have open is marked with `▶`.
- The pane opens by itself on the first subagent of a session. In fullscreen it docks beside the transcript. On a narrow terminal, it waits until there's room. `/subagents-pane` shows or hides it. Once you close it, it stays closed until the next session or `/clear`.

Install:

```
/plugin install subagent-pane --marketplace dickyadrian/agent-toolbelt
```

## Developing

Run a mod from this checkout with hot reload:

```
claude --plugin-dir ./plugins/usage-bar
```

Check it:

```
claude plugin validate ./plugins/usage-bar
claude plugin test ./plugins/usage-bar
```

### Adding a mod

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and the hooks module.
2. Add an entry to `plugins` in `.claude-plugin/marketplace.json`.
3. Add a section to this README.

Each mod has to be self-contained. An install copies only that mod's folder, so a mod can't import code from another mod or from a shared folder.

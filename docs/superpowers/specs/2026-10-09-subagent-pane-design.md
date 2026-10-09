# subagent-pane - design

Date: 2026-10-09
Status: approved in chat, pending spec review

## Problem

Claude Code doesn't show which model a subagent runs on. The user sets the model in prompts and has no way to see whether it took effect. This hurts most with long-running (often background) subagents, which the user follows from the background-tasks list under the prompt. That list can't be hooked by a mod.

## Goal

A side pane listing this session's subagents, each with its model, effort, live context size and run-mode badges, so the user can see at a glance what every running agent runs on.

## Non-goals

- Changing which model a subagent uses. A rule like "Explore uses haiku" is a possible follow-up mod.
- Showing where the model came from (param / agent definition / inherited). The user doesn't want it.
- Annotating the `Agent` row in the transcript.
- Repeating what the engine already shows: tool-use count, total tokens, the current tool.

## What the user sees

The pane `Subagents`, id `subagent-pane`:

```
Subagents · 2 running
● refactor auth module              12m
  opus-4.7 · high · ctx 142k
  bg · worktree · @auth
● migrate test fixtures              4m
  sonnet-4.5 · medium · ctx 61k · bg
✓ find callers of parseToken     done 1m
  haiku-4.5 · low · ctx 22k
```

- **Header:** `Subagents · N running`. With no running agents: `Subagents`.
- **Row line 1:** status mark, description, elapsed time, right-aligned.
  - Marks: `●` running (accent color), `◌` pending / waiting / idle (dim), `✓` completed (success color), `✗` failed (error color), `■` killed (dim).
  - Elapsed: `45s`, `12m`, `1h 05m`. Running agents count up. Finished agents show `done <elapsed>`, frozen at the finish time.
- **Row line 2+:** the facts, joined with ` · `, wrapped to `bodyColumns`, in this order:
  1. model: the resolved model id, shortened (`claude-` prefix and date suffix dropped, so `claude-opus-4-7-20260101` becomes `opus-4-7`; `[1m]` kept as ` 1m`). `?` until known.
  2. effort: `low` / `medium` / `high` / `xhigh` / `max`, or `effort <n>` for a numeric budget. Omitted when the model reports none.
  3. ctx: `ctx 142k`, the input side of the agent's last response. Omitted before its first response.
  4. badges, each only when it applies: `bg` (runs in background), `worktree` (`isolation: "worktree"`), `cwd <basename>` (a custom cwd), `@<name>` (its SendMessage name).
- **Finished agents** are drawn dim, below the running ones, newest first. At most 10 are kept.
- **Agent in view:** when the transcript beside the pane shows one agent's conversation (`e.props.view.agentId`), that agent's row is drawn bold with a `▶` before the mark.
- **Width:** if the description doesn't fit next to the elapsed time, it's cut with `…`. The facts wrap onto further lines, never mid-fact.
- **Order:** running first, by start time, oldest first. Then finished, newest first.

**Empty states.** The pane can stay open after the work is done, so there are two:

- Nothing running, but finished agents are kept: the running section is replaced by a dim line, and the finished rows follow under `Recent`:

  ```
  Subagents
  No subagents running.

  Recent
  ✓ find callers of parseToken     done 1m
    haiku-4.5 · low · ctx 22k
  ```

- No agents at all (the pane opened with `/subagents-pane` before any spawn, or after a `/clear`):

  ```
  Subagents
  No subagents yet.
  /subagents-pane to close
  ```

Whenever something runs, the finished rows also sit under a `Recent` heading, below the running ones.

Teammates and workflow agents show as well. They are agents the session lists, and they get the same row.

## Opening

- The pane opens on its own (`$.ui.open`) the first time a subagent is spawned in a session. If the terminal is too narrow, the engine holds the pane until it fits (144 columns, or 110 per `$.ui.open`'s doc) and shows it then. The mod doesn't work around that.
- Auto-open happens once per session (`/clear` counts as a new one). If the user closes the pane, a later spawn doesn't reopen it.
- `/subagents-pane` toggles it: it closes the pane if open (`$.ui.panes()` lists it), and opens it otherwise. The command answers `Subagents pane opened.` / `Subagents pane closed.`

## Data

One record per agent, keyed by agent id, held in `$.state` (`subagent-pane.agents`), so the pane redraws on each write and a hot reload keeps it.

```ts
type AgentRow = {
  id: string
  description: string
  type: string              // subagentType
  status: AgentStatus       // engine's: pending | running | waiting | idle | completed | failed | killed
  model?: string            // full id; shortened only when drawn
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number
  contextTokens?: number
  isBackground: boolean
  isWorktree: boolean
  cwd?: string
  name?: string
  startedAt: number         // $.clock.now() ms
  endedAt?: number
}
```

Where each field comes from:

| Field | Source |
|---|---|
| id, model | `agent.spawn`: `const r = await next(e)`. `r.agentId` and `r.model` (resolved). A `{ deny }` result, or one without `agentId`, records nothing. |
| description, type, isBackground, cwd, name | `agent.spawn` input |
| isWorktree | `tool.call` for `Agent`: `input.isolation === 'worktree'`, kept by `tool_use_id` until `agent.spawn` (same `tool_use_id`) picks it up |
| model (later), effort, contextTokens | `turn.step` with `agentId` set: `e.model`, `e.effort`. From the result `usage`: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. |
| status | set to `running` on spawn and on every `turn.step` of the agent. Reconciled from `$.agent.list()` by a poll. |
| endedAt | stamped when the status first turns `completed`, `failed` or `killed`. Cleared if the agent resumes. |

**Poll:** `$.clock.every(2000)` runs while any recorded agent isn't finished. Each tick reads `$.agent.list()`, updates statuses, and writes the state. That write also keeps the elapsed times current. With nothing running, the poll stops. The next spawn starts it again.

**Pruning:** after each write, only the 10 newest finished rows are kept.

**`/clear`:** `$.session.usage().startedAt` moves to the moment of the `/clear`. On every spawn and every poll tick, rows whose `startedAt` is older than that are dropped. The auto-open marker (`subagent-pane.autoOpenedAt`, a timestamp) counts as unset when it's older too, so the first spawn after a `/clear` opens the pane again.

## Structure

`plugins/subagent-pane/`, laid out like `plugins/usage-bar/`:

```
.claude-plugin/plugin.json   name, version, description, "types": "./types/index.d.ts"
hooks/hooks.json             { "modules": ["./register.tsx"] }
hooks/register.tsx           hooks: session.start, command.run, tool.call, agent.spawn, turn.step, ui.render (Pane); the poll
hooks/rows.ts                pure: AgentRow updates (spawn, step, list reconcile, prune, sort)
hooks/format.ts              pure: shortModel, formatElapsed, formatTokens, facts(row), layoutRow(row, columns) -> lines
types/index.d.ts             AgentRow and PluginState['subagent-pane'] (agents, autoOpenedAt)
tests/format.test.ts         formatting and wrapping
tests/rows.test.ts           state transitions
tests/register.test.tsx      mounted pane: spawn -> step -> list says completed; toggle command; view highlight
tsconfig.json                as usage-bar's
```

Also, in this repo: a `plugins` entry in `.claude-plugin/marketplace.json` and a `### subagent-pane` section in `README.md`.

Outside the repo, once the mod validates and its tests pass: append `:/Users/dickyadrian/Documents/claude-mod/plugins/subagent-pane` to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, the same way usage-bar and model-router are loaded. Nothing else in that file changes.

## Errors

- Every hook on the engine's path (`tool.call`, `agent.spawn`, `turn.step`) calls `next` first or forwards its result untouched, and records afterwards. A recording failure is caught (`.catch` returns `next`'s answer), so the mod never blocks or changes a spawn, a tool call or a request.
- A `turn.step` for an agent id with no row (a workflow agent the spawn hook missed, a reload mid-run) creates the row from `$.agent.list()` if the list names it, and is ignored otherwise.
- If `$.agent.list()` fails during a poll, the tick is skipped.
- The render hook draws from state only. Both empty states (see What the user sees) come from that state too, never from a failed read.

## Testing

- Unit tests (`claude plugin test`) for `format.ts` and `rows.ts`: model shortening, elapsed and token formatting, wrapping at narrow widths, ordering, pruning, status transitions, resume clearing `endedAt`.
- One mounted-pane test on the terminal surface: spawn an agent, step it, complete it through a mocked list, and assert the text of the row at each stage. Also: the toggle command, the `▶` highlight for `view.agentId`, and both empty states (no agents yet; all finished, with `Recent` below).
- `claude plugin validate` and `tsc -p` must pass.
- Manual: `claude --plugin-dir ./plugins/subagent-pane` in fullscreen. Launch one background and one foreground agent with different models, and check the rows.

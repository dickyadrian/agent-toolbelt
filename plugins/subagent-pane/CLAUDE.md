# subagent-pane

Docked `Subagents` pane: one row per subagent with model, effort, live context and badges. Pure logic in `hooks/rows.ts` (state transitions) and `hooks/format.ts` (text and layout); `hooks/register.tsx` wires the hooks.

## How a row's facts arrive

- **Spawn:** `agent.spawn` creates the row from `await next(e)`, which gives the agent id and resolved model.
- **Worktree:** comes from the Agent `tool.call`'s `isolation`. The spawn input lacks it, so ids are matched by `tool_use_id`.
- **Requests:** `turn.step` marks the row running *before* `next` (so a resumed agent leaves `Recent` at once). After `next` it takes `usage.model`, the model that answered, which a routing hook may have changed from `e.model`, plus the context tokens.
- **Status:** a 2s poll of `$.agent.list()` sets it, and runs only while some row is active.
- **The list is unreliable at both ends:**
  - It lags a spawn, so a row it never named is left alone.
  - It drops agents when they end, so a row it named once (`wasListed`) and no longer names is finished.
  - It never names workflow agents; those end through `turn.complete`.
- **`/clear`** arrives as `session.end` with `reason: 'clear'`, and no `session.start` follows. Rows and `autoOpenedAt` are reset there.

## Behaviour that is deliberate

- The pane auto-opens once per session, on the first spawn. If the person closes it, it stays closed until `/clear` or a new session; `/subagents-pane` toggles it.
- An auto-opened pane waits undrawn below 144 columns; the engine decides this, not the mod.
- The engine's own tasks list under the prompt can't be hidden: it has no render site. The `subagentStatusLine` setting can rewrite its rows' text.

## Known gaps

Accepted at review, not yet fixed:

- **Header wording:** the header counts pending, waiting and idle agents as "running".
- **New engine statuses:** `AgentRowStatus` copies the engine's `AgentStatus`, and `MARKS[status]` has no fallback. A status added by a later engine version throws at render, and the pane closes.
- **Badges:** they read the Agent call's flags only. An agent definition's `isolation` or `background` doesn't show.
- **Widths:** counted in UTF-16 units, so CJK text and emoji overflow a row.
- **Resumed agents:** elapsed time counts from the original spawn.

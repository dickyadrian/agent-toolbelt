# subagent-pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that docks a `Subagents` pane listing every subagent of the session with its model, effort, live context size and run-mode badges.

**Architecture:** Hooks on `agent.spawn`, `tool.call` (Agent), `turn.step` and `turn.complete` record one `AgentRow` per agent into `$.state`. A 2s `$.clock.every` poll of `$.agent.list()` keeps statuses and elapsed times current while anything runs. A `ui.render` hook on the `Pane` draws from that state. Pure logic lives in `hooks/rows.ts` (state transitions) and `hooks/format.ts` (text and layout), so it can be tested without a session.

**Tech Stack:** Claude Code function hooks (plugin API 2.1.295), TypeScript/TSX compiled against `h`, `claude plugin test` / `claude plugin validate`.

**Spec:** `docs/superpowers/specs/2026-10-09-subagent-pane-design.md`

## Global Constraints

- Plugin name `subagent-pane`. Pane id `subagent-pane`, pane title `Subagents`. Command `/subagents-pane` (registered name `subagents-pane`).
- Command replies, verbatim: `Subagents pane opened.` / `Subagents pane closed.`
- Empty-state copy, verbatim: `No subagents yet.`, `/subagents-pane to close`, `No subagents running.`. Section heading `Recent`. Header `Subagents` or `Subagents · N running`.
- At most 10 finished agents are kept (`MAX_RECENT = 10`). Poll period 2000 ms.
- Never use the em dash character anywhere (code, copy, README, commits). Use `-`.
- The mod never blocks or changes a spawn, a tool call or a request: every engine-path hook forwards `next`'s answer untouched.
- Each mod is self-contained: no imports from other plugins' folders.
- `plugins/*/tsconfig.json` and `plugins/*/.claude-plugin/types/` are engine-written and gitignored. Don't create or edit them.
- Existing patterns to copy: `plugins/usage-bar/` (layout, `atom`/`read`/`update`, tests with a mocked engine), `plugins/model-router/` (`turn.step` generator hooks, `EngineInterface`).

## Review Focus

1. A pane narrower than a row's fixed parts (`bodyColumns` under ~10): the row must still draw, with no negative `repeat` and no throw. Pinned in Task 2 (`layoutRow` at 4 columns).
2. A fact wider than the pane (a long `cwd` basename or `@name`): it's cut with `…` on its own line, never split mid-fact. Pinned in Task 2 (`wrapFacts`).
3. An agent resumed after finishing (SendMessage to a completed agent): it goes back to the active section and loses its `endedAt`. Pinned in Task 1 (`withStep` and `withList` on a completed row).
4. An agent missing from `$.agent.list()` (the list lags right after a spawn): the row stays as it was, not dropped or finished. Pinned in Task 1 (`withList`).
5. More than 10 finished agents: the oldest finished drop, and active agents never drop. Pinned in Task 1 (`pruned`).

---

## File Structure

```
plugins/subagent-pane/
  .claude-plugin/plugin.json   manifest, names the contract
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/rows.ts                pure: AgentRow state transitions, pruning, ordering
  hooks/format.ts              pure: model/elapsed/token text, facts, row layout
  hooks/register.tsx           the hooks: recording, poll, auto-open, command, Pane render
  types/index.d.ts             AgentRow types + PluginState['subagent-pane']
  tests/rows.test.ts
  tests/format.test.ts
  tests/register.test.tsx
```

Repo files touched in Task 5: `.claude-plugin/marketplace.json`, `README.md`. Outside the repo: `~/.claude/settings.json` (one env value).

---

### Task 0: Branch and spec commit

- [ ] **Step 1: Create the branch**

```bash
cd /Users/dickyadrian/Documents/claude-mod
git switch -c feat/subagent-pane
```

The uncommitted model-router changes (`plugins/model-router/`, `.claude-plugin/marketplace.json`, `README.md`) come along on the branch. Don't stage them in this plan's commits. Task 5 says how to handle them.

- [ ] **Step 2: Commit the spec and this plan**

```bash
git add docs/superpowers/specs/2026-10-09-subagent-pane-design.md docs/superpowers/plans/2026-10-09-subagent-pane.md
git commit -m "docs: add subagent-pane design and plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Scaffold, contract and row state (`rows.ts`)

**Files:**
- Create: `plugins/subagent-pane/.claude-plugin/plugin.json`
- Create: `plugins/subagent-pane/hooks/hooks.json`
- Create: `plugins/subagent-pane/hooks/register.tsx` (empty register for now)
- Create: `plugins/subagent-pane/types/index.d.ts`
- Create: `plugins/subagent-pane/hooks/rows.ts`
- Test: `plugins/subagent-pane/tests/rows.test.ts`

**Interfaces:**
- Produces (types, `types/index.d.ts`): `AgentRowStatus`, `AgentEffort`, `AgentRow`, `AgentRows`, and `PluginState['subagent-pane'] = { agents: AgentRows; autoOpenedAt: number | null; now: number }`.
- Produces (`hooks/rows.ts`):
  - `MAX_RECENT = 10`
  - `isFinished(status: AgentRowStatus): boolean`
  - `type Step = { model: string; effort?: AgentEffort; contextTokens?: number }`
  - `withSpawn(rows: AgentRows, row: AgentRow): AgentRows`
  - `withStep(rows: AgentRows, id: string, step: Step): AgentRows`
  - `withList(rows: AgentRows, list: readonly AgentInfo[], now: number): AgentRows`
  - `withTurnEnd(rows: AgentRows, id: string, listed: AgentInfo | undefined, now: number): AgentRows`
  - `rowFromInfo(info: AgentInfo, now: number): AgentRow`
  - `pruned(rows: AgentRows, sessionStartedAt: number): AgentRows`
  - `ordered(rows: AgentRows): { active: AgentRow[]; recent: AgentRow[] }`
  - `hasActive(rows: AgentRows): boolean`

- [ ] **Step 1: Write the scaffold**

`plugins/subagent-pane/.claude-plugin/plugin.json`:

```json
{
  "name": "subagent-pane",
  "version": "0.1.0",
  "description": "A side pane listing each subagent with its model, effort, live context and run mode",
  "author": {
    "name": "Dicky Adrian"
  },
  "types": "./types/index.d.ts"
}
```

`plugins/subagent-pane/hooks/hooks.json`:

```json
{ "modules": ["./register.tsx"] }
```

`plugins/subagent-pane/hooks/register.tsx` (Task 3 replaces it):

```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

`plugins/subagent-pane/types/index.d.ts`:

```ts
/** Where an agent's loop stands, as `$.agent.list()` reports it. */
export type AgentRowStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** A request's reasoning effort: a level, or a numeric budget. */
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number

/** One subagent as the pane keeps it. */
export type AgentRow = {
  id: string
  description: string
  type: string
  status: AgentRowStatus
  /** The full model id; shortened only when drawn. */
  model?: string
  effort?: AgentEffort
  /** Input side of the agent's last response: uncached + cache read + cache write. */
  contextTokens?: number
  isBackground: boolean
  isWorktree: boolean
  cwd?: string
  name?: string
  /** `$.clock.now()` milliseconds. */
  startedAt: number
  /** Set while the status is completed, failed or killed. */
  endedAt?: number
}

/** The pane's rows, by agent id. */
export type AgentRows = Record<string, AgentRow>

declare module 'claude-code' {
  interface PluginState {
    'subagent-pane': { agents: AgentRows; autoOpenedAt: number | null; now: number }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`plugins/subagent-pane/tests/rows.test.ts`:

```ts
import type { AgentInfo } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, AgentRows, AgentRowStatus } from '../types'
import {
  hasActive,
  isFinished,
  MAX_RECENT,
  ordered,
  pruned,
  rowFromInfo,
  withList,
  withSpawn,
  withStep,
  withTurnEnd,
} from '../hooks/rows'

const row = (id: string, overrides: Partial<AgentRow> = {}): AgentRow => ({
  id,
  description: `task ${id}`,
  type: 'general-purpose',
  status: 'running',
  isBackground: false,
  isWorktree: false,
  startedAt: 1000,
  ...overrides,
})

const info = (id: string, status: AgentRowStatus, overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  description: `task ${id}`,
  type: 'general-purpose',
  status,
  ...overrides,
})

const rowsOf = (...list: AgentRow[]): AgentRows => Object.fromEntries(list.map(one => [one.id, one]))

describe('isFinished', () => {
  test('is true for the ended statuses only', () => {
    expect(isFinished('completed')).toBe(true)
    expect(isFinished('failed')).toBe(true)
    expect(isFinished('killed')).toBe(true)
    expect(isFinished('running')).toBe(false)
    expect(isFinished('waiting')).toBe(false)
    expect(isFinished('idle')).toBe(false)
    expect(isFinished('pending')).toBe(false)
  })
})

describe('withSpawn', () => {
  test('adds the row under its id', () => {
    expect(withSpawn({}, row('a'))).toEqual({ a: row('a') })
  })
})

describe('withStep', () => {
  test('takes the model, effort and context of the request', () => {
    const next = withStep(rowsOf(row('a')), 'a', { model: 'claude-opus-5-5', effort: 'high', contextTokens: 42_000 })
    expect(next.a).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', contextTokens: 42_000 })
  })

  test('keeps the effort and context it had when the request reports none', () => {
    const before = rowsOf(row('a', { effort: 'low', contextTokens: 10 }))
    expect(withStep(before, 'a', { model: 'm' }).a).toMatchObject({ effort: 'low', contextTokens: 10 })
  })

  test('brings a finished agent back to running', () => {
    const before = rowsOf(row('a', { status: 'completed', endedAt: 5000 }))
    const after = withStep(before, 'a', { model: 'm' }).a
    expect(after?.status).toBe('running')
    expect(after !== undefined && 'endedAt' in after).toBe(false)
  })

  test('leaves the rows alone for an unknown id', () => {
    const before = rowsOf(row('a'))
    expect(withStep(before, 'b', { model: 'm' })).toBe(before)
  })
})

describe('withList', () => {
  test('stamps the end time when an agent finishes', () => {
    expect(withList(rowsOf(row('a')), [info('a', 'completed')], 9000).a).toMatchObject({
      status: 'completed',
      endedAt: 9000,
    })
  })

  test('keeps the first end time on later polls', () => {
    const done = rowsOf(row('a', { status: 'completed', endedAt: 9000 }))
    expect(withList(done, [info('a', 'completed')], 15_000).a?.endedAt).toBe(9000)
  })

  test('clears the end time when a finished agent runs again', () => {
    const done = rowsOf(row('a', { status: 'completed', endedAt: 9000 }))
    const after = withList(done, [info('a', 'running')], 15_000).a
    expect(after?.status).toBe('running')
    expect(after !== undefined && 'endedAt' in after).toBe(false)
  })

  test('leaves an agent the list does not name as it was', () => {
    const before = rowsOf(row('a'))
    expect(withList(before, [], 9000).a).toEqual(row('a'))
  })
})

describe('withTurnEnd', () => {
  test('takes the status the list gives', () => {
    expect(withTurnEnd(rowsOf(row('a')), 'a', info('a', 'idle'), 9000).a?.status).toBe('idle')
  })

  test('marks the agent completed when the list does not name it', () => {
    expect(withTurnEnd(rowsOf(row('a')), 'a', undefined, 9000).a).toMatchObject({
      status: 'completed',
      endedAt: 9000,
    })
  })
})

describe('rowFromInfo', () => {
  test('builds a row from the list entry', () => {
    expect(rowFromInfo(info('a', 'running', { name: 'scout' }), 7000)).toEqual({
      id: 'a',
      description: 'task a',
      type: 'general-purpose',
      status: 'running',
      isBackground: false,
      isWorktree: false,
      name: 'scout',
      startedAt: 7000,
    })
  })
})

describe('pruned', () => {
  test('drops rows from before the session started (a /clear)', () => {
    const rows = rowsOf(row('old', { startedAt: 500 }), row('new', { startedAt: 2000 }))
    expect(Object.keys(pruned(rows, 1000))).toEqual(['new'])
  })

  test(`keeps the ${MAX_RECENT} newest finished and every active row`, () => {
    const finished = Array.from({ length: 12 }, (_, i) =>
      row(`f${i}`, { status: 'completed', startedAt: 1000, endedAt: 2000 + i }),
    )
    const active = Array.from({ length: 3 }, (_, i) => row(`r${i}`, { startedAt: 1000 }))
    const kept = pruned(rowsOf(...finished, ...active), 0)
    expect(Object.keys(kept).filter(id => id.startsWith('r')).length).toBe(3)
    expect(Object.keys(kept).filter(id => id.startsWith('f')).sort()).toEqual(
      ['f10', 'f11', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'],
    )
  })
})

describe('ordered', () => {
  test('lists active oldest first, then finished newest first', () => {
    const rows = rowsOf(
      row('late', { startedAt: 3000 }),
      row('early', { startedAt: 1000, status: 'waiting' }),
      row('doneOld', { status: 'failed', endedAt: 4000 }),
      row('doneNew', { status: 'completed', endedAt: 6000 }),
    )
    const { active, recent } = ordered(rows)
    expect(active.map(one => one.id)).toEqual(['early', 'late'])
    expect(recent.map(one => one.id)).toEqual(['doneNew', 'doneOld'])
  })
})

describe('hasActive', () => {
  test('is true while any agent is not finished', () => {
    expect(hasActive({})).toBe(false)
    expect(hasActive(rowsOf(row('a', { status: 'completed', endedAt: 1 })))).toBe(false)
    expect(hasActive(rowsOf(row('a', { status: 'idle' })))).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `claude plugin test ./plugins/subagent-pane`
Expected: FAIL, because `../hooks/rows` can't be resolved.

- [ ] **Step 4: Implement `rows.ts`**

`plugins/subagent-pane/hooks/rows.ts`:

```ts
import type { AgentInfo } from 'claude-code'

import type { AgentEffort, AgentRow, AgentRows, AgentRowStatus } from '../types'

/** How many finished agents the pane keeps. */
export const MAX_RECENT = 10

export const isFinished = (status: AgentRowStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'killed'

/** What one model request of an agent tells us. */
export type Step = { model: string; effort?: AgentEffort; contextTokens?: number }

/** Moves a row to `status`, stamping `endedAt` on the first finish and dropping it on a resume. */
const withStatus = (row: AgentRow, status: AgentRowStatus, now: number): AgentRow => {
  if (isFinished(status)) {
    return { ...row, status, endedAt: isFinished(row.status) && row.endedAt !== undefined ? row.endedAt : now }
  }
  const { endedAt: _ended, ...live } = row

  return { ...live, status }
}

export const withSpawn = (rows: AgentRows, row: AgentRow): AgentRows => ({ ...rows, [row.id]: row })

export const withStep = (rows: AgentRows, id: string, step: Step): AgentRows => {
  const row = rows[id]
  if (row === undefined) return rows
  const live = withStatus(row, 'running', 0)

  return {
    ...rows,
    [id]: {
      ...live,
      model: step.model,
      ...(step.effort === undefined ? {} : { effort: step.effort }),
      ...(step.contextTokens === undefined ? {} : { contextTokens: step.contextTokens }),
    },
  }
}

export const withList = (rows: AgentRows, list: readonly AgentInfo[], now: number): AgentRows => {
  const next = { ...rows }
  for (const agent of list) {
    const row = next[agent.id]
    if (row !== undefined) next[agent.id] = withStatus(row, agent.status, now)
  }

  return next
}

export const withTurnEnd = (
  rows: AgentRows,
  id: string,
  listed: AgentInfo | undefined,
  now: number,
): AgentRows => {
  const row = rows[id]
  if (row === undefined) return rows

  return { ...rows, [id]: withStatus(row, listed?.status ?? 'completed', now) }
}

/** A row for an agent the spawn hook never saw (a workflow agent, a reload mid-run). */
export const rowFromInfo = (info: AgentInfo, now: number): AgentRow => ({
  id: info.id,
  description: info.description,
  type: info.type,
  status: info.status,
  isBackground: false,
  isWorktree: false,
  ...(info.name === undefined ? {} : { name: info.name }),
  startedAt: now,
})

const endedOf = (row: AgentRow): number => row.endedAt ?? row.startedAt

export const ordered = (rows: AgentRows): { active: AgentRow[]; recent: AgentRow[] } => {
  const all = Object.values(rows)

  return {
    active: all.filter(row => !isFinished(row.status)).sort((a, b) => a.startedAt - b.startedAt),
    recent: all.filter(row => isFinished(row.status)).sort((a, b) => endedOf(b) - endedOf(a)),
  }
}

export const pruned = (rows: AgentRows, sessionStartedAt: number): AgentRows => {
  const kept: AgentRows = {}
  for (const [id, row] of Object.entries(rows)) {
    if (row.startedAt >= sessionStartedAt) kept[id] = row
  }
  const { active, recent } = ordered(kept)

  return Object.fromEntries([...active, ...recent.slice(0, MAX_RECENT)].map(row => [row.id, row]))
}

export const hasActive = (rows: AgentRows): boolean => Object.values(rows).some(row => !isFinished(row.status))
```

(`withStatus(row, 'running', 0)` in `withStep` never reads `now`, because `running` isn't a finished status.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `claude plugin test ./plugins/subagent-pane`
Expected: PASS, every `rows` test.

- [ ] **Step 6: Commit**

```bash
git add plugins/subagent-pane
git commit -m "feat(subagent-pane): add row state for the subagents pane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Text and layout (`format.ts`)

**Files:**
- Create: `plugins/subagent-pane/hooks/format.ts`
- Test: `plugins/subagent-pane/tests/format.test.ts`

**Interfaces:**
- Consumes: `AgentRow`, `AgentEffort`, `AgentRowStatus` (types), `isFinished` (rows.ts).
- Produces (`hooks/format.ts`):
  - `SEPARATOR = ' · '`, `FACT_INDENT = '  '`, `IN_VIEW = '▶ '`
  - `MARKS: Record<AgentRowStatus, { glyph: string; color?: string }>`
  - `shortModel(id: string): string`
  - `formatElapsed(ms: number): string`
  - `formatTokens(count: number): string`
  - `effortText(effort: AgentEffort): string`
  - `facts(row: AgentRow): string[]`
  - `truncate(text: string, width: number): string`
  - `wrapFacts(items: readonly string[], width: number): string[]`
  - `elapsedText(row: AgentRow, now: number): string`
  - `type RowLayout = { prefix: string; mark: string; markColor?: string; description: string; gap: string; elapsed: string; facts: string[] }`
  - `layoutRow(row: AgentRow, columns: number, now: number, isInView: boolean): RowLayout`
  - `headerText(active: number): string`

- [ ] **Step 1: Write the failing tests**

`plugins/subagent-pane/tests/format.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import {
  effortText,
  elapsedText,
  facts,
  formatElapsed,
  formatTokens,
  headerText,
  layoutRow,
  shortModel,
  truncate,
  wrapFacts,
} from '../hooks/format'

const MINUTE = 60_000

const row = (overrides: Partial<AgentRow> = {}): AgentRow => ({
  id: 'a',
  description: 'refactor auth module',
  type: 'general-purpose',
  status: 'running',
  isBackground: false,
  isWorktree: false,
  startedAt: 0,
  ...overrides,
})

describe('shortModel', () => {
  test('drops the claude- prefix and a date suffix', () => {
    expect(shortModel('claude-opus-5-5')).toBe('opus-5-5')
    expect(shortModel('claude-sonnet-4-5-20250929')).toBe('sonnet-4-5')
  })

  test('keeps the 1m context marker', () => {
    expect(shortModel('claude-opus-5-5[1m]')).toBe('opus-5-5 1m')
  })

  test('strips a Bedrock region and version', () => {
    expect(shortModel('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('haiku-4-5')
  })

  test('leaves an unknown id as it is', () => {
    expect(shortModel('gpt-x')).toBe('gpt-x')
  })
})

describe('formatElapsed', () => {
  test('counts seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(45_000)).toBe('45s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  test('counts minutes under an hour', () => {
    expect(formatElapsed(MINUTE)).toBe('1m')
    expect(formatElapsed(12 * MINUTE + 5000)).toBe('12m')
  })

  test('counts hours with padded minutes', () => {
    expect(formatElapsed(65 * MINUTE)).toBe('1h 05m')
  })

  test('never goes negative', () => {
    expect(formatElapsed(-5)).toBe('0s')
  })
})

describe('formatTokens', () => {
  test('shows small counts whole, thousands as k, millions as M', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(42_000)).toBe('42k')
    expect(formatTokens(141_600)).toBe('142k')
    expect(formatTokens(999_600)).toBe('1M')
    expect(formatTokens(1_240_000)).toBe('1.2M')
  })
})

describe('effortText', () => {
  test('shows a level as it is and a budget with a label', () => {
    expect(effortText('high')).toBe('high')
    expect(effortText(8000)).toBe('effort 8000')
  })
})

describe('facts', () => {
  test('lists model, effort, context and the badges that apply, in order', () => {
    const full = row({
      model: 'claude-opus-5-5',
      effort: 'high',
      contextTokens: 42_000,
      isBackground: true,
      isWorktree: true,
      cwd: '/repo/worktrees/auth/',
      name: 'auth',
    })
    expect(facts(full)).toEqual(['opus-5-5', 'high', 'ctx 42k', 'bg', 'worktree', 'cwd auth', '@auth'])
  })

  test('shows ? for a model not known yet, and nothing else', () => {
    expect(facts(row())).toEqual(['?'])
  })
})

describe('truncate', () => {
  test('cuts with an ellipsis only when the text is too long', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('abc', 3)).toBe('abc')
    expect(truncate('abc', 1)).toBe('…')
    expect(truncate('abc', 0)).toBe('')
  })
})

describe('wrapFacts', () => {
  test('joins facts on one line when they fit', () => {
    expect(wrapFacts(['opus-5-5', 'high', 'ctx 42k'], 40)).toEqual(['opus-5-5 · high · ctx 42k'])
  })

  test('wraps between facts, never inside one', () => {
    expect(wrapFacts(['opus-5-5', 'high', 'ctx 42k'], 20)).toEqual(['opus-5-5 · high', 'ctx 42k'])
  })

  test('cuts a fact wider than the line on a line of its own', () => {
    expect(wrapFacts(['bg', 'cwd a-very-long-directory-name'], 12)).toEqual(['bg', 'cwd a-very-…'])
  })
})

describe('elapsedText', () => {
  test('counts up while running and freezes once done', () => {
    expect(elapsedText(row({ startedAt: 1000 }), 46_000)).toBe('45s')
    expect(elapsedText(row({ startedAt: 1000, status: 'completed', endedAt: 61_000 }), 999_999)).toBe('done 1m')
  })
})

describe('layoutRow', () => {
  test('fills the width: mark, description, gap, elapsed', () => {
    const line = layoutRow(row({ model: 'claude-opus-5-5' }), 40, 12 * MINUTE, false)
    expect(line).toMatchObject({ prefix: '', mark: '●', markColor: 'claude', description: 'refactor auth module', elapsed: '12m' })
    // mark + space + description + gap + elapsed
    expect(1 + 1 + line.description.length + line.gap.length + line.elapsed.length).toBe(40)
    expect(line.facts).toEqual(['opus-5-5'])
  })

  test('cuts the description when the pane is narrow', () => {
    const line = layoutRow(row(), 12, 12 * MINUTE, false)
    expect(line.description).toBe('refac…')
    expect(line.gap).toBe(' ')
  })

  test('still lays out a row in a pane narrower than its fixed parts', () => {
    const line = layoutRow(row({ model: 'claude-opus-5-5' }), 4, 12 * MINUTE, false)
    expect(line.description).toBe('')
    expect(line.gap).toBe(' ')
    expect(line.facts).toEqual(['o…'])
  })

  test('marks the agent in view', () => {
    expect(layoutRow(row(), 40, 0, true).prefix).toBe('▶ ')
  })

  test('draws finished and waiting agents with their own marks', () => {
    expect(layoutRow(row({ status: 'completed', endedAt: 0 }), 40, 0, false)).toMatchObject({ mark: '✓', markColor: 'success' })
    expect(layoutRow(row({ status: 'failed', endedAt: 0 }), 40, 0, false)).toMatchObject({ mark: '✗', markColor: 'error' })
    expect(layoutRow(row({ status: 'waiting' }), 40, 0, false).markColor).toBeUndefined()
  })
})

describe('headerText', () => {
  test('counts the running agents', () => {
    expect(headerText(0)).toBe('Subagents')
    expect(headerText(2)).toBe('Subagents · 2 running')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test ./plugins/subagent-pane`
Expected: FAIL, because `../hooks/format` can't be resolved. (The `rows` tests still pass.)

- [ ] **Step 3: Implement `format.ts`**

`plugins/subagent-pane/hooks/format.ts`:

```ts
import type { AgentEffort, AgentRow, AgentRowStatus } from '../types'
import { isFinished } from './rows'

export const SEPARATOR = ' · '
export const FACT_INDENT = '  '
export const IN_VIEW = '▶ '

/** Each status's mark; one without a color is drawn dim. */
export const MARKS: Record<AgentRowStatus, { glyph: string; color?: string }> = {
  running: { glyph: '●', color: 'claude' },
  pending: { glyph: '◌' },
  waiting: { glyph: '◌' },
  idle: { glyph: '◌' },
  completed: { glyph: '✓', color: 'success' },
  failed: { glyph: '✗', color: 'error' },
  killed: { glyph: '■' },
}

/** `claude-opus-5-5-20260101` -> `opus-5-5`; Bedrock ids lose region and version; `[1m]` -> ` 1m`. */
export const shortModel = (id: string): string => {
  const isWide = id.endsWith('[1m]')
  const base = (isWide ? id.slice(0, -'[1m]'.length) : id)
    .replace(/^(?:[a-z]+\.)?anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')

  return isWide ? `${base} 1m` : base
}

export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export const formatTokens = (count: number): string => {
  if (count < 1000) return `${count}`
  const thousands = Math.round(count / 1000)
  if (thousands < 1000) return `${thousands}k`

  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export const effortText = (effort: AgentEffort): string =>
  typeof effort === 'number' ? `effort ${effort}` : effort

const basename = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')

  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || path
}

/** The facts line's items, in the order the pane draws them. */
export const facts = (row: AgentRow): string[] => {
  const items = [row.model === undefined ? '?' : shortModel(row.model)]
  if (row.effort !== undefined) items.push(effortText(row.effort))
  if (row.contextTokens !== undefined) items.push(`ctx ${formatTokens(row.contextTokens)}`)
  if (row.isBackground) items.push('bg')
  if (row.isWorktree) items.push('worktree')
  if (row.cwd !== undefined) items.push(`cwd ${basename(row.cwd)}`)
  if (row.name !== undefined) items.push(`@${row.name}`)

  return items
}

export const truncate = (text: string, width: number): string => {
  if (width <= 0) return ''
  if (text.length <= width) return text

  return `${text.slice(0, width - 1)}…`
}

/** Joins items with SEPARATOR into lines of at most `width`, breaking only between items. */
export const wrapFacts = (items: readonly string[], width: number): string[] => {
  const room = Math.max(1, width)
  const lines: string[] = []
  let line = ''
  for (const item of items.map(one => truncate(one, room))) {
    if (line === '') line = item
    else if (line.length + SEPARATOR.length + item.length <= room) line += SEPARATOR + item
    else {
      lines.push(line)
      line = item
    }
  }
  if (line !== '') lines.push(line)

  return lines
}

export const elapsedText = (row: AgentRow, now: number): string =>
  isFinished(row.status)
    ? `done ${formatElapsed((row.endedAt ?? now) - row.startedAt)}`
    : formatElapsed(now - row.startedAt)

/** One row's pieces: `prefix mark ' ' description gap elapsed`, then the facts lines. */
export type RowLayout = {
  prefix: string
  mark: string
  markColor?: string
  description: string
  gap: string
  elapsed: string
  facts: string[]
}

export const layoutRow = (row: AgentRow, columns: number, now: number, isInView: boolean): RowLayout => {
  const prefix = isInView ? IN_VIEW : ''
  const { glyph, color } = MARKS[row.status]
  const elapsed = elapsedText(row, now)
  // the space after the mark, and at least one before the elapsed time
  const description = truncate(row.description, columns - prefix.length - glyph.length - 2 - elapsed.length)
  const used = prefix.length + glyph.length + 1 + description.length + elapsed.length

  return {
    prefix,
    mark: glyph,
    ...(color === undefined ? {} : { markColor: color }),
    description,
    gap: ' '.repeat(Math.max(1, columns - used)),
    elapsed,
    facts: wrapFacts(facts(row), columns - FACT_INDENT.length),
  }
}

export const headerText = (active: number): string =>
  active === 0 ? 'Subagents' : `Subagents · ${active} running`
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test ./plugins/subagent-pane`
Expected: PASS, every `rows` and `format` test.

- [ ] **Step 5: Commit**

```bash
git add plugins/subagent-pane/hooks/format.ts plugins/subagent-pane/tests/format.test.ts
git commit -m "feat(subagent-pane): format subagent rows for the pane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Recording hooks and poll (`register.tsx`, without the pane)

**Files:**
- Modify: `plugins/subagent-pane/hooks/register.tsx` (replace the empty register)
- Test: `plugins/subagent-pane/tests/register.test.tsx`

**Interfaces:**
- Consumes: everything `rows.ts` produces. The state refs `{ plugin: 'subagent-pane', key: 'agents' | 'autoOpenedAt' | 'now' }`.
- Produces: rows in `$.state` (`agents`), `now` updated on every write, and the poll running exactly while `hasActive(agents)`. Task 4 adds the render, the command and auto-open to this same file.

- [ ] **Step 1: Write the failing tests**

`plugins/subagent-pane/tests/register.test.tsx`:

```tsx
import type { AgentInfo, AgentSpawnInput, On, UiPane } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { AgentRows } from '../types'

const NOW = new Date('2026-10-09T10:00:00Z').getTime()
const OPUS = 'claude-opus-5-5'

type World = {
  clock: MockClock
  agents: AgentInfo[]
  listCalls: number
  panes: UiPane[]
  opened: string[]
  closed: string[]
  startedAt: number
}

/** Stands in for the engine beneath the plugin. */
const engine = (on: On): World => {
  const world: World = {
    clock: mock.clock(on, { now: NOW }),
    agents: [],
    listCalls: 0,
    panes: [],
    opened: [],
    closed: [],
    startedAt: 0,
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: world.startedAt, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.list', () => {
    world.listCalls++

    return { value: world.agents }
  })
  on('agent.spawn', ($, e) =>
    e.tool_use_id === 'denied' ? { deny: 'not allowed' } : { model: OPUS, agentId: `a-${e.tool_use_id}` },
  )
  on('tool.call', { tool: 'Agent' }, async ($, e) => {
    await $.agent.spawn(spawnInput(e.tool_use_id ?? ''))

    return { deny: 'test engine runs no tool' }
  })
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: e.model,
        input_tokens: 2000,
        output_tokens: 300,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 0,
      },
    }
  })
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('ui.open', ($, e) => {
    world.opened.push(e.id)
    world.panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.close', ($, e) => {
    world.closed.push(e.id)
    world.panes = world.panes.filter(pane => pane.id !== e.id)

    return { value: undefined }
  })

  return world
}

const spawnInput = (toolUseId: string, overrides: Partial<AgentSpawnInput> = {}): AgentSpawnInput => ({
  tool_use_id: toolUseId,
  prompt: 'Do the work.',
  description: 'refactor auth module',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: OPUS,
  background: false,
  fork: false,
  ...overrides,
})

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const spawn = ($: Engine, toolUseId: string, overrides: Partial<AgentSpawnInput> = {}) =>
  $.agent.spawn(spawnInput(toolUseId, overrides))

const step = async ($: Engine, agentId: string, effort: 'low' | 'high' = 'high') => {
  const stream = $.turn.step({ turnId: `t-${agentId}`, index: 0, model: OPUS, effort, messageCount: 2, agentId })
  for (;;) if ((await stream.next()).done) return
}

const rowsOf = async ($: Engine): Promise<AgentRows> =>
  ((await $.state.get({ plugin: 'subagent-pane', key: 'agents' } as const)).value ?? {}) as AgentRows

const listed = (id: string, status: AgentInfo['status']): AgentInfo => ({
  id,
  description: 'refactor auth module',
  type: 'general-purpose',
  status,
})

describe('recording', () => {
  test('records a spawned agent with its resolved model and run mode', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1', { background: true, name: 'auth', cwd: '/repo/worktrees/auth' })

    expect((await rowsOf($))['a-tu1']).toMatchObject({
      description: 'refactor auth module',
      status: 'running',
      model: OPUS,
      isBackground: true,
      isWorktree: false,
      cwd: '/repo/worktrees/auth',
      name: 'auth',
      startedAt: NOW,
    })
  })

  test('records nothing for a denied spawn', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'denied')

    expect(await rowsOf($)).toEqual({})
  })

  test('flags worktree isolation from the Agent call', async ($, on) => {
    engine(on)
    await start($)
    await $.tool.call({
      tool: 'Agent',
      tool_use_id: 'tu2',
      input: { description: 'refactor auth module', prompt: 'Do the work.', subagent_type: 'general-purpose', isolation: 'worktree' },
    })

    expect((await rowsOf($))['a-tu2']?.isWorktree).toBe(true)
  })

  test("takes effort and context from the agent's requests", async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1')
    await step($, 'a-tu1', 'high')

    expect((await rowsOf($))['a-tu1']).toMatchObject({ effort: 'high', contextTokens: 42_000 })
  })

  test('ignores requests of loops it does not know and the list does not name', async ($, on) => {
    engine(on)
    await start($)
    await step($, 'compaction-fork')

    expect(await rowsOf($)).toEqual({})
  })

  test('adds an agent it missed when the list names it', async ($, on) => {
    const world = engine(on)
    await start($)
    world.agents = [listed('wf-1', 'running')]
    await step($, 'wf-1')

    expect((await rowsOf($))['wf-1']).toMatchObject({ status: 'running', model: OPUS, effort: 'high' })
  })

  test('marks an agent completed when its turn ends and the list lacks it', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1')
    await $.turn.complete({
      turnId: 't-a-tu1',
      agentId: 'a-tu1',
      answer: 'Done.',
      durationMs: 5,
      isAborted: false,
      reason: 'answer',
      usage: {
        model: OPUS,
        input_tokens: 2000,
        output_tokens: 300,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 0,
      },
    })

    expect((await rowsOf($))['a-tu1']).toMatchObject({ status: 'completed', endedAt: NOW })
  })
})

describe('poll', () => {
  test('takes statuses from the agent list every 2 seconds', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    world.agents = [listed('a-tu1', 'completed')]
    await world.clock.advance(2000)

    expect((await rowsOf($))['a-tu1']).toMatchObject({ status: 'completed', endedAt: NOW + 2000 })
  })

  test('stops once nothing runs', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    world.agents = [listed('a-tu1', 'completed')]
    await world.clock.advance(2000)
    const calls = world.listCalls
    await world.clock.advance(10_000)

    expect(world.listCalls).toBe(calls)
  })

  test('drops the rows of before a /clear', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    await world.clock.advance(5000)
    world.startedAt = NOW + 5000
    await spawn($, 'tu2')

    expect(Object.keys(await rowsOf($))).toEqual(['a-tu2'])
  })
})
```

If `UiPane`, `AgentSpawnInput` or the `$.state.get` result type differs from what is written here, take the shape from the types file, `grep -n "export type UiPane = \|export type AgentSpawnInput = \|get: " <types file>`, and adjust the test only. Don't change the plugin to fit a test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test ./plugins/subagent-pane`
Expected: the `recording` and `poll` tests FAIL (no rows are recorded); `rows` and `format` still pass.

- [ ] **Step 3: Implement the recording hooks**

Replace `plugins/subagent-pane/hooks/register.tsx` with:

```tsx
import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentRows } from '../types'
import { hasActive, pruned, rowFromInfo, type Step, withList, withSpawn, withStep, withTurnEnd } from './rows'

const POLL_MS = 2000

const agents = atom({ plugin: 'subagent-pane', key: 'agents' } as const, {})
const now = atom({ plugin: 'subagent-pane', key: 'now' } as const, 0)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const rowOfSpawn = (
  e: AgentSpawnInput,
  agentId: string,
  model: string,
  isWorktree: boolean,
  startedAt: number,
): AgentRow => ({
  id: agentId,
  description: e.description,
  type: e.subagentType,
  status: 'running',
  model,
  isBackground: e.background,
  isWorktree,
  ...(e.cwd === undefined ? {} : { cwd: e.cwd }),
  ...(e.name === undefined ? {} : { name: e.name }),
  startedAt,
})

export const register: Register = on => {
  /** Agent tool_use_ids whose call asked for `isolation: "worktree"`, until the call returns. */
  const worktreeCalls = new Set<string>()
  let stopPoll: (() => void) | null = null

  const sessionStartedAt = async ($: EngineInterface) => (await $.session.usage()).startedAt

  /** Applies `change` at the current time, prunes, stamps `now`, and runs the poll exactly while anything is active. */
  const write = async ($: EngineInterface, change: (rows: AgentRows, at: number) => AgentRows) => {
    const startedAt = await sessionStartedAt($)
    const at = await $.clock.now()
    await update($, agents, rows => pruned(change(rows, at), startedAt))
    await update($, now, () => at)
    if (hasActive(await read($, agents))) startPoll($)
    else stopPolling()
  }

  const tick = async ($: EngineInterface) => {
    try {
      const list = await $.agent.list()
      await write($, (rows, at) => withList(rows, list, at))
    } catch {
      // a failed read skips this tick; the next one tries again
    }
  }

  const startPoll = ($: EngineInterface) => {
    if (stopPoll === null) stopPoll = $.clock.every(POLL_MS, () => void tick($))
  }

  const stopPolling = () => {
    stopPoll?.()
    stopPoll = null
  }

  on('session.start', async ($, e, next) => {
    // a hot reload mid-run starts the poll again
    if (hasActive(await read($, agents))) startPoll($)

    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const id = e.tool_use_id
    if (id !== undefined && (e.input as { isolation?: unknown }).isolation === 'worktree') worktreeCalls.add(id)
    try {
      return await next(e)
    } finally {
      if (id !== undefined) worktreeCalls.delete(id)
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || result.agentId === undefined) return result
    const agentId = result.agentId
    try {
      const isWorktree = worktreeCalls.has(e.tool_use_id)
      await write($, (rows, at) => withSpawn(rows, rowOfSpawn(e, agentId, result.model, isWorktree, at)))
    } catch (error) {
      $.ui.log(`could not record subagent ${agentId}: ${messageOf(error)}`)
    }

    return result
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    if (agentId === undefined) return result
    try {
      const usage = result.usage
      const step: Step = {
        model: e.model,
        ...(e.effort === undefined ? {} : { effort: e.effort }),
        ...(usage === null
          ? {}
          : { contextTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens }),
      }
      const isKnown = (await read($, agents))[agentId] !== undefined
      const info = isKnown ? undefined : (await $.agent.list()).find(agent => agent.id === agentId)
      if (isKnown || info !== undefined) {
        await write($, (rows, at) => withStep(info === undefined ? rows : withSpawn(rows, rowFromInfo(info, at)), agentId, step))
      }
    } catch (error) {
      $.ui.log(`could not record a request of subagent ${agentId}: ${messageOf(error)}`)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (agentId === undefined || (await read($, agents))[agentId] === undefined) return result
    try {
      const listed = (await $.agent.list()).find(agent => agent.id === agentId)
      await write($, (rows, at) => withTurnEnd(rows, agentId, listed, at))
    } catch (error) {
      $.ui.log(`could not record the end of subagent ${agentId}: ${messageOf(error)}`)
    }

    return result
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test ./plugins/subagent-pane`
Expected: PASS, every test so far.

- [ ] **Step 5: Validate**

Run: `claude plugin validate ./plugins/subagent-pane`
Expected: no errors. It lists hooks on `session.start`, `tool.call`, `agent.spawn`, `turn.step`, `turn.complete`, and every `$.state` key named is in the contract.

- [ ] **Step 6: Commit**

```bash
git add plugins/subagent-pane/hooks/register.tsx plugins/subagent-pane/tests/register.test.tsx
git commit -m "feat(subagent-pane): record subagents and poll their status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The pane, auto-open and `/subagents-pane`

**Files:**
- Modify: `plugins/subagent-pane/hooks/register.tsx`
- Modify: `plugins/subagent-pane/tests/register.test.tsx` (append)

**Interfaces:**
- Consumes: `FACT_INDENT`, `headerText`, `layoutRow` (format.ts); `isFinished`, `ordered` (rows.ts); the `write` helper and state atoms from Task 3.
- Produces: pane `subagent-pane` drawn with keys `empty-none`, `empty-idle`, `agent-<id>`, `recent`. Command `subagents-pane`. State `autoOpenedAt`.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/subagent-pane/tests/register.test.tsx`:

```tsx
const pane = ($: Engine, options: { bodyColumns?: number; agentId?: string } = {}) =>
  $.ui.mount({
    plugin: 'subagent-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'subagent-pane',
    props: {
      title: 'Subagents',
      isFocused: false,
      bodyColumns: options.bodyColumns ?? 48,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: options.agentId === undefined ? {} : { agentId: options.agentId },
    },
  })

const toggle = ($: Engine) =>
  $.command.run({
    command: 'subagents-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })

describe('pane', () => {
  test('shows the empty state before any subagent', async ($, on) => {
    engine(on)
    await start($)
    const ui = await pane($)

    const empty = (await ui.find({ key: 'empty-none' }))?.text
    expect(empty).toContain('No subagents yet.')
    expect(empty).toContain('/subagents-pane to close')
    await ui.unmount()
  })

  test('draws a running agent with its facts', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1', { background: true, name: 'auth' })
    await step($, 'a-tu1', 'high')
    const ui = await pane($)

    expect((await ui.find({ type: 'Text', text: /Subagents · 1 running/ }))).toBeDefined()
    const agent = (await ui.find({ key: 'agent-a-tu1' }))?.text
    expect(agent).toContain('refactor auth module')
    expect(agent).toContain('0s')
    expect(agent).toContain('opus-5-5 · high · ctx 42k · bg · @auth')
    expect(await ui.find({ key: 'empty-none' })).toBeUndefined()
    expect(await ui.find({ key: 'empty-idle' })).toBeUndefined()
    await ui.unmount()
  })

  test('counts elapsed time while the agent runs', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    world.agents = [listed('a-tu1', 'running')]
    await world.clock.advance(62_000)
    const ui = await pane($)

    expect((await ui.find({ key: 'agent-a-tu1' }))?.text).toContain('1m')
    await ui.unmount()
  })

  test('moves a finished agent under Recent and says nothing runs', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    world.agents = [listed('a-tu1', 'completed')]
    await world.clock.advance(2000)
    const ui = await pane($)

    expect((await ui.find({ key: 'empty-idle' }))?.text).toContain('No subagents running.')
    const recent = (await ui.find({ key: 'recent' }))?.text
    expect(recent).toContain('Recent')
    expect(recent).toContain('refactor auth module')
    expect(recent).toContain('done 2s')
    await ui.unmount()
  })

  test('highlights the agent whose transcript is in view', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1')
    await spawn($, 'tu2', { description: 'migrate test fixtures' })
    const ui = await pane($, { agentId: 'a-tu2' })

    expect((await ui.find({ key: 'agent-a-tu2' }))?.text).toContain('▶')
    expect((await ui.find({ key: 'agent-a-tu1' }))?.text).not.toContain('▶')
    await ui.unmount()
  })

  test('fits a narrow pane without failing', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1', { cwd: '/repo/a-very-long-directory-name' })
    const ui = await pane($, { bodyColumns: 8 })

    expect(await ui.find({ key: 'agent-a-tu1' })).toBeDefined()
    await ui.unmount()
  })
})

describe('opening', () => {
  test('opens the pane on the first spawn only', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    await world.clock.settle()
    expect(world.opened).toEqual(['subagent-pane'])

    world.panes = [] // the person closed it
    await spawn($, 'tu2')
    await world.clock.settle()
    expect(world.opened).toEqual(['subagent-pane'])
  })

  test('opens again on the first spawn after a /clear', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    await world.clock.advance(5000)
    world.startedAt = NOW + 5000
    await spawn($, 'tu2')
    await world.clock.settle()

    expect(world.opened).toEqual(['subagent-pane', 'subagent-pane'])
  })

  test('/subagents-pane opens, then closes the pane', async ($, on) => {
    const world = engine(on)
    await start($)

    expect((await toggle($)).text).toBe('Subagents pane opened.')
    expect(world.opened).toEqual(['subagent-pane'])
    expect((await toggle($)).text).toBe('Subagents pane closed.')
    expect(world.closed).toEqual(['subagent-pane'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `claude plugin test ./plugins/subagent-pane`
Expected: the `pane` and `opening` tests FAIL (no `Pane` hook, no command). Earlier tests still pass.

- [ ] **Step 3: Add the pane, auto-open and the command**

In `plugins/subagent-pane/hooks/register.tsx`, change the imports and constants at the top to:

```tsx
import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentRows } from '../types'
import { FACT_INDENT, headerText, layoutRow } from './format'
import {
  hasActive,
  isFinished,
  ordered,
  pruned,
  rowFromInfo,
  type Step,
  withList,
  withSpawn,
  withStep,
  withTurnEnd,
} from './rows'

const PANE = 'subagent-pane'
const TITLE = 'Subagents'
const COMMAND = 'subagents-pane'
const POLL_MS = 2000

const agents = atom({ plugin: 'subagent-pane', key: 'agents' } as const, {})
const now = atom({ plugin: 'subagent-pane', key: 'now' } as const, 0)
const autoOpenedAt = atom({ plugin: 'subagent-pane', key: 'autoOpenedAt' } as const, null)
```

Inside `register`, after `stopPolling`, add:

```tsx
  /** Opens the pane on the session's first spawn; a /clear starts a new session. */
  const autoOpen = async ($: EngineInterface) => {
    const opened = await read($, autoOpenedAt)
    if (opened !== null && opened >= (await sessionStartedAt($))) return
    const at = await $.clock.now()
    await update($, autoOpenedAt, () => at)
    void $.ui.open({ id: PANE, title: TITLE }).catch(error => $.ui.log(`could not open the pane: ${messageOf(error)}`))
  }
```

Replace the `session.start` hook with:

```tsx
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Show or hide the subagents pane' })
    // a hot reload mid-run starts the poll again
    if (hasActive(await read($, agents))) startPoll($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: 'Subagents pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Subagents pane opened.' }
  }).catch(($, e, next) => ({ text: `Could not toggle the subagents pane: ${next.error.message}` }))
```

In the `agent.spawn` hook, call `autoOpen` right after the `write`:

```tsx
      await write($, (rows, at) => withSpawn(rows, rowOfSpawn(e, agentId, result.model, isWorktree, at)))
      await autoOpen($)
```

At the end of `register`, add the render hook:

```tsx
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { active, recent } = ordered(await read($, agents))
    const at = await read($, now)
    const columns = Math.max(1, e.props.bodyColumns)
    const viewed = e.props.view.agentId

    const block = (row: AgentRow) => {
      const line = layoutRow(row, columns, at, row.id === viewed)
      const isInView = row.id === viewed
      const isDim = isFinished(row.status)
      const markStyle = line.markColor === undefined ? { dimColor: true } : { color: line.markColor }

      return (
        <Box key={`agent-${row.id}`} flexDirection="column">
          <Box flexDirection="row">
            {isInView && <Text bold>{line.prefix}</Text>}
            <Text {...markStyle}>{line.mark}</Text>
            <Text bold={isInView} dimColor={isDim}>{` ${line.description}${line.gap}`}</Text>
            <Text dimColor>{line.elapsed}</Text>
          </Box>
          {line.facts.map((fact, index) => (
            <Box key={`agent-${row.id}-fact-${index}`}>
              <Text dimColor>{`${FACT_INDENT}${fact}`}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    const isEmpty = active.length === 0 && recent.length === 0

    return (
      <Box flexDirection="column">
        <Text bold>{headerText(active.length)}</Text>
        {isEmpty && (
          <Box key="empty-none" flexDirection="column">
            <Text dimColor>No subagents yet.</Text>
            <Text dimColor>{`/${COMMAND} to close`}</Text>
          </Box>
        )}
        {!isEmpty && active.length === 0 && (
          <Box key="empty-idle">
            <Text dimColor>No subagents running.</Text>
          </Box>
        )}
        {active.map(block)}
        {recent.length > 0 && (
          <Box key="recent" flexDirection="column" marginTop={1}>
            <Text bold dimColor>Recent</Text>
            {recent.map(block)}
          </Box>
        )}
      </Box>
    )
  })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `claude plugin test ./plugins/subagent-pane`
Expected: PASS, every test.

If a tree is refused (the test output or `claude --debug` says `ui.render (Pane): a hook returned a tree that does not validate`), read the reason. The likely one is a prop the terminal's `Text`/`Box` doesn't take. Fix the tree, then rerun the tests.

- [ ] **Step 5: Validate and type-check**

Run: `claude plugin validate ./plugins/subagent-pane`
Expected: no errors. It lists the `ui.render` (Pane) and `command.run` hooks.

Type-check with a tsconfig kept outside the mod. The engine hasn't laid `.claude-plugin/types/` yet. Write `<scratchpad>/subagent-pane-tsconfig.json`, using the types path this session's `plugin-authoring` skill names (a session restart changes it):

```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [
    "/private/tmp/claude-501/bundled-skills/2.1.295/0556c236058586ea4eed0eaec6e0dfbe/plugin-authoring/types/claude-code.d.ts",
    "/Users/dickyadrian/Documents/claude-mod/plugins/subagent-pane/hooks",
    "/Users/dickyadrian/Documents/claude-mod/plugins/subagent-pane/types",
    "/Users/dickyadrian/Documents/claude-mod/plugins/subagent-pane/tests"
  ]
}
```

Run: `npx -y -p typescript@5.6.3 tsc -p <scratchpad>/subagent-pane-tsconfig.json`
Expected: no errors. If `tool.call`'s `e.input` for `Agent` is typed without `isolation` in this build, the `as { isolation?: unknown }` cast is still valid TypeScript. Leave it.

- [ ] **Step 6: Commit**

```bash
git add plugins/subagent-pane/hooks/register.tsx plugins/subagent-pane/tests/register.test.tsx
git commit -m "feat(subagent-pane): draw the subagents pane and toggle it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Marketplace, README, settings and a live check

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Modify: `README.md` (new section after `### model-router`, before `## Developing`)
- Modify: `~/.claude/settings.json` (only `env.CLAUDE_CODE_PLUGIN_DIRS`)

- [ ] **Step 1: Add the marketplace entry**

In `.claude-plugin/marketplace.json`, append to `plugins`, after the `model-router` entry:

```json
    {
      "name": "subagent-pane",
      "source": "./plugins/subagent-pane",
      "description": "A side pane listing each subagent with its model, effort, live context and run mode"
    }
```

- [ ] **Step 2: Add the README section**

Insert before `## Developing` in `README.md`:

````markdown
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
````

- [ ] **Step 3: Check the dirty files before committing**

`.claude-plugin/marketplace.json` and `README.md` already carry uncommitted model-router edits from before this plan. Stop and ask the user: commit model-router first as its own commit, or commit both together? Don't decide alone. Then commit as told, for example:

```bash
git add .claude-plugin/marketplace.json README.md
git commit -m "docs(subagent-pane): list the mod in the marketplace and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Load the mod from settings**

Read `~/.claude/settings.json`. In `env`, change exactly the `CLAUDE_CODE_PLUGIN_DIRS` value from

```
/Users/dickyadrian/Documents/claude-mod/plugins/usage-bar:/Users/dickyadrian/Documents/claude-mod/plugins/model-router
```

to

```
/Users/dickyadrian/Documents/claude-mod/plugins/usage-bar:/Users/dickyadrian/Documents/claude-mod/plugins/model-router:/Users/dickyadrian/Documents/claude-mod/plugins/subagent-pane
```

Use an exact-string edit. Nothing else in the file changes. Then confirm the file is still valid JSON:

Run: `python3 -c "import json; json.load(open('/Users/dickyadrian/.claude/settings.json')); print('ok')"`
Expected: `ok`

- [ ] **Step 5: Live check (the user runs it)**

Ask the user to start a new session in fullscreen at 144+ columns, then ask it for two agents: one background `general-purpose` agent with `model: "sonnet"`, and one foreground `Explore` agent with `model: "haiku"`. Expected:

- the pane opens by itself at the first spawn
- each row shows its own model (`sonnet-...`, `haiku-...`), plus effort and `ctx` once its first request returns, plus `bg` on the background one
- elapsed time counts up about every 2s
- when both finish: `No subagents running.`, then both under `Recent` with `done <time>`
- `/subagents-pane` closes the pane; running it again reopens it
- after `/clear`, `/subagents-pane` shows `No subagents yet.`

Problems show as dim `subagent-pane: ...` lines in the transcript, or in `claude --debug`.

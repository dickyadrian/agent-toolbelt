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
  // running is no finished status, so `now` is never read
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

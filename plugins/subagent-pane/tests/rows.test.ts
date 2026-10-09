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

  test('finishes an agent the list named before and has dropped', () => {
    const seen = withList(rowsOf(row('a')), [info('a', 'idle')], 5000)
    expect(withList(seen, [], 9000).a).toMatchObject({ status: 'completed', endedAt: 9000 })
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

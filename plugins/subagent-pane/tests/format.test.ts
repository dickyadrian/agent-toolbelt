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

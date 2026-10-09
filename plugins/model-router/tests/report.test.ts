import { describe, expect, test } from 'claude-code/testing'

import type { Tier } from '../hooks/classify'
import type { TurnRecord, Usage } from '../hooks/record'
import { formatReport, sampleOf, summarize, weightedTokens } from '../hooks/report'

const tokens = (input: number, output = 0, cacheRead = 0, cacheWrite = 0): Usage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
})

let next = 0

const prompt = (
  tier: Tier | null,
  options: {
    usage?: Usage
    probability?: number
    quota?: [number, number]
    jevError?: string
    source?: 'jev' | 'builtin'
    at?: string
    text?: string
    turnId?: string
  } = {},
): TurnRecord => ({
  version: 1,
  sessionId: 's1',
  turnId: options.turnId ?? `t${++next}`,
  agent: null,
  startedAt: options.at ?? '2026-10-08T10:00:00.000Z',
  durationMs: 1000,
  reason: 'answer',
  prompt: options.text ?? `prompt ${next}`,
  classification:
    tier === null
      ? null
      : {
          tier,
          source: options.source ?? 'jev',
          latencyMs: 50,
          ...(options.probability === undefined ? {} : { probabilities: { [tier]: options.probability } }),
          ...(options.jevError === undefined ? {} : { jevError: options.jevError }),
        },
  quota:
    options.quota === undefined
      ? null
      : { before: { five_hour: options.quota[0] }, after: { five_hour: options.quota[1] } },
  usage: options.usage ?? tokens(1000),
  steps: [],
})

const run = (parentTurnId: string, usage: Usage): TurnRecord => ({
  ...prompt(null, { usage }),
  agent: { id: `a${next}`, type: 'Explore', parentTurnId },
  prompt: null,
})

describe('weightedTokens', () => {
  test('weights each kind of token by its API price ratio', () => {
    expect(weightedTokens(tokens(100, 10, 1000, 40))).toBe(100 + 50 + 100 + 50)
    expect(weightedTokens(null)).toBe(0)
  })
})

describe('summarize', () => {
  test('splits prompts, tokens and quota by tier', () => {
    const summary = summarize([
      prompt('trivial', { usage: tokens(1000), quota: [10, 10.5] }),
      prompt('hard', { usage: tokens(3000), quota: [10.5, 12] }),
      prompt(null, { usage: tokens(500) }),
    ])

    expect(summary.prompts).toBe(3)
    expect(summary.byTier.trivial).toEqual({ prompts: 1, weighted: 1000, fiveHour: 0.5, sevenDay: 0 })
    expect(summary.byTier.hard).toEqual({ prompts: 1, weighted: 3000, fiveHour: 1.5, sevenDay: 0 })
    expect(summary.byTier.untagged.prompts).toBe(1)
    expect(summary.total).toEqual({ prompts: 3, weighted: 4500, fiveHour: 2, sevenDay: 0 })
    expect(summary.hasQuota).toBe(true)
  })

  test('counts a subagent run toward the prompt that started it', () => {
    const parent = prompt('trivial', { usage: tokens(1000), turnId: 'parent' })
    const summary = summarize([parent, run('parent', tokens(4000)), run('gone', tokens(200))])

    expect(summary.subagentRuns).toBe(2)
    expect(summary.byTier.trivial.weighted).toBe(5000)
    expect(summary.byTier.untagged.weighted).toBe(200)
    expect(summary.byTier.trivial.prompts).toBe(1)
  })

  test('ignores quota across a window reset', () => {
    const summary = summarize([prompt('normal', { quota: [95, 2] })])

    expect(summary.byTier.normal.fiveHour).toBe(0)
  })

  test('counts which classifier tagged each prompt, and why Jev failed', () => {
    const summary = summarize([
      prompt('hard'),
      prompt('trivial', { source: 'builtin', jevError: 'HTTP 401' }),
      prompt('trivial', { source: 'builtin', jevError: 'HTTP 401' }),
      prompt('normal', { source: 'builtin' }),
      prompt(null),
    ])

    expect(summary.sources).toEqual({ jev: 1, builtinAfterJev: 2, builtin: 1, untagged: 1 })
    expect(summary.jevErrors).toEqual([['HTTP 401', 2]])
  })

  test('bands trivial prompts by how sure Jev was', () => {
    const summary = summarize([
      prompt('trivial', { probability: 0.99 }),
      prompt('trivial', { probability: 0.9 }),
      prompt('trivial', { probability: 0.5 }),
      prompt('trivial'),
    ])

    expect(summary.confidence.map(band => band.prompts)).toEqual([1, 1, 0, 1])
  })

  test('measures how many days the log spans', () => {
    const summary = summarize([
      prompt('normal', { at: '2026-10-08T10:00:00.000Z' }),
      prompt('normal', { at: '2026-10-11T22:00:00.000Z' }),
    ])

    expect(summary.spanDays).toBe(3.5)
    expect(summary.firstAt).toBe('2026-10-08T10:00:00.000Z')
  })
})

describe('sampleOf', () => {
  test('picks at most the size asked for, keeping order', () => {
    const picked = sampleOf([1, 2, 3, 4, 5], 3, () => 0.5)
    expect(picked).toHaveLength(3)
    expect([...picked].sort()).toEqual(picked)
    expect(sampleOf([1, 2], 10, Math.random)).toEqual([1, 2])
  })
})

describe('formatReport', () => {
  const report = (records: TurnRecord[]) => formatReport(summarize(records), () => 0)

  test('says so when nothing is logged', () => {
    expect(report([])).toContain('has logged no prompts yet')
  })

  test('shows a row per tier and the quota columns when quota was measured', () => {
    const text = report([
      prompt('trivial', { usage: tokens(1000), quota: [1, 2] }),
      prompt('hard', { usage: tokens(3000), quota: [2, 5] }),
    ])

    expect(text).toContain('model-router: 2 prompts and 0 subagent runs over 1 session,')
    expect(text).toContain('5h quota pts')
    expect(text).toMatch(/trivial\s+1\s+50%\s+1\.0k\s+25%\s+1\.0\s+25%/)
    expect(text).toMatch(/hard\s+1\s+50%\s+3\.0k\s+75%\s+3\.0\s+75%/)
    expect(text).not.toMatch(/^untagged/m)
  })

  test('leaves the quota columns out without quota data', () => {
    expect(report([prompt('normal')])).not.toContain('quota pts')
  })

  test('marks what phase 2 still needs', () => {
    const text = report([prompt('trivial'), prompt('normal')])

    expect(text).toContain('✗ 2 prompts (need 300)')
    expect(text).toContain('✗ 1 tagged trivial (need 50)')
    expect(text).toContain('✗ 0.0 days logged (need 7)')
  })

  test('says whether trivial prompts take enough to be worth routing', () => {
    expect(report([prompt('trivial', { usage: tokens(100) }), prompt('hard', { usage: tokens(900) })])).toContain(
      'Under 15%, routing them is unlikely to pay off',
    )
    expect(report([prompt('trivial', { usage: tokens(500) }), prompt('hard', { usage: tokens(500) })])).toContain(
      'enough to be worth routing',
    )
  })

  test('lists trivial prompts to review, with Jev\'s probability, one line each', () => {
    const text = report([prompt('trivial', { probability: 0.97, text: 'rename foo\nto bar' }), prompt('hard')])

    expect(text).toContain('0.97  rename foo to bar')
  })

  test('lists Jev errors by how often they happened', () => {
    const text = report([
      prompt('trivial', { source: 'builtin', jevError: 'timed out after 5000ms' }),
      prompt('trivial', { source: 'builtin', jevError: 'HTTP 401' }),
      prompt('trivial', { source: 'builtin', jevError: 'HTTP 401' }),
    ])

    expect(text).toContain('built-in after Jev failed 3')
    expect(text.indexOf('2x HTTP 401')).toBeLessThan(text.indexOf('1x timed out after 5000ms'))
  })
})

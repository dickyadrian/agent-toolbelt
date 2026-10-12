import type { ContextCategory, SessionContextBreakdown } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { Snapshot } from '../types'
import {
  barRuns,
  fold,
  layout,
  percentOf,
  percentText,
  tailText,
  tokensText,
  toneProps,
  urgencyOf,
} from '../hooks/format'

const row = (name: string, tokens: number, kind: ContextCategory['kind']): ContextCategory => ({
  name,
  tokens,
  color: 'inactive',
  isDeferred: kind === 'deferred',
  kind,
})

const breakdown = (categories: ContextCategory[], autoCompact: number | null): SessionContextBreakdown => ({
  categories,
  totalTokens: 0,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'auto',
  percentage: 0,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: autoCompact !== null,
  ...(autoCompact === null ? {} : { autoCompactThreshold: autoCompact }),
  apiUsage: null,
})

const snap = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  setup: 20_000,
  chat: 80_000,
  window: 200_000,
  compactAt: 160_000,
  hasSplit: true,
  ...overrides,
})

/** The bar as one string, for asserting cell layout. */
const cells = (s: Snapshot, width: number) =>
  barRuns(s, width, 'dim')
    .map(run => run.text)
    .join('')

describe('fold', () => {
  test('sums used rows into setup, Messages into chat, and drops the rest', () => {
    const folded = fold(
      breakdown(
        [
          row('System prompt', 3_000, 'used'),
          row('System tools', 12_000, 'used'),
          row('Memory files', 5_000, 'used'),
          row('Messages', 80_000, 'used'),
          row('MCP tools', 9_000, 'deferred'),
          row('Free space', 67_000, 'free'),
          row('Autocompact buffer', 33_000, 'buffer'),
        ],
        160_000,
      ),
    )
    expect(folded).toEqual({ setup: 20_000, chat: 80_000, window: 200_000, compactAt: 160_000, hasSplit: true })
  })

  test('counts everything as setup when no Messages row exists', () => {
    const folded = fold(breakdown([row('System prompt', 3_000, 'used'), row('Chat', 50_000, 'used')], 160_000))
    expect(folded).toMatchObject({ setup: 53_000, chat: 0, hasSplit: false })
  })

  test('has no compaction point when autocompact is off', () => {
    const folded = fold(breakdown([row('Messages', 1_000, 'used')], null))
    expect(folded.compactAt).toBeUndefined()
  })
})

describe('percentOf and urgencyOf', () => {
  test('measures against the compaction point, or the window when autocompact is off', () => {
    expect(percentOf(snap())).toBe(63)
    expect(percentOf(snap({ compactAt: undefined }))).toBe(50)
  })

  test('goes past 100', () => {
    expect(percentOf(snap({ chat: 146_400 }))).toBe(104)
  })

  test('is dim below 80, warning from 80, error from 90', () => {
    expect(urgencyOf(79)).toBe('dim')
    expect(urgencyOf(80)).toBe('warning')
    expect(urgencyOf(89)).toBe('warning')
    expect(urgencyOf(90)).toBe('error')
  })

  test('pads the percent to four cells', () => {
    expect(percentText(62)).toBe(' 62%')
    expect(percentText(104)).toBe('104%')
  })
})

describe('tokensText', () => {
  test('writes units, k and M', () => {
    expect(tokensText(0)).toBe('0')
    expect(tokensText(950)).toBe('950')
    expect(tokensText(21_000)).toBe('21k')
    expect(tokensText(1_200_000)).toBe('1.2M')
    expect(tokensText(999_600)).toBe('1M')
  })
})

describe('tailText', () => {
  test('full: the split and what is left before compaction', () => {
    expect(tailText(snap(), true)).toBe('setup 20k · chat 80k · 60k to compact')
  })

  test('short: only what is left', () => {
    expect(tailText(snap(), false)).toBe('60k to compact')
  })

  test('says how far over once past the compaction point', () => {
    expect(tailText(snap({ chat: 143_000 }), false)).toBe('over by 3k')
  })

  test('without a split, shows the used total', () => {
    expect(tailText(snap({ setup: 100_000, chat: 0, hasSplit: false }), true)).toBe('100k used · 60k to compact')
  })

  test('with autocompact off, shows the free window', () => {
    expect(tailText(snap({ compactAt: undefined }), false)).toBe('100k free')
  })
})

describe('barRuns', () => {
  test('draws setup, chat, free, the marker and the reserve across 24 cells', () => {
    // 20k and 80k of 200k over 24 cells: 2 and 10. Marker at 160k: cell 19.
    expect(cells(snap(), 24)).toBe('▓▓██████████·······┃░░░░')
  })

  test('scales to 16 and 10 cells', () => {
    expect(cells(snap(), 16)).toBe('▓▓██████·····┃░░')
    expect(cells(snap(), 10)).toBe('▓████···┃░')
  })

  test('keeps one cell for a tiny group', () => {
    expect(cells(snap({ setup: 100, chat: 150_000 }), 24).startsWith('▓█')).toBe(true)
    expect(cells(snap({ setup: 150_000, chat: 100 }), 24)).toContain('▓█')
  })

  test('fills over the marker and reserve once past compaction, never past the width', () => {
    const bar = cells(snap({ chat: 200_000 }), 24)
    expect(bar).toHaveLength(24)
    expect(bar).not.toContain('┃')
  })

  test('has no marker or reserve when autocompact is off', () => {
    const bar = cells(snap({ compactAt: undefined }), 24)
    expect(bar).not.toContain('┃')
    expect(bar).not.toContain('░')
    expect(bar).toHaveLength(24)
  })

  test('colors setup and chat, and the marker by urgency', () => {
    const runs = barRuns(snap(), 24, 'warning')
    expect(runs).toEqual([
      { text: '▓▓', tone: 'suggestion' },
      { text: '██████████', tone: 'claude' },
      { text: '·······', tone: 'dim' },
      { text: '┃', tone: 'warning' },
      { text: '░░░░', tone: 'dim' },
    ])
  })
})

describe('layout', () => {
  // ctx(3) + 1 + bar(24) + 1 + percent(4) = 33; + 2 + tail.
  const full = 'setup 20k · chat 80k · 60k to compact'
  const short = '60k to compact'

  test('fits the full tail when there is room', () => {
    expect(layout(snap(), 35 + full.length)).toEqual({ width: 24, tail: full })
  })

  test('drops the split first, then the whole tail', () => {
    expect(layout(snap(), 34 + full.length)).toEqual({ width: 24, tail: short })
    expect(layout(snap(), 35 + short.length)).toEqual({ width: 24, tail: short })
    expect(layout(snap(), 34 + short.length)).toEqual({ width: 24 })
  })

  test('then shrinks the bar down to 10 cells, then drops it', () => {
    expect(layout(snap(), 33)).toEqual({ width: 24 })
    expect(layout(snap(), 25)).toEqual({ width: 16 })
    expect(layout(snap(), 19)).toEqual({ width: 10 })
    expect(layout(snap(), 18)).toEqual({ width: 0 })
  })
})

describe('toneProps', () => {
  test('dim draws dimColor, a theme key draws color', () => {
    expect(toneProps('dim')).toEqual({ dimColor: true })
    expect(toneProps('error')).toEqual({ color: 'error' })
  })
})

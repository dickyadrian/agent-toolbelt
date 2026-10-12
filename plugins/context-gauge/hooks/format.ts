import type { RenderNode, SessionContextBreakdown, ThemeKey } from 'claude-code'

import type { Snapshot } from '../types'

/** A theme color, or the terminal's dim style. */
export type Tone = ThemeKey | 'dim'

/** How urgent the fill is, as the label, marker, percent and tail draw it. */
export type Urgency = 'dim' | 'warning' | 'error'

/** A run of equal bar cells. */
export type Run = { text: string; tone: Tone }

/** What fits in the row: the bar's width in cells (0 for none) and the tail, if any. */
export type Layout = { width: number; tail?: string }

export const BAR_WIDTH = 24
export const MIN_BAR_WIDTH = 10
export const LABEL = 'ctx'
const PERCENT_WIDTH = 4
const TAIL_GAP = 2
/** The `/context` row that holds the conversation; every other used row is setup. */
const MESSAGES = 'Messages'

export const fold = (breakdown: SessionContextBreakdown): Snapshot => {
  let setup = 0
  let chat = 0
  let hasSplit = false
  for (const row of breakdown.categories) {
    if (row.kind !== 'used') continue
    if (row.name === MESSAGES) {
      chat += row.tokens
      hasSplit = true
    } else {
      setup += row.tokens
    }
  }
  const compactAt = breakdown.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined

  return {
    setup,
    chat,
    window: breakdown.rawMaxTokens,
    hasSplit,
    ...(compactAt === undefined ? {} : { compactAt }),
  }
}

const usedOf = (s: Snapshot): number => s.setup + s.chat

export const percentOf = (s: Snapshot): number => {
  const limit = s.compactAt ?? s.window

  return limit > 0 ? Math.round((usedOf(s) / limit) * 100) : 0
}

export const urgencyOf = (percent: number): Urgency =>
  percent >= 90 ? 'error' : percent >= 80 ? 'warning' : 'dim'

export const percentText = (percent: number): string => `${percent}%`.padStart(PERCENT_WIDTH)

/** `950`, `21k`, `1.2M`. */
export const tokensText = (tokens: number): string => {
  const n = Math.max(0, Math.round(tokens))
  if (n < 1000) return String(n)
  const thousands = Math.round(n / 1000)
  if (thousands < 1000) return `${thousands}k`

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

const leftText = (s: Snapshot): string => {
  const used = usedOf(s)
  if (s.compactAt === undefined) return `${tokensText(Math.max(0, s.window - used))} free`

  return used <= s.compactAt
    ? `${tokensText(s.compactAt - used)} to compact`
    : `over by ${tokensText(used - s.compactAt)}`
}

const splitText = (s: Snapshot): string =>
  s.hasSplit ? `setup ${tokensText(s.setup)} · chat ${tokensText(s.chat)}` : `${tokensText(usedOf(s))} used`

/** The text after the percent: the split and what is left, or only what is left. */
export const tailText = (s: Snapshot, isFull: boolean): string =>
  isFull ? `${splitText(s)} · ${leftText(s)}` : leftText(s)

/** Cells for setup and chat: proportional to the window, one at least for a group with tokens. */
const groupCells = (s: Snapshot, width: number): { setup: number; chat: number } => {
  const used = usedOf(s)
  if (used <= 0 || s.window <= 0) return { setup: 0, chat: 0 }
  const groups = (s.setup > 0 ? 1 : 0) + (s.chat > 0 ? 1 : 0)
  const total = Math.min(width, Math.max(groups, Math.round((used / s.window) * width)))
  if (s.chat <= 0) return { setup: total, chat: 0 }
  if (s.setup <= 0) return { setup: 0, chat: total }
  const setup = Math.min(total - 1, Math.max(1, Math.round((s.setup / used) * total)))

  return { setup, chat: total - setup }
}

export const barRuns = (s: Snapshot, width: number, urgency: Urgency): Run[] => {
  const { setup, chat } = groupCells(s, width)
  const marker =
    s.compactAt === undefined || s.window <= 0
      ? -1
      : Math.min(width - 1, Math.round((s.compactAt / s.window) * width))
  const runs: Run[] = []
  for (let index = 0; index < width; index += 1) {
    const cell: Run =
      index < setup
        ? { text: '▓', tone: 'suggestion' }
        : index < setup + chat
          ? { text: '█', tone: 'claude' }
          : index === marker
            ? { text: '┃', tone: urgency }
            : marker >= 0 && index > marker
              ? { text: '░', tone: 'dim' }
              : { text: '·', tone: 'dim' }
    const last = runs[runs.length - 1]
    if (last !== undefined && last.tone === cell.tone && last.text[0] === cell.text) {
      last.text += cell.text
    } else {
      runs.push(cell)
    }
  }

  return runs
}

/** Cells the row takes: `ctx`, the bar, the percent and the tail, one cell apart (two before the tail). */
const rowWidth = (bar: number, tail?: string): number =>
  LABEL.length + 1 + (bar > 0 ? bar + 1 : 0) + PERCENT_WIDTH + (tail === undefined ? 0 : TAIL_GAP + tail.length)

/** What fits in `columns`: the split goes first, then the tail, then bar cells down to 10, then the bar. */
export const layout = (s: Snapshot, columns: number): Layout => {
  for (const tail of [tailText(s, true), tailText(s, false)]) {
    if (rowWidth(BAR_WIDTH, tail) <= columns) return { width: BAR_WIDTH, tail }
  }
  for (let width = BAR_WIDTH; width >= MIN_BAR_WIDTH; width -= 1) {
    if (rowWidth(width) <= columns) return { width }
  }

  return { width: 0 }
}

/**
 * Whether a tree draws nothing: no non-blank string anywhere in it. The
 * engine's own band (`type: 'engine'`) counts as blank: without a survey,
 * which the gauge yields to anyway, it draws nothing.
 */
export const isBlank = (node: RenderNode): boolean => {
  if (typeof node === 'string') return node.trim() === ''
  if (node.type === 'engine') return true
  if (node.type !== 'Box' && node.type !== 'Text') return false

  return (node.children ?? []).every(isBlank)
}

/** The Text props a tone draws with. */
export const toneProps = (tone: Tone): { dimColor: true } | { color: ThemeKey } =>
  tone === 'dim' ? { dimColor: true } : { color: tone }

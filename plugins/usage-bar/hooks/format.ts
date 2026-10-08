import type { ThemeKey } from 'claude-code'

import type { UsageWindow } from '../types'

/** One window as the band draws it: every piece already text. */
export type Segment = {
  kind: string
  label: string
  bar: string
  percent: string
  color: ThemeKey
  reset?: string
}

const BAR_WIDTH = 14
const MIN_BAR_WIDTH = 6
/** Cells between two segments on one row. */
export const SEGMENT_GAP = 4

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
const ORDER = ['five_hour', 'seven_day']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const labelOf = (kind: string): string => LABELS[kind] ?? kind

export const colorOf = (percent: number): ThemeKey =>
  percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'

export const bar = (percent: number, width: number): string => {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const clockText = (date: Date): string => {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  const suffix = hours < 12 ? 'am' : 'pm'
  const mm = minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`

  return `${hour12}${mm}${suffix}`
}

/** `3:40pm` for a reset later today, `Mon 9am` for one on another day. */
export const resetText = (resetsAt: string | undefined, now: number): string | undefined => {
  if (resetsAt === undefined) {
    return undefined
  }
  const reset = new Date(resetsAt)
  const today = new Date(now)
  const isToday = reset.toDateString() === today.toDateString()

  return isToday ? clockText(reset) : `${WEEKDAYS[reset.getDay()]} ${clockText(reset)}`
}

const hasReset = (window: UsageWindow, now: number): boolean =>
  window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now

/** What a window shows as used: 0 once its reset time has passed. */
const percentShown = (window: UsageWindow, now: number): number =>
  hasReset(window, now) ? 0 : window.percentUsed

const segmentOf = (window: UsageWindow, percent: number, now: number): Segment => {
  const reset = hasReset(window, now) ? undefined : resetText(window.resetsAt, now)

  return {
    kind: window.kind,
    label: labelOf(window.kind),
    bar: bar(percent, BAR_WIDTH),
    percent: `${Math.round(percent)}%`.padStart(4),
    color: colorOf(percent),
    ...(reset === undefined ? {} : { reset }),
  }
}

/** Cells a segment takes: `5h ███  48%  resets 3:40pm`. */
export const segmentWidth = (segment: Segment): number =>
  segment.label.length +
  1 +
  segment.bar.length +
  1 +
  segment.percent.length +
  (segment.reset === undefined ? 0 : '  resets '.length + segment.reset.length)

const rowWidth = (row: Segment[]): number =>
  row.reduce((sum, segment) => sum + segmentWidth(segment), 0) + SEGMENT_GAP * (row.length - 1)

const withBar = (segment: Segment, width: number, percent: number): Segment => ({
  ...segment,
  bar: bar(percent, width),
})

/** Shrinks the bar, then drops the reset text, until the segment fits. */
const fit = (segment: Segment, percent: number, columns: number): Segment => {
  const over = segmentWidth(segment) - columns
  if (over <= 0) {
    return segment
  }
  if (BAR_WIDTH - over >= MIN_BAR_WIDTH) {
    return withBar(segment, BAR_WIDTH - over, percent)
  }
  const { reset: _dropped, ...bare } = segment
  const room = BAR_WIDTH - (segmentWidth(bare) - columns)

  return withBar(bare, Math.max(MIN_BAR_WIDTH, Math.min(BAR_WIDTH, room)), percent)
}

const rank = (kind: string): number => {
  const index = ORDER.indexOf(kind)

  return index === -1 ? ORDER.length : index
}

/**
 * The band's rows: every window on one row when they fit in `columns`,
 * else one row each, each segment shrunk to fit.
 */
export const layout = (windows: UsageWindow[], columns: number, now: number): Segment[][] => {
  const shown = [...windows]
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map(window => {
      const percent = percentShown(window, now)

      return { percent, segment: segmentOf(window, percent, now) }
    })
  const segments = shown.map(one => one.segment)
  if (rowWidth(segments) <= columns) {
    return [segments]
  }

  return shown.map(({ percent, segment }) => [fit(segment, percent, columns)])
}

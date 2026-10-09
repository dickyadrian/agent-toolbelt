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

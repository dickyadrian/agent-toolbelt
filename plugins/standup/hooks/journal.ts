/** One typed turn as the journal keeps it: one JSON line. `followUps`: prompts typed while it ran, folded into it. */
export type Entry = { t: string; repo: string; prompt: string; files: string[]; answer: string; followUps?: string[] }

/** How much of a prompt (its start) and of a reply (its end) is kept. */
export const TEXT_CHARS = 300

/** The hour a workday starts: work before it counts toward the day before. */
export const WORKDAY_START_HOUR = 4

/** Turns the person did not type: hand-backs and notices the engine folds in as prompts. */
const SKIP_PREFIXES = ['<agent-message', '<task-notification', '<system-reminder>'] as const

export const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

export const dateOf = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** The workday a moment belongs to, as `YYYY-MM-DD`, local time. */
export const workdayOf = (ms: number): string => {
  const at = new Date(ms)
  const day = at.getHours() < WORKDAY_START_HOUR ? new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1) : at

  return dateOf(day)
}

/** `2026-10-09T14:32:10.000+07:00`: local wall time with its offset. */
export const localIso = (ms: number): string => {
  const at = new Date(ms)
  const offset = -at.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`

  return `${dateOf(at)}T${time}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

export const isSkipped = (prompt: string): boolean => {
  const text = prompt.trim()

  return text === '' || SKIP_PREFIXES.some(prefix => text.startsWith(prefix))
}

export const head = (text: string, chars = TEXT_CHARS): string => text.slice(0, chars)

export const tail = (text: string, chars = TEXT_CHARS): string => (text.length <= chars ? text : text.slice(-chars))

export const shortenHome = (path: string, home: string): string => {
  if (path === home) return '~'

  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export const expandHome = (path: string, home: string): string => {
  if (path === '~') return home

  return path.startsWith('~/') ? `${home}${path.slice(1)}` : path
}

/** The config folder this session runs under: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export const configDirOf = (configured: string | undefined, home: string): string =>
  configured === undefined || configured.trim() === '' ? `${home}/.claude` : configured.replace(/\/+$/, '')

export const journalDir = (configDir: string): string => `${configDir}/journal`

export const entryPath = (configDir: string, day: string, sessionId: string): string =>
  `${journalDir(configDir)}/${day}/${sessionId}.jsonl`

export const encodeEntry = (entry: Entry): string => `${JSON.stringify(entry)}\n`

const isEntry = (value: unknown): value is Entry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>

  return (
    typeof entry.t === 'string' &&
    typeof entry.repo === 'string' &&
    typeof entry.prompt === 'string' &&
    typeof entry.answer === 'string' &&
    Array.isArray(entry.files) &&
    entry.files.every(file => typeof file === 'string') &&
    (entry.followUps === undefined ||
      (Array.isArray(entry.followUps) && entry.followUps.every(text => typeof text === 'string')))
  )
}

/** The entries of a journal file; a line that isn't one is skipped. */
export const parseEntries = (text: string): Entry[] =>
  text.split('\n').flatMap(line => {
    if (line.trim() === '') return []
    try {
      const value: unknown = JSON.parse(line)

      return isEntry(value) ? [value] : []
    } catch {
      return []
    }
  })

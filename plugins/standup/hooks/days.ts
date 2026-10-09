import { dateOf, pad, WORKDAY_START_HOUR } from './journal'

/** How long a day folder is kept. */
export const RETENTION_DAYS = 14

/** A day folder's name. */
export const DAY_NAME = /^\d{4}-\d{2}-\d{2}$/

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const partsOf = (day: string): [number, number, number] => {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)

  return [year, month, date]
}

export const addDays = (day: string, count: number): string => {
  const [year, month, date] = partsOf(day)

  return dateOf(new Date(year, month - 1, date + count))
}

/** Calendar days from `from` to `to`; UTC dates, so daylight saving moves nothing. */
export const daysBetween = (from: string, to: string): number => {
  const [a, b, c] = partsOf(from)
  const [x, y, z] = partsOf(to)

  return Math.round((Date.UTC(x, y - 1, z) - Date.UTC(a, b - 1, c)) / 86_400_000)
}

/** Day folders before today that are still kept, newest first: where "yesterday" is looked for. */
export const candidateDays = (today: string, names: readonly string[]): string[] =>
  names
    .filter(name => DAY_NAME.test(name) && name < today && daysBetween(name, today) <= RETENTION_DAYS)
    .sort()
    .reverse()

/** Day folders past retention; never a name that isn't a date. */
export const expiredDays = (today: string, names: readonly string[]): string[] =>
  names.filter(name => DAY_NAME.test(name) && daysBetween(name, today) > RETENTION_DAYS)

/** `git log` over one workday (4am to 4am), the person's own commits, as `<hash> <subject>`. */
export const gitLogArgv = (day: string, email: string): string[] => {
  const start = `T${pad(WORKDAY_START_HOUR)}:00:00`

  return ['git', 'log', `--since=${day}${start}`, `--until=${addDays(day, 1)}${start}`, `--author=${email}`, '--format=%h %s']
}

/** `Fri 9 Oct`. */
export const dayLabel = (day: string): string => {
  const [year, month, date] = partsOf(day)
  const weekday = WEEKDAYS[new Date(year, month - 1, date).getDay()] ?? ''

  return `${weekday} ${date} ${MONTHS[month - 1] ?? ''}`
}

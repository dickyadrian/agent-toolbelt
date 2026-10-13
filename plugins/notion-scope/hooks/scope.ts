/** The allowlist, from the project root. Never committed: `/notion-scope add` git-excludes it. */
export const ALLOWLIST = '.claude/notion-scope.local.txt'

/** What a new allowlist file starts with. */
export const HEADER = '# Notion pages Claude may touch in this project: one id or URL per line, # for comments.\n'

/** Tools that touch no page: they pass whatever ids they carry (a task's, an upload's). */
const UNSCOPED = new Set(['notion-create-file-upload', 'notion-get-async-task', 'notion-get-self'])

/** Tools whose result names new pages or databases, which then join the allowlist. */
const CREATES = new Set(['notion-create-pages', 'notion-duplicate-page', 'notion-create-database'])

/** Result fields that name what a create made. Never `properties` or content. */
const CREATED_FIELDS = ['id', 'url', 'page_id', 'page_url', 'database_id', 'data_source_id'] as const

/** Fields the engine adds to a call's input; not the tool's arguments. */
const ENGINE_FIELDS = new Set(['tool', 'tool_use_id', 'agentId'])

/**
 * A Notion id: 32 hex digits, dashed 8-4-4-4-12 or not, not inside a longer
 * hex run. One right after `user://` (a user mention) or `v=` (a database
 * view in a URL) is not a page.
 */
const ID = /(?<![0-9a-f])(?<!user:\/\/)(?<![?&]v=)[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?![0-9a-f])/gi

export const NO_IDS =
  'notion-scope: Notion access in this project is limited to specific pages, and this call names no page id. Search and list tools reach the whole workspace. Fetch an allowed page by its id or URL instead.'

export const outOfScope = (ids: readonly string[]): string =>
  `notion-scope: this call references page id(s) outside this project's Notion scope: ${ids.join(', ')}. If the task needs them, ask the user to run /notion-scope add <id>.`

export const WARNING = `notion-scope: no ${ALLOWLIST} in this project, so Notion calls are unscoped. /notion-scope add <url> to scope it.`

/** `3DF99635-E866-...` and `3df99635e866...` are one id. */
export const normalizeId = (id: string): string => id.replaceAll('-', '').toLowerCase()

/** Every page id in `text`, normalized, in first-seen order, without repeats. */
export const extractIds = (text: string): string[] => [...new Set(Array.from(text.matchAll(ID), match => normalizeId(match[0])))]

/** The ids a file allows: every id on each line once a `#` comment is cut off. */
export const parseAllowlist = (text: string): Set<string> =>
  new Set(text.split('\n').flatMap(line => extractIds(line.replace(/(^|\s)#.*$/, ''))))

/** The allowed ids with their labels, for a deny, so Claude can pick an allowed page. */
export const allowedPages = (text: string): string => {
  const entries = text.split('\n').flatMap(line => {
    const [, body = '', label = ''] = /^(.*?)(?:(?:^|\s)#\s*(.*))?$/.exec(line) ?? []

    return extractIds(body).map(id => (label.trim() === '' ? id : `${id} (${label.trim()})`))
  })

  return entries.length === 0 ? 'No pages are allowed yet.' : `Allowed pages: ${[...new Set(entries)].join(', ')}.`
}

/** `mcp__claude_ai_Notion__notion-fetch` is `notion-fetch`. */
export const toolNameOf = (tool: string): string => tool.slice(tool.lastIndexOf('__') + 2)

export const isUnscoped = (tool: string): boolean => UNSCOPED.has(toolNameOf(tool))
export const isCreate = (tool: string): boolean => CREATES.has(toolNameOf(tool))
export const isUpload = (tool: string): boolean => toolNameOf(tool) === 'notion-create-file-upload'

/** The tool's own arguments as one text to scan. */
export const argumentsText = (e: Readonly<Record<string, unknown>>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(e).filter(([key]) => !ENGINE_FIELDS.has(key))))

/** Why the call is refused, or undefined when it may go on. */
export const decide = (tool: string, ids: readonly string[], allowed: ReadonlySet<string>): string | undefined => {
  if (isUnscoped(tool)) return undefined
  if (ids.length === 0) return NO_IDS
  const outside = ids.filter(id => !allowed.has(id))

  return outside.length === 0 ? undefined : outOfScope(outside)
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const idsAt = (value: unknown, fields: readonly string[]): string[] => {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>

  return fields.flatMap(field => {
    const found = record[field]

    return typeof found === 'string' ? extractIds(found) : []
  })
}

/** The pages or databases a create made, from its result's id fields only. */
export const createdIds = (text: string): string[] => {
  const result = parse(text)
  const pages = (result as { pages?: unknown } | null | undefined)?.pages
  const items = [result, ...(Array.isArray(pages) ? pages : [])]

  return [...new Set(items.flatMap(item => idsAt(item, CREATED_FIELDS)))]
}

/** The upload a create-file-upload made, which the attachment call that follows names. */
export const uploadIds = (text: string): string[] => idsAt(parse(text), ['file_upload_id'])

const pad = (n: number) => String(n).padStart(2, '0')

/** The local day of `ms`, `yyyy-mm-dd`. */
export const dateOf = (ms: number): string => {
  const date = new Date(ms)

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const entryLine = (id: string, label: string): string => `${id}  # ${label}`

/** `text` with `lines` added, each on its own line. */
export const appendLines = (text: string, lines: readonly string[]): string =>
  (text === '' || text.endsWith('\n') ? text : `${text}\n`) + lines.map(line => `${line}\n`).join('')

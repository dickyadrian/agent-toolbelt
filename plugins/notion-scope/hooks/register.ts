import type { EngineInterface, Register } from 'claude-code'
import { atom, update } from 'claude-code'
import {
  ALLOWLIST,
  appendLines,
  argumentsText,
  createdIds,
  dateOf,
  decide,
  entryLine,
  extractIds,
  isCreate,
  isUpload,
  parseAllowlist,
  uploadIds,
  WARNING,
} from './scope'

/** Every tool of a server whose name holds "notion", the server part possibly holding single underscores. */
const NOTION = /^mcp__(?:(?!__).)*notion(?:(?!__).)*__/i

const isWarned = atom({ plugin: 'notion-scope', key: 'isWarned' } as const, false)
const minted = atom({ plugin: 'notion-scope', key: 'minted' } as const, [] as readonly string[])

/** Per load: the project root found for each cwd. */
export type Scope = { rootByCwd: Map<string, string> }

/** The git top level of the session's cwd, cached; the cwd itself outside a repo. */
export const rootOf = async ($: EngineInterface, scope: Scope): Promise<string> => {
  const cwd = await $.session.cwd()
  const known = scope.rootByCwd.get(cwd)
  if (known !== undefined) return known
  let root = cwd
  try {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 5000 })
    if (top.exitCode === 0 && top.stdout.trim() !== '') root = top.stdout.trim()
  } catch {
    // no git: the cwd is the project
  }
  scope.rootByCwd.set(cwd, root)

  return root
}

/** The file's text, or undefined when it doesn't exist. A file that exists but can't be read throws. */
export const readText = async ($: EngineInterface, path: string): Promise<string | undefined> =>
  (await $.fs.exists(path)) ? await $.fs.read(path) : undefined

/** True the first time it's called in a session. */
const isFirstWarning = async ($: EngineInterface): Promise<boolean> => {
  let wasWarned = false
  await update($, isWarned, value => {
    wasWarned = value

    return true
  })

  return !wasWarned
}

/** After an allowed call: keeps an upload's id for the session, and writes a create's new ids down. */
const remember = async ($: EngineInterface, path: string, tool: string, text: string): Promise<void> => {
  if (isUpload(tool)) {
    const ids = uploadIds(text)
    if (ids.length > 0) await update($, minted, known => [...new Set([...known, ...ids])])

    return
  }
  if (!isCreate(tool)) return
  const before = (await readText($, path)) ?? ''
  const known = parseAllowlist(before)
  const fresh = createdIds(text).filter(id => !known.has(id))
  if (fresh.length === 0) return
  const label = `created by Claude ${dateOf(await $.clock.now())}`
  await $.fs.write(path, appendLines(before, fresh.map(id => entryLine(id, label))))
}

export const register: Register = on => {
  const scope: Scope = { rootByCwd: new Map() }

  on('tool.call', { tool: NOTION }, async ($, e, next) => {
    const path = `${await rootOf($, scope)}/${ALLOWLIST}`
    const text = await readText($, path)
    if (text === undefined) {
      if (await isFirstWarning($)) $.ui.toast(WARNING, { timeoutMs: 8000 })

      return next(e)
    }
    const session = (await $.state.get({ plugin: 'notion-scope', key: 'minted' })).value ?? []
    const allowed = new Set([...parseAllowlist(text), ...session])
    const reason = decide(e.tool, extractIds(argumentsText(e)), allowed)
    if (reason !== undefined) return { deny: reason }

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || ran.text === undefined) return ran
    try {
      await remember($, path, e.tool, ran.text)
    } catch (error) {
      $.ui.toast(`notion-scope: could not add the new page to ${ALLOWLIST}: ${error instanceof Error ? error.message : String(error)}`)
    }

    return ran
  }).catch(($, e, next) =>
    // a scope guard that fails open does nothing, so a failed check denies (the repo's pass-through rule doesn't apply here)
    next.called
      ? next(e)
      : { deny: `notion-scope: the scope check failed (${next.error.message}), so the call was refused. Ask the user to check ${ALLOWLIST}.` },
  )
}

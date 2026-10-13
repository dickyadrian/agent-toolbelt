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
  HEADER,
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

const COMMAND = 'notion-scope'
const USAGE = 'Usage: /notion-scope add <url|id> [label]'

/** `git check-ignore` on the allowlist: 0 ignored, 1 not (tracked counts as not), else not a repo. */
const ignoreExitOf = async ($: EngineInterface, root: string): Promise<number> => {
  try {
    return (await $.process.run(['git', 'check-ignore', '-q', ALLOWLIST], { cwd: root, timeoutMs: 5000 })).exitCode
  } catch {
    return 128
  }
}

/** Adds the allowlist to the clone's own exclude file unless git already ignores it. True when it wrote. */
const exclude = async ($: EngineInterface, root: string): Promise<boolean> => {
  if ((await ignoreExitOf($, root)) !== 1) return false
  const common = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, timeoutMs: 5000 })
  if (common.exitCode !== 0) return false
  const path = `${common.stdout.trim()}/info/exclude`
  await $.fs.write(path, appendLines((await readText($, path)) ?? '', [`/${ALLOWLIST}`]))

  return true
}

const show = async ($: EngineInterface, root: string): Promise<string> => {
  const path = `${root}/${ALLOWLIST}`
  const text = await readText($, path)
  if (text === undefined) {
    return `notion-scope: off in this project (no ${ALLOWLIST}), so Notion calls are unscoped.\n${USAGE} turns it on.`
  }
  const lines = text.split('\n').filter(line => line.trim() !== '')
  const warning =
    (await ignoreExitOf($, root)) === 1 ? `\nWarning: git would commit ${ALLOWLIST}. Add /${ALLOWLIST} to .git/info/exclude.` : ''

  return [`notion-scope: on in this project, ${parseAllowlist(text).size} page(s) allowed.`, `Allowlist: ${path}`, '', ...lines].join('\n') + warning
}

const add = async ($: EngineInterface, root: string, args: string): Promise<string> => {
  const [target = '', ...words] = args.split(/\s+/).filter(word => word !== '')
  const ids = extractIds(target)
  if (ids.length === 0) return USAGE
  const path = `${root}/${ALLOWLIST}`
  const before = await readText($, path)
  const known = parseAllowlist(before ?? '')
  const fresh = ids.filter(id => !known.has(id))
  if (fresh.length === 0) return `notion-scope: ${ids.join(', ')} is already allowed.`
  const label = words.join(' ')
  await $.fs.write(path, appendLines(before ?? HEADER, fresh.map(id => (label === '' ? id : entryLine(id, label)))))
  if (before !== undefined) return `notion-scope: allowed ${fresh.join(', ')}.`
  const excluded = await exclude($, root)

  return `notion-scope: created ${path} and allowed ${fresh.join(', ')}.${excluded ? ' Added it to .git/info/exclude so it stays out of commits.' : ''}`
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

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or extend the Notion pages this project allows',
      argumentHint: '[add <url|id> [label]]',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const root = await rootOf($, scope)
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)

    return { text: verb === 'add' ? await add($, root, rest.join(' ')) : verb === '' ? await show($, root) : USAGE }
  }).catch(($, e, next) => ({ text: `notion-scope: ${next.error.message}` }))
}

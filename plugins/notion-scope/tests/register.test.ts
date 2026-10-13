import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

const REPO = '/Users/me/code/app'
const FILE = `${REPO}/.claude/notion-scope.local.txt`
const PAGE = '3df99635e86680e491fec984efbb7057'
const OTHER = '3e299635e866809dadb2d84aa544ac43'
const NEW = '3e399635e86680e491fec984efbb7057'
const WARNING_START = 'notion-scope: no .claude/notion-scope.local.txt'

type World = {
  files: Map<string, string>
  toasts: string[]
  runs: string[][]
  /** What the engine's part of each Notion call answers, by short tool name. */
  answers: Map<string, { text: string; isError?: boolean }>
  /** `git check-ignore` exit code: 0 ignored, 1 not ignored, 128 not a repo. */
  ignoreExit: number
  isRepo: boolean
  readFails: boolean
}

/** Stands in for the engine beneath the plugin: session, disk, git, toasts and the Notion server. */
const engine = (on: On, options: Partial<Pick<World, 'ignoreExit' | 'isRepo'>> & { files?: Record<string, string> } = {}): World => {
  const world: World = {
    files: new Map(Object.entries(options.files ?? {})),
    toasts: [],
    runs: [],
    answers: new Map(),
    ignoreExit: options.ignoreExit ?? 1,
    isRepo: options.isRepo ?? true,
    readFails: false,
  }
  mock.clock(on, { now: new Date(2026, 9, 13, 10, 0).getTime() })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: REPO }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: world.files.has(e.path) }))
  on('fs.read', ($, e) => {
    const text = world.files.get(e.path)
    if (world.readFails) return { deny: `EACCES: ${e.path}` }

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    world.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    world.runs.push(argv)
    const result = (exitCode: number, stdout = '') => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (!world.isRepo) return result(128)
    if (argv.includes('--show-toplevel')) return result(0, `${REPO}\n`)
    if (argv.includes('--git-common-dir')) return result(0, `${REPO}/.git\n`)
    if (argv[1] === 'check-ignore') return result(world.ignoreExit)

    return result(1)
  })
  on('tool.call', ($, e) => {
    const answer = world.answers.get(e.tool.slice(e.tool.lastIndexOf('__') + 2)) ?? { text: '{}' }

    return { result: {}, text: answer.text, isError: answer.isError } as never
  })

  return world
}

const start = ($: Engine) => $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })

const call = ($: Engine, tool: string, args: Record<string, unknown> = {}) =>
  $.tool.call({ tool, tool_use_id: `${tool}:${JSON.stringify(args)}`, ...args } as never)

const isDenied = (ran: { deny?: string }) => ran.deny !== undefined

describe('no allowlist', () => {
  test('lets Notion calls through and warns once per session', async ($, on) => {
    const world = engine(on)
    await start($)

    expect(isDenied(await call($, 'mcp__notion__notion-search', { query: 'x' }))).toBe(false)
    expect(isDenied(await call($, 'mcp__notion__notion-fetch', { id: OTHER }))).toBe(false)
    expect(world.toasts.filter(text => text.startsWith(WARNING_START))).toHaveLength(1)
  })

  test('never warns in a session that makes no Notion call', async ($, on) => {
    const world = engine(on)
    await start($)
    await call($, 'mcp__linear__search', { query: 'x' })

    expect(world.toasts).toEqual([])
  })

  test('a created page does not create the file', async ($, on) => {
    const world = engine(on)
    world.answers.set('notion-create-pages', { text: JSON.stringify({ pages: [{ id: NEW }] }) })
    await start($)
    await call($, 'mcp__notion__notion-create-pages', { parent: { page_id: PAGE } })

    expect(world.files.has(FILE)).toBe(false)
  })
})

describe('with an allowlist', () => {
  const files = { [FILE]: `# scope\n${PAGE}\n` }

  test('guards both spellings of the Notion server and nothing else', async ($, on) => {
    engine(on, { files })
    await start($)

    expect(isDenied(await call($, 'mcp__claude_ai_Notion__notion-search', { query: 'x' }))).toBe(true)
    expect(isDenied(await call($, 'mcp__notion__notion-search', { query: 'x' }))).toBe(true)
    expect(isDenied(await call($, 'mcp__linear__notion-search', { query: 'x' }))).toBe(false)
  })

  test('denies a call naming no page', async ($, on) => {
    engine(on, { files })
    await start($)
    const ran = await call($, 'mcp__notion__notion-search', { query: 'Agentic Observability' })

    expect(ran.deny).toContain('names no page id')
  })

  test('denies a page outside the allowlist, naming it', async ($, on) => {
    engine(on, { files })
    await start($)
    const ran = await call($, 'mcp__notion__notion-fetch', { id: `https://www.notion.so/x-${OTHER}` })

    expect(ran.deny).toContain(OTHER)
  })

  test('allows an allowed page, as id or URL', async ($, on) => {
    engine(on, { files })
    await start($)

    expect(isDenied(await call($, 'mcp__notion__notion-fetch', { id: PAGE }))).toBe(false)
    expect(isDenied(await call($, 'mcp__notion__notion-fetch', { id: `https://www.notion.so/Exploration-${PAGE}` }))).toBe(false)
  })

  test('an update mentioning a user is not denied for the mention', async ($, on) => {
    engine(on, { files })
    await start($)
    const ran = await call($, 'mcp__notion__notion-update-page', {
      page_id: PAGE,
      command: 'update_content',
      content_updates: [{ old_str: 'a', new_str: `<mention-user url="user://${OTHER}"/>` }],
    })

    expect(isDenied(ran)).toBe(false)
  })

  test('reads the file on every call, so an edit applies at once', async ($, on) => {
    const world = engine(on, { files })
    await start($)
    expect(isDenied(await call($, 'mcp__notion__notion-fetch', { id: OTHER }))).toBe(true)
    world.files.set(FILE, `${PAGE}\n${OTHER}\n`)

    expect(isDenied(await call($, 'mcp__notion__notion-fetch', { id: OTHER }))).toBe(false)
  })

  test('an allowlist with only comments is on and denies everything', async ($, on) => {
    const world = engine(on, { files: { [FILE]: '# nothing yet\n' } })
    await start($)

    expect(isDenied(await call($, 'mcp__notion__notion-fetch', { id: PAGE }))).toBe(true)
    expect(world.toasts).toEqual([])
  })

  test('denies when the allowlist cannot be read', async ($, on) => {
    const world = engine(on, { files })
    world.readFails = true
    await start($)
    const ran = await call($, 'mcp__notion__notion-fetch', { id: PAGE })

    expect(ran.deny).toContain('notion-scope: the scope check failed')
  })
})

describe('created pages', () => {
  const files = { [FILE]: `${PAGE}\n` }

  test('a page created under an allowed parent joins the allowlist', async ($, on) => {
    const world = engine(on, { files })
    world.answers.set('notion-create-pages', {
      text: JSON.stringify({ pages: [{ id: NEW, url: `https://www.notion.so/${NEW}`, properties: { title: 'x' } }] }),
    })
    await start($)
    await call($, 'mcp__notion__notion-create-pages', { parent: { page_id: PAGE }, pages: [{ properties: { title: 'x' } }] })

    expect(world.files.get(FILE)).toBe(`${PAGE}\n${NEW}  # created by Claude 2026-10-13\n`)
    expect(isDenied(await call($, 'mcp__notion__notion-update-page', { page_id: NEW, command: 'replace_content' }))).toBe(false)
  })

  test('a create with no parent is denied and appends nothing', async ($, on) => {
    const world = engine(on, { files })
    await start($)
    const ran = await call($, 'mcp__notion__notion-create-pages', { pages: [{ properties: { title: 'x' } }] })

    expect(isDenied(ran)).toBe(true)
    expect(world.files.get(FILE)).toBe(`${PAGE}\n`)
  })

  test('a failed create appends nothing', async ($, on) => {
    const world = engine(on, { files })
    world.answers.set('notion-create-pages', { text: JSON.stringify({ pages: [{ id: NEW }] }), isError: true })
    await start($)
    await call($, 'mcp__notion__notion-create-pages', { parent: { page_id: PAGE } })

    expect(world.files.get(FILE)).toBe(`${PAGE}\n`)
  })

  test('a result that is not JSON reaches the model unchanged and appends nothing', async ($, on) => {
    const world = engine(on, { files })
    world.answers.set('notion-create-pages', { text: `Created ${NEW}` })
    await start($)
    const ran = await call($, 'mcp__notion__notion-create-pages', { parent: { page_id: PAGE } })

    expect(ran.text).toBe(`Created ${NEW}`)
    expect(world.files.get(FILE)).toBe(`${PAGE}\n`)
  })

  test('an id already listed is not appended again', async ($, on) => {
    const world = engine(on, { files })
    world.answers.set('notion-duplicate-page', { text: JSON.stringify({ page_id: PAGE }) })
    await start($)
    await call($, 'mcp__notion__notion-duplicate-page', { page_id: PAGE })

    expect(world.files.get(FILE)).toBe(`${PAGE}\n`)
  })

  test('an upload id is allowed for the rest of the session, not written down', async ($, on) => {
    const world = engine(on, { files })
    world.answers.set('notion-create-file-upload', { text: JSON.stringify({ file_upload_id: OTHER, filename: 'a.png' }) })
    await start($)
    expect(isDenied(await call($, 'mcp__notion__notion-create-file-upload', { filename: 'a.png' }))).toBe(false)

    expect(isDenied(await call($, 'mcp__notion__notion-create-attachment', { page_id: PAGE, file_upload_id: OTHER }))).toBe(false)
    expect(world.files.get(FILE)).toBe(`${PAGE}\n`)
  })
})

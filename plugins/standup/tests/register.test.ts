import type { ModelCompleteResult, On, TurnUsage } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

const HOME = '/Users/me'
const REPO = '/Users/me/code/app'
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

const TURN_USAGE: TurnUsage = {
  model: 'claude-opus-5-5',
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}
const MODEL_USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const DRAFT = 'Yesterday\n- app: fixed the login bug\nToday\n- app: add a test\nBlockers\n- none'

type World = { clock: MockClock; files: Map<string, string>; runs: string[][]; prompts: string[] }

/** Stands in for the engine beneath the plugin: env, session, an in-memory disk, git, and the model. */
const engine = (
  on: On,
  options: { now?: number; configDir?: string; files?: Record<string, string>; reply?: 'draft' | 'empty' } = {},
): World => {
  const world: World = {
    clock: mock.clock(on, { now: options.now ?? at(9, 14, 32) }),
    files: new Map(Object.entries(options.files ?? {})),
    runs: [],
    prompts: [],
  }
  mock.env(on, options.configDir === undefined ? { HOME } : { HOME, CLAUDE_CONFIG_DIR: options.configDir })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: REPO }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('tool.call', () => ({ result: {} }) as never)

  const isDir = (path: string) => [...world.files.keys()].some(file => file.startsWith(`${path}/`))
  on('fs.exists', ($, e) => ({ value: world.files.has(e.path) || isDir(e.path) }))
  on('fs.read', ($, e) => {
    const text = world.files.get(e.path)

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    world.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of world.files.keys()) {
      if (!path.startsWith(`${e.path}/`)) continue
      const [name, ...rest] = path.slice(e.path.length + 1).split('/')
      if (name !== undefined) names.set(name, rest.length === 0 ? 'file' : 'dir')
    }

    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    world.runs.push(argv)
    const result = (exitCode: number, stdout: string) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return result(0, `${REPO}\n`)
    if (argv[0] === 'git' && argv[1] === 'config') return result(0, 'me@example.com\n')
    if (argv[0] === 'git' && argv[1] === 'log') {
      return result(0, argv[2] === '--since=2026-10-08T04:00:00' ? 'abc1234 fix login\n' : '')
    }
    if (argv[0] === 'rm') {
      const dir = argv[2] ?? ''
      for (const path of [...world.files.keys()]) if (path.startsWith(`${dir}/`)) world.files.delete(path)

      return result(0, '')
    }

    return result(1, '')
  })
  on('model.complete', ($, e) => {
    world.prompts.push(typeof e.prompt === 'string' ? e.prompt : '')
    const reply: ModelCompleteResult =
      options.reply === 'empty'
        ? { isAnswered: false, reason: 'empty-reply', usage: MODEL_USAGE }
        : { isAnswered: true, text: DRAFT, usage: MODEL_USAGE }

    return { value: reply }
  })

  return world
}

const start = ($: Engine) => $.session.start({ cwd: REPO, surface: 'terminal', isInteractive: true })

/** One typed turn: its edits, its subagent's edits, then its end. */
const turn = async (
  $: Engine,
  world: World,
  turnId: string,
  text: string,
  options: { edits?: string[]; subagentEdits?: string[]; answer?: string } = {},
) => {
  await $.turn.start({ text, turnId })
  for (const path of options.edits ?? []) {
    await $.tool.call({ tool: 'Edit', tool_use_id: `${turnId}:${path}`, file_path: path, old_string: 'a', new_string: 'b' })
  }
  // the mod files edits by when they happen, not by which loop made them: a subagent's
  // call during the turn reaches tool.call like the main loop's
  for (const path of options.subagentEdits ?? []) {
    await $.tool.call({ tool: 'Write', tool_use_id: `${turnId}:sub:${path}`, file_path: path, content: 'x' })
  }
  await $.turn.complete({
    turnId,
    answer: options.answer ?? 'Done.',
    durationMs: 1000,
    isAborted: false,
    reason: 'answer',
    usage: TURN_USAGE,
  })
  await world.clock.settle()
}

const journalOf = (configDir: string, day: string) => `${configDir}/journal/${day}/session-1.jsonl`

const linesOf = (world: World, path: string): Record<string, unknown>[] =>
  (world.files.get(path) ?? '')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)

describe('recording', () => {
  test("writes a typed turn to this config's journal under its workday", async ($, on) => {
    const world = engine(on)
    await start($)
    await turn($, world, 't1', 'fix the login bug', { edits: [`${REPO}/login.ts`], answer: 'Fixed it.' })

    const [entry] = linesOf(world, journalOf(`${HOME}/.claude`, '2026-10-09'))
    expect(entry).toMatchObject({
      repo: '~/code/app',
      prompt: 'fix the login bug',
      files: ['~/code/app/login.ts'],
      answer: 'Fixed it.',
    })
    expect(String(entry?.t).startsWith('2026-10-09T14:32')).toBe(true)
  })

  test('uses CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
    const world = engine(on, { configDir: `${HOME}/.claude-work` })
    await start($)
    await turn($, world, 't1', 'fix the login bug')

    expect(linesOf(world, journalOf(`${HOME}/.claude-work`, '2026-10-09')).length).toBe(1)
    expect(world.files.has(journalOf(`${HOME}/.claude`, '2026-10-09'))).toBe(false)
  })

  test('files a turn after midnight under the previous workday', async ($, on) => {
    const world = engine(on, { now: at(10, 1, 30) })
    await start($)
    await turn($, world, 't1', 'late fix')

    expect(linesOf(world, journalOf(`${HOME}/.claude`, '2026-10-09')).length).toBe(1)
  })

  test('keeps a session that runs past 4am in both days', async ($, on) => {
    const world = engine(on)
    await start($)
    await turn($, world, 't1', 'first day')
    await world.clock.set(at(10, 9))
    await turn($, world, 't2', 'second day')

    expect(linesOf(world, journalOf(`${HOME}/.claude`, '2026-10-09')).map(line => line.prompt)).toEqual(['first day'])
    expect(linesOf(world, journalOf(`${HOME}/.claude`, '2026-10-10')).map(line => line.prompt)).toEqual(['second day'])
  })

  test("adds a subagent's edits to the main turn", async ($, on) => {
    const world = engine(on)
    await start($)
    await turn($, world, 't1', 'refactor auth', { edits: [`${REPO}/a.ts`], subagentEdits: [`${REPO}/b.ts`] })

    expect(linesOf(world, journalOf(`${HOME}/.claude`, '2026-10-09'))[0]?.files).toEqual(['~/code/app/a.ts', '~/code/app/b.ts'])
  })

  test('carries edits made between turns to the next turn', async ($, on) => {
    const world = engine(on)
    await start($)
    await turn($, world, 't1', 'start the agent')
    await $.tool.call({ tool: 'Write', tool_use_id: 'late', file_path: `${REPO}/late.ts`, content: 'x' })
    await turn($, world, 't2', 'check its work')

    const lines = linesOf(world, journalOf(`${HOME}/.claude`, '2026-10-09'))
    expect(lines[0]?.files).toEqual([])
    expect(lines[1]?.files).toEqual(['~/code/app/late.ts'])
  })

  test('writes nothing for turns the person did not type', async ($, on) => {
    const world = engine(on)
    await start($)
    await turn($, world, 't1', '<agent-message from="a1">done</agent-message>')
    await turn($, world, 't2', '   ')

    expect(world.files.has(journalOf(`${HOME}/.claude`, '2026-10-09'))).toBe(false)
  })

  test('keeps the first 300 characters of a prompt and the last 300 of an answer', async ($, on) => {
    const world = engine(on)
    await start($)
    await turn($, world, 't1', 'p'.repeat(400), { answer: `${'x'.repeat(400)}END` })

    const [entry] = linesOf(world, journalOf(`${HOME}/.claude`, '2026-10-09'))
    expect(String(entry?.prompt).length).toBe(300)
    expect(String(entry?.answer).length).toBe(300)
    expect(String(entry?.answer).endsWith('END')).toBe(true)
  })
})

describe('retention', () => {
  test('deletes day folders older than 14 days at session start', async ($, on) => {
    const dir = `${HOME}/.claude/journal`
    const world = engine(on, {
      files: {
        [`${dir}/2026-09-24/s.jsonl`]: '',
        [`${dir}/2026-09-25/s.jsonl`]: '',
        [`${dir}/notes/keep.md`]: '',
      },
    })
    await start($)

    expect(world.runs.filter(argv => argv[0] === 'rm')).toEqual([['rm', '-r', `${dir}/2026-09-24`]])
    expect(world.files.has(`${dir}/2026-09-25/s.jsonl`)).toBe(true)
    expect(world.files.has(`${dir}/notes/keep.md`)).toBe(true)
  })
})
const runStandup = ($: Engine) =>
  $.command.run({
    command: 'standup',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

const line = (day: string, prompt: string) =>
  `${JSON.stringify({ t: `${day}T15:00:00.000+07:00`, repo: '~/code/app', prompt, files: [], answer: 'Done.' })}\n`

describe('/standup', () => {
  test('drafts from the last working day with its commits', async ($, on) => {
    const world = engine(on, {
      now: at(9, 9),
      files: {
        [journalOf(`${HOME}/.claude`, '2026-10-08')]: line('2026-10-08', 'fix the login bug'),
        [journalOf(`${HOME}/.claude`, '2026-10-09')]: line('2026-10-09', 'add a test for login'),
      },
    })
    await start($)
    const { text } = await runStandup($)

    expect(text?.startsWith('Standup (Yesterday = Thu 8 Oct)\n\n')).toBe(true)
    expect(text).toContain('- app: fixed the login bug')
    expect(world.prompts[0]).toContain('abc1234 fix login')
    expect(world.prompts[0]).toContain('fix the login bug')
    expect(world.prompts[0]).toContain('add a test for login')
  })

  test('skips days without entries back to the last working day', async ($, on) => {
    engine(on, {
      now: at(5, 9),
      files: { [journalOf(`${HOME}/.claude`, '2026-10-02')]: line('2026-10-02', 'ship the release') },
    })
    await start($)

    expect((await runStandup($)).text?.startsWith('Standup (Yesterday = Fri 2 Oct)')).toBe(true)
  })

  test('prints the raw journal when the model gives no draft', async ($, on) => {
    engine(on, {
      now: at(9, 9),
      reply: 'empty',
      files: { [journalOf(`${HOME}/.claude`, '2026-10-08')]: line('2026-10-08', 'fix the login bug') },
    })
    await start($)
    const { text } = await runStandup($)

    expect(text?.split('\n')[0]).toBe('Could not draft with the model (empty-reply). Raw journal:')
    expect(text).toContain('    commit abc1234 fix login')
    expect(text).toContain('    - fix the login bug')
  })

  test('says so when the journal is empty, without a model call', async ($, on) => {
    const world = engine(on, { now: at(9, 9) })
    await start($)

    expect((await runStandup($)).text).toBe('Nothing in the journal for the last 14 days.')
    expect(world.prompts).toEqual([])
  })

  test("reads only this config's journal", async ($, on) => {
    engine(on, {
      now: at(9, 9),
      configDir: `${HOME}/.claude-work`,
      files: { [journalOf(`${HOME}/.claude`, '2026-10-08')]: line('2026-10-08', 'personal project') },
    })
    await start($)

    expect((await runStandup($)).text).toBe('Nothing in the journal for the last 14 days.')
  })
})

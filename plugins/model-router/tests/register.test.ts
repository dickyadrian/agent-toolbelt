import type { AgentInfo, HttpResponse, On, SessionRateLimit, TurnUsage } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { TurnRecord } from '../hooks/record'

const NOW = new Date('2026-10-08T11:00:00Z').getTime()
const HOME = '/Users/me'
const SESSION = 'session-1'
const OPUS = 'claude-opus-5-5'
const JEV = { MODEL_ROUTER_JEV_KEY: 'test-key' }

const usage = (input: number, output: number): TurnUsage => ({
  model: OPUS,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 10,
})

const PROBABILITIES = { trivial: 0.1, normal: 0.2, hard: 0.7 }

const decision = (choice: string): HttpResponse => ({
  status: 200,
  ok: true,
  headers: {},
  text: JSON.stringify({
    model: 'typesafe-ai/jev',
    answers: { tier: { type: 'choice', choice, probabilities: PROBABILITIES } },
    usage: { inputTokens: 275, outputTokens: 20 },
  }),
})

type World = {
  clock: MockClock
  writes: { path: string; text: string }[]
  fetches: { url: string; headers: Record<string, string>; body: string }[]
  classified: string[]
  toasts: string[]
  rateLimits: SessionRateLimit[]
}

/**
 * Stands in for the engine beneath the plugin: env, clock, session, Jev, the
 * built-in classifier, the disk, and the turn events' bottoms.
 */
const engine = (
  on: On,
  options: {
    env?: Record<string, string>
    jev?: (world: World) => Promise<HttpResponse> | HttpResponse
    builtin?: string
    agents?: Partial<AgentInfo>[]
  } = {},
): World => {
  const world: World = {
    clock: mock.clock(on, { now: NOW }),
    writes: [],
    fetches: [],
    classified: [],
    toasts: [],
    rateLimits: [{ kind: 'five_hour', percentUsed: 40 }],
  }
  mock.env(on, { HOME, ...options.env })
  on('session.id', () => ({ value: SESSION }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: world.rateLimits },
  }))
  on('agent.list', () => ({ value: (options.agents ?? []) as AgentInfo[] }))
  on('fs.write', ($, e) => {
    world.writes.push({ path: e.path, text: e.text })

    return { value: undefined }
  })
  on('http.fetch', async ($, e) => {
    world.fetches.push({
      url: e.url,
      headers: (e.init?.headers ?? {}) as Record<string, string>,
      body: e.init?.body ?? '',
    })

    return { value: await (options.jev ?? (() => decision('hard')))(world) }
  })
  on('model.classify', ($, e) => {
    world.classified.push(e.text)

    return { value: options.builtin ?? 'trivial' }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('fs.exists', ($, e) => ({ value: world.writes.some(w => w.path.startsWith(`${e.path}/`)) }))
  on('fs.list', ($, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const { path } of world.writes) {
      if (!path.startsWith(`${e.path}/`)) continue
      const [name, ...rest] = path.slice(e.path.length + 1).split('/')
      if (name !== undefined) names.set(name, rest.length === 0 ? 'file' : 'dir')
    }
    const entries = [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false }))

    return { value: entries }
  })
  on('fs.read', ($, e) => {
    const write = world.writes.find(w => w.path === e.path)

    return write === undefined ? { deny: `ENOENT: ${e.path}` } : { value: write.text }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'Reading the file.' }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'Reading the file.',
      toolUses: [{ id: `tool-${e.index}`, name: 'Read', input: {} }],
      stopReason: 'tool_use',
      usage: usage(100, 20),
    }
  })
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))

  return world
}

/** Runs one main turn of `steps` model requests, and lets its record be written. */
const turn = async (
  $: Engine,
  world: World,
  turnId: string,
  text: string,
  options: { steps?: number; answer?: string } = {},
) => {
  await $.turn.start({ text, turnId })
  for (let index = 0; index < (options.steps ?? 1); index++) {
    await drain($, { turnId, index, model: OPUS, effort: 'high', messageCount: 3 + index })
  }
  world.rateLimits = [{ kind: 'five_hour', percentUsed: 41.5 }]
  await $.turn.complete({
    turnId,
    answer: options.answer ?? 'Done.',
    durationMs: 1200,
    isAborted: false,
    reason: 'answer',
    usage: usage(200, 40),
  })
  await world.clock.settle()
}

const drain = async ($: Engine, e: Parameters<Engine['turn']['step']>[0]) => {
  const stream = $.turn.step(e)
  const chunks: unknown[] = []
  for (;;) {
    const item = await stream.next()
    if (item.done) return { chunks, result: item.value }
    chunks.push(item.value)
  }
}

const written = (world: World, turnId: string): TurnRecord => {
  const write = world.writes.find(w => w.path === `${HOME}/.claude/model-router/turns/${SESSION}/${turnId}.json`)
  if (write === undefined) throw new Error(`no record written for ${turnId}`)

  return JSON.parse(write.text) as TurnRecord
}

describe('turn records', () => {
  test('writes a main turn with its steps, usage and the quota around it', async ($, on) => {
    const world = engine(on, { env: JEV })
    await turn($, world, 't1', 'rename foo to bar', { steps: 2 })

    const record = written(world, 't1')
    expect(record).toMatchObject({
      version: 1,
      sessionId: SESSION,
      turnId: 't1',
      agent: null,
      startedAt: '2026-10-08T10:59:58.800Z',
      durationMs: 1200,
      reason: 'answer',
      prompt: 'rename foo to bar',
      quota: { before: { five_hour: 40 }, after: { five_hour: 41.5 } },
      usage: { model: OPUS, input_tokens: 200, output_tokens: 40 },
    })
    expect(record.steps).toEqual([
      {
        index: 0,
        model: OPUS,
        effort: 'high',
        messageCount: 3,
        stopReason: 'tool_use',
        tools: ['Read'],
        usage: {
          model: OPUS,
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 10,
        },
      },
      expect.objectContaining({ index: 1, messageCount: 4 }),
    ])
  })

  test('passes the model stream through untouched', async ($, on) => {
    engine(on)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    const { chunks, result } = await drain($, { turnId: 't1', index: 0, model: OPUS, messageCount: 1 })

    expect(chunks).toEqual([{ kind: 'text', index: 0, text: 'Reading the file.' }])
    expect(result).toMatchObject({ answer: 'Reading the file.', stopReason: 'tool_use' })
  })

  test('keeps only the first 500 characters of the prompt', async ($, on) => {
    const world = engine(on)
    await turn($, world, 't1', 'p'.repeat(800))

    expect(written(world, 't1').prompt).toHaveLength(500)
  })

  test('writes a subagent run under the main turn that was running', async ($, on) => {
    const world = engine(on, { agents: [{ id: 'agent-1', type: 'Explore' }] })
    await $.turn.start({ text: 'find the parser', turnId: 't1' })
    await drain($, { turnId: 'run-1', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'agent-1' })
    await $.turn.complete({
      turnId: 'run-1',
      agentId: 'agent-1',
      answer: 'It is in src/parser.ts.',
      durationMs: 300,
      isAborted: false,
      reason: 'answer',
    })
    await world.clock.settle()

    const record = written(world, 'run-1')
    expect(record).toMatchObject({
      agent: { id: 'agent-1', type: 'Explore', parentTurnId: 't1' },
      prompt: null,
      classification: null,
      quota: null,
      usage: null,
    })
    expect(record.steps).toEqual([expect.objectContaining({ model: 'claude-haiku-5-5' })])
  })

  test('classifies nothing for a turn with no prompt', async ($, on) => {
    const world = engine(on, { env: JEV })
    await turn($, world, 't1', '')

    expect(written(world, 't1').classification).toBeNull()
    expect(world.fetches).toEqual([])
    expect(world.classified).toEqual([])
  })
})

describe('classifier', () => {
  test('asks Jev when it has a key', async ($, on) => {
    const world = engine(on, { env: JEV })
    await turn($, world, 't1', 'design the cache layer')

    expect(written(world, 't1').classification).toEqual({
      tier: 'hard',
      source: 'jev',
      probabilities: PROBABILITIES,
      zeroRetention: false,
      latencyMs: 0,
    })
    expect(world.fetches).toHaveLength(1)
    expect(world.fetches[0]?.url).toBe('https://ai-gateway.vercel.sh/v1/evaluate')
    expect(world.fetches[0]?.headers.authorization).toBe('Bearer test-key')
    const body = JSON.parse(world.fetches[0]?.body ?? '{}')
    expect(body).toMatchObject({ model: 'typesafe-ai/jev', state: { prompt: 'design the cache layer' } })
    expect(body.providerOptions).toBeUndefined()
    expect(world.classified).toEqual([])
  })

  test('requires zero data retention when it is switched on', async ($, on) => {
    const world = engine(on, { env: { ...JEV, MODEL_ROUTER_JEV_ZERO_RETENTION: 'on' } })
    await turn($, world, 't1', 'hi')

    expect(JSON.parse(world.fetches[0]?.body ?? '{}').providerOptions).toEqual({
      gateway: { zeroDataRetention: true },
    })
    expect(written(world, 't1').classification).toMatchObject({ source: 'jev', zeroRetention: true })
  })

  test('uses the built-in classifier when Jev is switched off', async ($, on) => {
    const world = engine(on, { env: { ...JEV, MODEL_ROUTER_JEV: 'off' } })
    await turn($, world, 't1', 'rename foo to bar')

    expect(written(world, 't1').classification).toEqual({ tier: 'trivial', source: 'builtin', latencyMs: 0 })
    expect(world.fetches).toEqual([])
  })

  test('uses the built-in classifier when Jev has no key', async ($, on) => {
    const world = engine(on, { env: { MODEL_ROUTER_JEV: 'on' } })
    await turn($, world, 't1', 'rename foo to bar')

    expect(written(world, 't1').classification).toEqual({ tier: 'trivial', source: 'builtin', latencyMs: 0 })
    expect(world.fetches).toEqual([])
    expect(world.toasts).toEqual([])
  })

  test('falls back with the gateway\'s own message when Jev refuses the request', async ($, on) => {
    const world = engine(on, {
      env: { ...JEV, MODEL_ROUTER_JEV_ZERO_RETENTION: 'on' },
      jev: () => ({
        status: 400,
        ok: false,
        headers: {},
        text: JSON.stringify({ error: { message: 'No provider offers zero data retention for this model' } }),
      }),
    })
    await turn($, world, 't1', 'rename foo to bar')

    expect(written(world, 't1').classification).toEqual({
      tier: 'trivial',
      source: 'builtin',
      latencyMs: 0,
      zeroRetention: true,
      jevError: 'HTTP 400: No provider offers zero data retention for this model',
    })
    expect(world.toasts).toEqual([
      'model-router: Jev failed with zero data retention on (HTTP 400: No provider offers zero data retention for this model), using the built-in classifier',
    ])
  })

  test('falls back when Jev chooses no tier', async ($, on) => {
    const world = engine(on, { env: JEV, jev: () => decision('it depends') })
    await turn($, world, 't1', 'rename foo to bar')

    expect(written(world, 't1').classification).toMatchObject({
      source: 'builtin',
      jevError: expect.stringContaining('unrecognized answer'),
    })
  })

  test('falls back when Jev takes longer than 5 seconds, without holding up the turn', async ($, on) => {
    const world = engine(on, {
      env: JEV,
      jev: async ({ clock }) => {
        await clock.sleep(60_000)

        return decision('hard')
      },
    })
    await $.turn.start({ text: 'rename foo to bar', turnId: 't1' })
    await $.turn.complete({ turnId: 't1', answer: '', durationMs: 10, isAborted: false, reason: 'answer' })
    await world.clock.settle()
    expect(world.writes).toEqual([])

    await world.clock.advance(5000)
    expect(written(world, 't1').classification).toEqual({
      tier: 'trivial',
      source: 'builtin',
      latencyMs: 5000,
      zeroRetention: false,
      jevError: 'timed out after 5000ms',
    })
  })

  test('records a failure of both classifiers as no tier', async ($, on) => {
    const world = engine(on, { env: JEV, jev: () => decision('?'), builtin: 'unsure' })
    await turn($, world, 't1', 'rename foo to bar')

    expect(written(world, 't1').classification).toMatchObject({
      tier: null,
      source: null,
      error: 'no tier named',
    })
  })

  test('toasts the first Jev failure of the session only', async ($, on) => {
    const world = engine(on, { env: JEV, jev: () => ({ status: 401, ok: false, headers: {}, text: '' }) })
    await turn($, world, 't1', 'one')
    await turn($, world, 't2', 'two')

    expect(world.toasts).toEqual(['model-router: Jev failed (HTTP 401), using the built-in classifier'])
  })

  test('gives a follow-up the end of the previous answer as context', async ($, on) => {
    const world = engine(on, { env: JEV })
    await turn($, world, 't1', 'look at the parser', { answer: 'Shall I rewrite the tokenizer?' })
    await turn($, world, 't2', 'yes')

    expect(JSON.parse(world.fetches[1]?.body ?? '{}').state).toEqual({
      prompt: 'yes',
      previousReply: 'Shall I rewrite the tokenizer?',
    })
  })
})

describe('/model-router', () => {
  const run = ($: Engine, args: string) =>
    $.command.run({
      command: 'model-router',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })

  test('reports on the turns logged so far', async ($, on) => {
    const world = engine(on, { env: JEV })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await turn($, world, 't1', 'design the cache layer')
    await turn($, world, 't2', 'yes')

    const { text } = await run($, 'report')
    expect(text).toContain('model-router: 2 prompts and 0 subagent runs over 1 session,')
    expect(text).toContain('Classifier: Jev 2')
    expect(text).toMatch(/hard\s+2\s+100%/)
  })

  test('reports with no subcommand too', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

    expect((await run($, '')).text).toContain('has logged no prompts yet')
  })

  test('shows its usage for anything else', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

    expect((await run($, 'routing on')).text).toBe('Usage: /model-router report')
  })
})

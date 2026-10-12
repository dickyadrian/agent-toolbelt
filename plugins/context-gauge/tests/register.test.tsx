import type { Engine } from 'claude-code/testing'
import type { ContextCategory, On, SessionContextBreakdown, SessionContextUsage, SessionMessage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const WINDOW = 200_000
const COMPACT_AT = 160_000

const row = (name: string, tokens: number, kind: ContextCategory['kind']): ContextCategory => ({
  name,
  tokens,
  color: 'inactive',
  isDeferred: false,
  kind,
})

/** The live context with `setup` and `chat` used; `tokens` absent means no response yet. */
const contextOf = (setup: number, chat: number, hasResponse = true): SessionContextUsage => {
  const breakdown: SessionContextBreakdown = {
    categories: [row('System prompt', setup, 'used'), row('Messages', chat, 'used')],
    totalTokens: setup + chat,
    maxTokens: WINDOW,
    rawMaxTokens: WINDOW,
    autocompactSource: 'auto',
    percentage: 0,
    gridRows: [],
    model: 'claude-opus-5-5',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    autoCompactThreshold: COMPACT_AT,
    isAutoCompactEnabled: true,
    apiUsage: null,
  }

  return hasResponse ? { tokens: setup + chat, window: WINDOW, breakdown } : { window: WINDOW, breakdown }
}

/** 20k setup + 76k chat = 96k of 160k = 60%. */
const SIXTY = contextOf(20_000, 76_000)
/** 20k setup + 40k chat = 60k of 160k = 38%. */
const LOW = contextOf(20_000, 40_000)
const FRESH = contextOf(20_000, 0, false)
/** A compaction keeps at least one message: the summary. */
const SUMMARY: SessionMessage[] = [{ role: 'user', text: 'Summary of the conversation so far.', toolUses: [] }]

type World = {
  /** What `session.usage` answers next; consumed in order, then `context`. */
  answers: Array<() => Promise<SessionContextUsage>>
  context: SessionContextUsage
  /** The band beneath the plugin: blank (the engine's) or a usage-like row. */
  beneath: 'blank' | 'usage'
}

const engine = (on: On, options: { store?: Record<string, unknown>; beneath?: World['beneath'] } = {}) => {
  const world: World = { answers: [], context: FRESH, beneath: options.beneath ?? 'blank' }
  mock.store(on, options.store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', async () => {
    const answer = world.answers.shift()
    const context = answer === undefined ? world.context : await answer()

    return { value: { startedAt: 0, context, rateLimits: [] } }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.compact', () => ({ messages: SUMMARY }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.step', async function* ($, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        model: e.model,
        input_tokens: 2000,
        output_tokens: 300,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 0,
      },
    }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return world.beneath === 'blank' ? (
      <Box key="engine-band" />
    ) : (
      <Box key="usage-band" marginTop={1}>
        <Text>5h ███████░░░░░░░  48%</Text>
      </Box>
    )
  })

  return world
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const measure = ($: Engine) =>
  $.session.measure({ context: { window: WINDOW }, rateLimits: [], changed: ['context'] })

const step = async ($: Engine, agentId?: string) => {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-opus-5-5',
    messageCount: 2,
    ...(agentId === undefined ? {} : { agentId }),
  })
  for (;;) if ((await stream.next()).done) return
}

const band = ($: Engine, surface: (typeof SURFACES)[number], props: { hasSurvey?: boolean; bodyColumns?: number } = {}) =>
  $.ui.mount({
    plugin: 'context-gauge',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: props.hasSurvey ?? false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: props.bodyColumns ?? 200,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  })

const toggle = ($: Engine) =>
  $.command.run({
    command: 'context-gauge',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 200 },
  })

/** The gauge row's text on each surface, or undefined where it is not drawn. */
const rows = async ($: Engine, props: { hasSurvey?: boolean; bodyColumns?: number } = {}) => {
  const texts: Array<string | undefined> = []
  for (const surface of SURFACES) {
    const ui = await band($, surface, props)
    texts.push((await ui.find({ key: 'gauge-row' }))?.text)
    await ui.unmount()
  }

  return texts
}

describe('band', () => {
  test('draws nothing before the first response', async ($, on) => {
    engine(on)
    await start($)

    expect(await rows($)).toEqual([undefined, undefined])
  })

  test('draws the row once a step leaves the context past the threshold', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await step($)

    for (const text of await rows($)) {
      expect(text).toContain('ctx')
      expect(text).toContain(' 60%')
      expect(text).toContain('setup 20k · chat 76k · 64k to compact')
    }
  })

  test('stays hidden below the threshold', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = LOW
    await measure($)

    expect(await rows($)).toEqual([undefined, undefined])
  })

  test('takes its threshold from the plugin options', { options: { threshold: 70 } }, async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await measure($)
    expect(await rows($)).toEqual([undefined, undefined])

    world.context = contextOf(20_000, 100_000)
    await measure($)
    for (const text of await rows($)) expect(text).toContain(' 75%')
  })

  test('ignores a subagent step', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await step($, 'agent-1')

    expect(await rows($)).toEqual([undefined, undefined])
  })

  test('hides after a compaction leaves no response yet', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await measure($)
    world.context = FRESH
    await $.session.compact({ trigger: 'manual', messages: SUMMARY })

    expect(await rows($)).toEqual([undefined, undefined])
  })

  test('keeps the row through a precompute', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await measure($)
    world.context = FRESH
    await $.session.compact({ trigger: 'precompute', messages: SUMMARY })

    for (const text of await rows($)) expect(text).toContain(' 60%')
  })

  test('hides again after /clear starts the session over', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await measure($)
    world.context = FRESH
    await start($)

    expect(await rows($)).toEqual([undefined, undefined])
  })

  test('keeps the newer refresh when an older one resolves after it', async ($, on) => {
    const world = engine(on)
    await start($)
    let release = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    world.answers.push(async () => {
      await held

      return LOW
    })
    world.answers.push(async () => SIXTY)

    // Whichever refresh asks first gets the held answer: the newer one
    // finishes first, then the older one is let go.
    const refreshes = [step($), measure($)]
    await Promise.race(refreshes)
    release()
    await Promise.all(refreshes)

    for (const text of await rows($)) expect(text).toContain(' 60%')
  })

  test('yields to a survey', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await measure($)

    expect(await rows($, { hasSurvey: true })).toEqual([undefined, undefined])
  })

  test('sheds the split on a narrower band', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await measure($)

    for (const text of await rows($, { bodyColumns: 50 })) {
      expect(text).toContain('64k to compact')
      expect(text).not.toContain('setup')
    }
  })
})

describe('stacking', () => {
  test('leaves a blank line above itself over the blank engine band', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await measure($)

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect((await ui.find({ key: 'gauge-row' }))?.props).toMatchObject({ marginTop: 1 })
      await ui.unmount()
    }
  })

  test('draws under a band beneath it, with no blank line of its own', async ($, on) => {
    const world = engine(on, { beneath: 'usage' })
    await start($)
    world.context = SIXTY
    await measure($)

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect((await ui.find({ key: 'gauge-stack' }))?.text.startsWith('5h')).toBe(true)
      expect(await ui.find({ key: 'usage-band' })).toBeDefined()
      expect((await ui.find({ key: 'gauge-row' }))?.props).toMatchObject({ marginTop: 0 })
      await ui.unmount()
    }
  })

  test('leaves the band beneath alone while hidden', async ($, on) => {
    engine(on, { beneath: 'usage' })
    await start($)

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'usage-band' })).toBeDefined()
      expect(await ui.find({ key: 'gauge-stack' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

describe('/context-gauge', () => {
  test('hides the row, then shows it again', async ($, on) => {
    const world = engine(on)
    await start($)
    world.context = SIXTY
    await measure($)

    expect((await toggle($)).text).toBe('Context gauge hidden.')
    expect(await rows($)).toEqual([undefined, undefined])

    expect((await toggle($)).text).toBe('Context gauge shown.')
    for (const text of await rows($)) expect(text).toContain(' 60%')
  })

  test('keeps the row hidden in a later session', async ($, on) => {
    const world = engine(on, { store: { isHidden: true } })
    await start($)
    world.context = SIXTY
    await measure($)

    expect(await rows($)).toEqual([undefined, undefined])
  })
})

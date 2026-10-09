import type { AgentInfo, AgentSpawnInput, On, UiPane } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

const NOW = new Date('2026-10-09T10:00:00Z').getTime()
const OPUS = 'claude-opus-5-5'

type World = {
  clock: MockClock
  agents: AgentInfo[]
  listCalls: number
  panes: UiPane[]
  opened: string[]
  closed: string[]
  startedAt: number
  /** Resolves the Agent call the test engine holds open. */
  release: () => void
}

/** Stands in for the engine beneath the plugin. */
const engine = (on: On): World => {
  const world: World = {
    clock: mock.clock(on, { now: NOW }),
    agents: [],
    listCalls: 0,
    panes: [],
    opened: [],
    closed: [],
    startedAt: 0,
    release: () => {},
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: world.startedAt, context: { window: 200_000 }, rateLimits: [] },
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.list', () => {
    world.listCalls++

    return { value: world.agents }
  })
  on('agent.spawn', ($, e) =>
    e.tool_use_id === 'denied' ? { deny: 'not allowed' } : { model: OPUS, agentId: `a-${e.tool_use_id}` },
  )
  // holds the call open, as the engine does while the agent starts
  on('tool.call', { tool: 'Agent' }, async () => {
    await new Promise<void>(resolve => {
      world.release = resolve
    })

    return { deny: 'test engine runs no tool' }
  })
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
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('ui.open', ($, e) => {
    world.opened.push(e.id)
    world.panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('ui.close', ($, e) => {
    world.closed.push(e.id)
    world.panes = world.panes.filter(pane => pane.id !== e.id)

    return { value: undefined }
  })

  return world
}

const spawnInput = (toolUseId: string, overrides: Partial<AgentSpawnInput> = {}): AgentSpawnInput => ({
  tool_use_id: toolUseId,
  prompt: 'Do the work.',
  description: 'refactor auth module',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: OPUS,
  background: false,
  fork: false,
  ...overrides,
})

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const spawn = ($: Engine, toolUseId: string, overrides: Partial<AgentSpawnInput> = {}) =>
  $.agent.spawn(spawnInput(toolUseId, overrides))

const step = async ($: Engine, agentId: string, effort: 'low' | 'high' = 'high') => {
  const stream = $.turn.step({ turnId: `t-${agentId}`, index: 0, model: OPUS, effort, messageCount: 2, agentId })
  for (;;) if ((await stream.next()).done) return
}

const pane = ($: Engine, options: { bodyColumns?: number; agentId?: string } = {}) =>
  $.ui.mount({
    plugin: 'subagent-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'subagent-pane',
    props: {
      title: 'Subagents',
      isFocused: false,
      bodyColumns: options.bodyColumns ?? 48,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: options.agentId === undefined ? {} : { agentId: options.agentId },
    },
  })

/** The drawn text of one element of the pane, by key; undefined when it is not drawn. */
const drawn = async ($: Engine, key: string) => {
  const ui = await pane($)
  const text = (await ui.find({ key }))?.text
  await ui.unmount()

  return text
}

const listed = (id: string, status: AgentInfo['status']): AgentInfo => ({
  id,
  description: 'refactor auth module',
  type: 'general-purpose',
  status,
})

describe('recording', () => {
  test('draws a spawned agent with its resolved model and run mode', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1', { background: true, name: 'auth', cwd: '/repo/worktrees/auth' })

    const row = await drawn($, 'agent-a-tu1')
    expect(row).toContain('●')
    expect(row).toContain('refactor auth module')
    expect(row).toContain('0s')
    expect(row).toContain('opus-5-5 · bg · cwd auth · @auth')
  })

  test('records nothing for a denied spawn', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'denied')

    expect(await drawn($, 'agent-a-denied')).toBeUndefined()
    expect(await drawn($, 'empty-none')).toContain('No subagents yet.')
  })

  test('flags worktree isolation from the Agent call', async ($, on) => {
    const world = engine(on)
    await start($)
    const call = $.tool.call({
      tool: 'Agent',
      tool_use_id: 'tu2',
      description: 'refactor auth module',
      prompt: 'Do the work.',
      subagent_type: 'general-purpose',
      isolation: 'worktree',
    })
    await world.clock.settle()
    await spawn($, 'tu2')
    world.release()
    await call

    expect(await drawn($, 'agent-a-tu2')).toContain('worktree')
  })

  test("takes effort and context from the agent's requests", async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1')
    await step($, 'a-tu1', 'high')

    expect(await drawn($, 'agent-a-tu1')).toContain('opus-5-5 · high · ctx 42k')
  })

  test('ignores requests of loops it does not know and the list does not name', async ($, on) => {
    engine(on)
    await start($)
    await step($, 'compaction-fork')

    expect(await drawn($, 'agent-compaction-fork')).toBeUndefined()
  })

  test('adds an agent it missed when the list names it', async ($, on) => {
    const world = engine(on)
    await start($)
    world.agents = [listed('wf-1', 'running')]
    await step($, 'wf-1')

    expect(await drawn($, 'agent-wf-1')).toContain('opus-5-5 · high')
  })

  test('marks an agent completed when its turn ends and the list lacks it', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1')
    await $.turn.complete({
      turnId: 't-a-tu1',
      agentId: 'a-tu1',
      answer: 'Done.',
      durationMs: 5,
      isAborted: false,
      reason: 'answer',
      usage: {
        model: OPUS,
        input_tokens: 2000,
        output_tokens: 300,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 0,
      },
    })

    const row = await drawn($, 'agent-a-tu1')
    expect(row).toContain('✓')
    expect(row).toContain('done 0s')
  })
})

describe('poll', () => {
  test('takes statuses from the agent list every 2 seconds', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    world.agents = [listed('a-tu1', 'completed')]
    await world.clock.advance(2000)

    expect(await drawn($, 'agent-a-tu1')).toContain('done 2s')
  })

  test('stops once nothing runs', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    world.agents = [listed('a-tu1', 'completed')]
    await world.clock.advance(2000)
    const calls = world.listCalls
    await world.clock.advance(10_000)

    expect(calls).toBeGreaterThan(0)
    expect(world.listCalls).toBe(calls)
  })

  test('drops the rows of before a /clear', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    await world.clock.advance(5000)
    world.startedAt = NOW + 5000
    await spawn($, 'tu2')

    expect(await drawn($, 'agent-a-tu1')).toBeUndefined()
    expect(await drawn($, 'agent-a-tu2')).toBeDefined()
  })
})

const toggle = ($: Engine) =>
  $.command.run({
    command: 'subagents-pane',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })

describe('pane', () => {
  test('shows the empty state before any subagent', async ($, on) => {
    engine(on)
    await start($)
    const ui = await pane($)

    const empty = (await ui.find({ key: 'empty-none' }))?.text
    expect(empty).toContain('No subagents yet.')
    expect(empty).toContain('/subagents-pane to close')
    await ui.unmount()
  })

  test('draws a running agent with its facts', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1', { background: true, name: 'auth' })
    await step($, 'a-tu1', 'high')
    const ui = await pane($)

    expect(await ui.find({ type: 'Text', text: /Subagents · 1 running/ })).toBeDefined()
    const agent = (await ui.find({ key: 'agent-a-tu1' }))?.text
    expect(agent).toContain('refactor auth module')
    expect(agent).toContain('0s')
    expect(agent).toContain('opus-5-5 · high · ctx 42k · bg · @auth')
    expect(await ui.find({ key: 'empty-none' })).toBeUndefined()
    expect(await ui.find({ key: 'empty-idle' })).toBeUndefined()
    await ui.unmount()
  })

  test('counts elapsed time while the agent runs', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    world.agents = [listed('a-tu1', 'running')]
    await world.clock.advance(62_000)
    const ui = await pane($)

    expect((await ui.find({ key: 'agent-a-tu1' }))?.text).toContain('1m')
    await ui.unmount()
  })

  test('moves a finished agent under Recent and says nothing runs', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    world.agents = [listed('a-tu1', 'completed')]
    await world.clock.advance(2000)
    const ui = await pane($)

    expect((await ui.find({ key: 'empty-idle' }))?.text).toContain('No subagents running.')
    const recent = (await ui.find({ key: 'recent' }))?.text
    expect(recent).toContain('Recent')
    expect(recent).toContain('refactor auth module')
    expect(recent).toContain('done 2s')
    await ui.unmount()
  })

  test('highlights the agent whose transcript is in view', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1')
    await spawn($, 'tu2', { description: 'migrate test fixtures' })
    const ui = await pane($, { agentId: 'a-tu2' })

    expect((await ui.find({ key: 'agent-a-tu2' }))?.text).toContain('▶')
    expect((await ui.find({ key: 'agent-a-tu1' }))?.text).not.toContain('▶')
    await ui.unmount()
  })

  test('fits a narrow pane without failing', async ($, on) => {
    engine(on)
    await start($)
    await spawn($, 'tu1', { cwd: '/repo/a-very-long-directory-name' })
    const ui = await pane($, { bodyColumns: 8 })

    expect(await ui.find({ key: 'agent-a-tu1' })).toBeDefined()
    await ui.unmount()
  })
})

describe('opening', () => {
  test('opens the pane on the first spawn only', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    await world.clock.settle()
    expect(world.opened).toEqual(['subagent-pane'])

    world.panes = [] // the person closed it
    await spawn($, 'tu2')
    await world.clock.settle()
    expect(world.opened).toEqual(['subagent-pane'])
  })

  test('opens again on the first spawn after a /clear', async ($, on) => {
    const world = engine(on)
    await start($)
    await spawn($, 'tu1')
    await world.clock.advance(5000)
    world.startedAt = NOW + 5000
    await spawn($, 'tu2')
    await world.clock.settle()

    expect(world.opened).toEqual(['subagent-pane', 'subagent-pane'])
  })

  test('/subagents-pane opens, then closes the pane', async ($, on) => {
    const world = engine(on)
    await start($)

    expect((await toggle($)).text).toBe('Subagents pane opened.')
    expect(world.opened).toEqual(['subagent-pane'])
    expect((await toggle($)).text).toBe('Subagents pane closed.')
    expect(world.closed).toEqual(['subagent-pane'])
  })
})

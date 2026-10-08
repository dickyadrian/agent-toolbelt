import type { Engine } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const NOW = new Date(2026, 9, 8, 11, 0).getTime()
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString()

const FIVE_HOUR: SessionRateLimit = { kind: 'five_hour', percentUsed: 48, resetsAt: at(8, 15, 40) }
const SEVEN_DAY: SessionRateLimit = { kind: 'seven_day', percentUsed: 92, resetsAt: at(12, 9) }
const CONTEXT = { window: 200_000 }

/**
 * Stands in for the engine beneath the plugin: the session's usage, the
 * command registry, and the band the engine draws when the plugin passes.
 */
const engine = (
  on: On,
  options: {
    rateLimits?: SessionRateLimit[]
    store?: Record<string, unknown>
    env?: Record<string, string>
  } = {},
) => {
  mock.clock(on, { now: NOW })
  mock.store(on, options.store)
  mock.env(on, options.env ?? {})
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: CONTEXT, rateLimits: options.rateLimits ?? [] },
  }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine-band" />
  })
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

const measure = ($: Engine, rateLimits: SessionRateLimit[]) =>
  $.session.measure({ context: CONTEXT, rateLimits, changed: ['rateLimits'] })

const band = (
  $: Engine,
  surface: (typeof SURFACES)[number],
  props: { hasSurvey?: boolean; bodyColumns?: number } = {},
) =>
  $.ui.mount({
    plugin: 'usage-bar',
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
    command: 'usage-bar',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 200 },
  })

describe('band', () => {
  test('draws both windows on one row once usage is measured', async ($, on) => {
    engine(on)
    await start($)
    await measure($, [FIVE_HOUR, SEVEN_DAY])

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'engine-band' })).toBeUndefined()
      expect(await ui.find({ key: 'row-0' })).toBeDefined()
      expect(await ui.find({ key: 'row-1' })).toBeUndefined()
      const fiveHour = (await ui.find({ key: 'segment-five_hour' }))?.text
      expect(fiveHour).toContain(' 48%')
      expect(fiveHour).toContain('resets 3:40pm')
      // 92% of a 14-cell bar: 13 filled, colored as past 90
      expect((await ui.find({ type: 'Text', text: '█████████████░' }))?.props.color).toBe('error')
      await ui.unmount()
    }
  })

  test('keeps a blank line between the transcript and the band', async ($, on) => {
    engine(on)
    await start($)
    await measure($, [FIVE_HOUR])

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ marginTop: 1 })
      await ui.unmount()
    }
  })

  test('draws one row per window when the band is narrow', async ($, on) => {
    engine(on)
    await start($)
    await measure($, [FIVE_HOUR, SEVEN_DAY])

    for (const surface of SURFACES) {
      const ui = await band($, surface, { bodyColumns: 60 })
      expect((await ui.find({ key: 'row-0' }))?.text).toContain('5h')
      expect((await ui.find({ key: 'row-1' }))?.text).toContain('7d')
      await ui.unmount()
    }
  })

  test('shows the usage the session already had at start', async ($, on) => {
    engine(on, { rateLimits: [FIVE_HOUR] })
    await start($)

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect((await ui.find({ key: 'segment-five_hour' }))?.text).toContain(' 48%')
      await ui.unmount()
    }
  })

  test('leaves the band to the engine before any usage is known', async ($, on) => {
    engine(on)
    await start($)

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('yields to a survey', async ($, on) => {
    engine(on)
    await start($)
    await measure($, [FIVE_HOUR])

    for (const surface of SURFACES) {
      const ui = await band($, surface, { hasSurvey: true })
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('/usage-bar', () => {
  test('hides the band, then shows it again', async ($, on) => {
    engine(on)
    await start($)
    await measure($, [FIVE_HOUR])

    expect((await toggle($)).text).toBe('Usage bar hidden.')
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      await ui.unmount()
    }

    expect((await toggle($)).text).toBe('Usage bar shown.')
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'segment-five_hour' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('keeps the band hidden in a later session', async ($, on) => {
    engine(on, { store: { isHidden: true } })
    await start($)
    await measure($, [FIVE_HOUR])

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('account badge', () => {
  const WORK = { USAGE_BAR_BADGE: 'work', USAGE_BAR_BADGE_COLOR: 'warning' }

  test('draws the label in its color beside the bars', async ($, on) => {
    engine(on, { env: WORK })
    await start($)
    await measure($, [FIVE_HOUR, SEVEN_DAY])

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      const badge = await ui.find({ key: 'badge' })
      expect(badge?.text).toBe(' work ')
      expect((await ui.find({ type: 'Text', text: ' work ' }))?.props).toMatchObject({
        inverse: true,
        color: 'warning',
      })
      await ui.unmount()
    }
  })

  test('is absent when no label is set', async ($, on) => {
    engine(on)
    await start($)
    await measure($, [FIVE_HOUR])

    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'badge' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('takes its width out of the room the bars have', async ($, on) => {
    engine(on, { env: WORK })
    await start($)
    await measure($, [FIVE_HOUR, SEVEN_DAY])

    for (const surface of SURFACES) {
      // The bars need 79 cells on one row; the badge takes 7 more.
      const wide = await band($, surface, { bodyColumns: 86 })
      expect(await wide.find({ key: 'row-1' })).toBeUndefined()
      await wide.unmount()

      const narrow = await band($, surface, { bodyColumns: 85 })
      expect(await narrow.find({ key: 'row-1' })).toBeDefined()
      await narrow.unmount()
    }
  })
})

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode } from 'claude-code'

import { barRuns, fold, LABEL, layout, percentOf, percentText, toneProps, urgencyOf } from './format'

const snapshot = atom({ plugin: 'context-gauge', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'context-gauge', key: 'isHidden' } as const, false)

const COMMAND = 'context-gauge'
const HIDDEN_KEY = 'isHidden'
const DEFAULT_THRESHOLD = 50

/** Per-load refresh order: the newest refresh started, and the newest one written. */
type Refreshes = { started: number; written: number }

/**
 * Reads the window's breakdown and writes the folded snapshot, or null before
 * the live window's first response. A refresh older than the last one written
 * is dropped. A failed read keeps the last snapshot: the gauge is at most one
 * step stale, which beats a toast per step.
 */
const refresh = async ($: EngineInterface, refreshes: Refreshes) => {
  refreshes.started += 1
  const order = refreshes.started
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const { breakdown } = context
    if (order < refreshes.written) return
    if (context.tokens === undefined) {
      refreshes.written = order
      await update($, snapshot, () => null)
    } else if (breakdown !== undefined) {
      refreshes.written = order
      await update($, snapshot, () => fold(breakdown))
    }
  } catch {
    // Keep the last snapshot.
  }
}

/** Whether a tree draws nothing: no non-blank string anywhere in it. */
const isBlank = (node: RenderNode): boolean => {
  if (typeof node === 'string') return node.trim() === ''
  if (node.type !== 'Box' && node.type !== 'Text') return false

  return (node.children ?? []).every(isBlank)
}

export const register: Register = (on, options) => {
  const threshold = typeof options.threshold === 'number' ? options.threshold : DEFAULT_THRESHOLD
  const refreshes: Refreshes = { started: 0, written: 0 }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the context gauge above the prompt',
    })
    const stored = (await $.store.get(HIDDEN_KEY)) === true
    await update($, isHidden, () => stored)
    await refresh($, refreshes)

    return result
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined) await refresh($, refreshes)

    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) await refresh($, refreshes)

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.messages !== undefined) {
      await refresh($, refreshes)
    }

    return result
  })

  on('command.run', { command: COMMAND }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)
    await $.store.set(HIDDEN_KEY, hidden)

    return { text: hidden ? 'Context gauge hidden.' : 'Context gauge shown.' }
  }).catch(($, e, next) => ({ text: `Could not toggle the context gauge: ${next.error.message}` }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, snapshot)
    if (e.props.hasSurvey || shown === null || (await read($, isHidden))) return next(e)
    const percent = percentOf(shown)
    if (percent < threshold) return next(e)

    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const urgency = urgencyOf(percent)
    const tone = toneProps(urgency)
    const fit = layout(shown, e.props.bodyColumns)

    return (
      <Box key="gauge-stack" flexDirection="column">
        {below}
        <Box key="gauge-row" flexDirection="row" columnGap={1} marginTop={isBlank(below) ? 1 : 0}>
          <Text {...tone}>{LABEL}</Text>
          {fit.width > 0 && (
            <Box key="gauge-bar">
              {barRuns(shown, fit.width, urgency).map((run, index) => (
                <Text key={`run-${index}`} {...toneProps(run.tone)}>
                  {run.text}
                </Text>
              ))}
            </Box>
          )}
          <Text {...tone}>{percentText(percent)}</Text>
          {fit.tail !== undefined && <Text {...tone}>{` ${fit.tail}`}</Text>}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}

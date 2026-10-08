import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { UsageWindow } from '../types'
import { layout, SEGMENT_GAP } from './format'

const windows = atom({ plugin: 'usage-bar', key: 'windows' } as const, [])
const isHidden = atom({ plugin: 'usage-bar', key: 'isHidden' } as const, false)

const COMMAND = 'usage-bar'
const HIDDEN_KEY = 'isHidden'

const toWindows = (limits: readonly UsageWindow[]): UsageWindow[] =>
  limits.map(({ kind, percentUsed, resetsAt }) =>
    resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt },
  )

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the usage bar above the prompt',
    })
    const stored = (await $.store.get(HIDDEN_KEY)) === true
    await update($, isHidden, () => stored)
    const { rateLimits } = await $.session.usage()
    await update($, windows, () => toWindows(rateLimits))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => toWindows(e.rateLimits))
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)
    await $.store.set(HIDDEN_KEY, hidden)

    return { text: hidden ? 'Usage bar hidden.' : 'Usage bar shown.' }
  }).catch(($, e, next) => ({ text: `Could not toggle the usage bar: ${next.error.message}` }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, windows)
    if (e.props.hasSurvey || shown.length === 0 || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const rows = layout(shown, e.props.bodyColumns, await $.clock.now())

    return (
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row, index) => (
          <Box key={`row-${index}`} flexDirection="row" columnGap={SEGMENT_GAP}>
            {row.map(segment => (
              <Box key={`segment-${segment.kind}`} columnGap={1}>
                <Text dimColor>{segment.label}</Text>
                <Text color={segment.color}>{segment.bar}</Text>
                <Text color={segment.color}>{segment.percent}</Text>
                {segment.reset !== undefined && <Text dimColor>{` resets ${segment.reset}`}</Text>}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}

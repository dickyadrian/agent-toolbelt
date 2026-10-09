import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRow, AgentRows } from '../types'
import { FACT_INDENT, headerText, layoutRow } from './format'
import {
  hasActive,
  isFinished,
  ordered,
  pruned,
  rowFromInfo,
  type Step,
  withList,
  withSpawn,
  withStep,
  withTurnEnd,
} from './rows'

const PANE = 'subagent-pane'
const TITLE = 'Subagents'
const COMMAND = 'subagents-pane'
const POLL_MS = 2000

const agents = atom({ plugin: 'subagent-pane', key: 'agents' } as const, {})
const now = atom({ plugin: 'subagent-pane', key: 'now' } as const, 0)
const autoOpenedAt = atom({ plugin: 'subagent-pane', key: 'autoOpenedAt' } as const, null)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const rowOfSpawn = (
  e: AgentSpawnInput,
  agentId: string,
  model: string,
  isWorktree: boolean,
  startedAt: number,
): AgentRow => ({
  id: agentId,
  description: e.description,
  type: e.subagentType,
  status: 'running',
  model,
  isBackground: e.background,
  isWorktree,
  ...(e.cwd === undefined ? {} : { cwd: e.cwd }),
  ...(e.name === undefined ? {} : { name: e.name }),
  startedAt,
})

/** The poll's handle, kept per activation of the module. */
type Poll = { timer: Timer | null }

const sessionStartedAt = async ($: EngineInterface) => (await $.session.usage()).startedAt

/** Applies `change` at the current time, prunes, stamps `now`, and runs the poll exactly while anything is active. */
const write = async ($: EngineInterface, poll: Poll, change: (rows: AgentRows, at: number) => AgentRows) => {
  const startedAt = await sessionStartedAt($)
  const at = await $.clock.now()
  await update($, agents, rows => pruned(change(rows, at), startedAt))
  await update($, now, () => at)
  if (hasActive(await read($, agents))) startPoll($, poll)
  else stopPolling(poll)
}

const tick = async ($: EngineInterface, poll: Poll) => {
  try {
    const list = await $.agent.list()
    await write($, poll, (rows, at) => withList(rows, list, at))
  } catch {
    // a failed read skips this tick; the next one tries again
  }
}

const startPoll = ($: EngineInterface, poll: Poll) => {
  if (poll.timer === null) poll.timer = $.clock.every(POLL_MS, () => void tick($, poll))
}

const stopPolling = (poll: Poll) => {
  poll.timer?.cancel()
  poll.timer = null
}

/**
 * Marks a request's agent running before the request goes out, so a resumed agent
 * leaves Recent at once. False when the loop is no agent the pane shows.
 */
const track = async ($: EngineInterface, poll: Poll, agentId: string, step: Step): Promise<boolean> => {
  try {
    const isKnown = (await read($, agents))[agentId] !== undefined
    const info = isKnown ? undefined : (await $.agent.list()).find(agent => agent.id === agentId)
    if (!isKnown && info === undefined) return false
    await write($, poll, (rows, at) => withStep(info === undefined ? rows : withSpawn(rows, rowFromInfo(info, at)), agentId, step))

    return true
  } catch (error) {
    $.ui.log(`could not record a request of subagent ${agentId}: ${messageOf(error)}`)

    return false
  }
}

/** Opens the pane on the session's first spawn; a /clear starts a new session. */
const autoOpen = async ($: EngineInterface) => {
  const opened = await read($, autoOpenedAt)
  if (opened !== null && opened >= (await sessionStartedAt($))) return
  const at = await $.clock.now()
  await update($, autoOpenedAt, () => at)
  void $.ui.open({ id: PANE, title: TITLE }).catch(error => $.ui.log(`could not open the pane: ${messageOf(error)}`))
}

export const register: Register = on => {
  /** Agent tool_use_ids whose call asked for `isolation: "worktree"`, until the call returns. */
  const worktreeCalls = new Set<string>()
  const poll: Poll = { timer: null }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Show or hide the subagents pane' })
    // a hot reload mid-run starts the poll again
    if (hasActive(await read($, agents))) startPoll($, poll)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: 'Subagents pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Subagents pane opened.' }
  }).catch(($, e, next) => ({ text: `Could not toggle the subagents pane: ${next.error.message}` }))

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const id = e.tool_use_id
    if (id !== undefined && e.isolation === 'worktree') worktreeCalls.add(id)
    try {
      return await next(e)
    } finally {
      if (id !== undefined) worktreeCalls.delete(id)
    }
  }).catch(($, e, next) => next(e)) // never gate an Agent call on this mod; next is replay-safe

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || result.agentId === undefined) return result
    const agentId = result.agentId
    try {
      const isWorktree = worktreeCalls.has(e.tool_use_id)
      await write($, poll, (rows, at) => withSpawn(rows, rowOfSpawn(e, agentId, result.model, isWorktree, at)))
      await autoOpen($)
    } catch (error) {
      $.ui.log(`could not record subagent ${agentId}: ${messageOf(error)}`)
    }

    return result
  }).catch(($, e, next) => next(e)) // never gate a spawn on this mod; next is replay-safe

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    const effort = e.effort === undefined ? {} : { effort: e.effort }
    const isShown = agentId !== undefined && (await track($, poll, agentId, { model: e.model, ...effort }))
    const result = yield* next(e)
    if (agentId === undefined || !isShown) return result
    try {
      const usage = result.usage
      // the model that answered, which a hook further in may have changed from the request's
      const step: Step = {
        model: usage?.model ?? e.model,
        ...effort,
        ...(usage === null
          ? {}
          : { contextTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens }),
      }
      await write($, poll, (rows, at) => withStep(rows, agentId, step))
    } catch (error) {
      $.ui.log(`could not record a request of subagent ${agentId}: ${messageOf(error)}`)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (agentId === undefined || (await read($, agents))[agentId] === undefined) return result
    try {
      const listed = (await $.agent.list()).find(agent => agent.id === agentId)
      await write($, poll, (rows, at) => withTurnEnd(rows, agentId, listed, at))
    } catch (error) {
      $.ui.log(`could not record the end of subagent ${agentId}: ${messageOf(error)}`)
    }

    return result
  })

  // a /clear ends the conversation and starts no session.start: empty the pane
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason !== 'clear') return result
    try {
      stopPolling(poll)
      await update($, agents, () => ({}))
      await update($, autoOpenedAt, () => null)
    } catch (error) {
      $.ui.log(`could not empty the pane after /clear: ${messageOf(error)}`)
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { active, recent } = ordered(await read($, agents))
    const at = await read($, now)
    const columns = Math.max(1, e.props.bodyColumns)
    const viewed = e.props.view.agentId

    const block = (row: AgentRow) => {
      const line = layoutRow(row, columns, at, row.id === viewed)
      const isInView = row.id === viewed
      const isDim = isFinished(row.status)
      const markStyle = line.markColor === undefined ? { dimColor: true } : { color: line.markColor }

      return (
        <Box key={`agent-${row.id}`} flexDirection="column">
          <Box flexDirection="row">
            {isInView && <Text bold>{line.prefix}</Text>}
            <Text {...markStyle}>{line.mark}</Text>
            <Text bold={isInView} dimColor={isDim}>{` ${line.description}${line.gap}`}</Text>
            <Text dimColor>{line.elapsed}</Text>
          </Box>
          {line.facts.map((fact, index) => (
            <Box key={`agent-${row.id}-fact-${index}`}>
              <Text dimColor>{`${FACT_INDENT}${fact}`}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    const isEmpty = active.length === 0 && recent.length === 0

    return (
      <Box flexDirection="column">
        <Text bold>{headerText(active.length)}</Text>
        {isEmpty && (
          <Box key="empty-none" flexDirection="column">
            <Text dimColor>No subagents yet.</Text>
            <Text dimColor>{`/${COMMAND} to close`}</Text>
          </Box>
        )}
        {!isEmpty && active.length === 0 && (
          <Box key="empty-idle">
            <Text dimColor>No subagents running.</Text>
          </Box>
        )}
        {active.map(block)}
        {recent.length > 0 && (
          <Box key="recent" flexDirection="column" marginTop={1}>
            <Text bold dimColor>Recent</Text>
            {recent.map(block)}
          </Box>
        )}
      </Box>
    )
  })
}

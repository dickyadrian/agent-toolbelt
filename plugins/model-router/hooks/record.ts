import type { ModelUsage, SessionRateLimit, TurnStepInput, TurnStepResult, TurnUsage } from 'claude-code'

import type { Classification } from './classify'

export const LOGGED_PROMPT_CHARS = 500

/** Rate-limit windows by kind, as percent used: `{ five_hour: 48, seven_day: 92.5 }`. */
export type Quota = Record<string, number>

export type Usage = ModelUsage & { model?: string }

/** One model request inside a turn. */
export type StepRecord = {
  index: number
  model: string
  effort?: TurnStepInput['effort']
  messageCount: number
  stopReason: TurnStepResult['stopReason']
  tools: string[]
  usage: Usage | null
}

/**
 * One turn as written to disk: a turn of the main loop (a prompt you typed)
 * or one run of a subagent's loop (`agent` set). Only main turns carry the
 * prompt, its classification and the quota around it.
 */
export type TurnRecord = {
  version: 1
  sessionId: string
  turnId: string
  agent: { id: string; type: string; parentTurnId: string | null } | null
  startedAt: string
  durationMs: number | null
  reason: string | null
  prompt: string | null
  classification: Classification | null
  quota: { before: Quota; after: Quota | null } | null
  usage: Usage | null
  steps: StepRecord[]
}

export const quotaOf = (limits: readonly SessionRateLimit[]): Quota =>
  Object.fromEntries(limits.map(limit => [limit.kind, limit.percentUsed]))

export const usageOf = (usage: TurnUsage | null | undefined): Usage | null =>
  usage == null
    ? null
    : {
        model: usage.model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
      }

export const stepOf = (e: TurnStepInput, result: TurnStepResult): StepRecord => ({
  index: e.index,
  model: e.model,
  ...(e.effort === undefined ? {} : { effort: e.effort }),
  messageCount: e.messageCount,
  stopReason: result.stopReason,
  tools: result.toolUses.map(use => use.name),
  usage: usageOf(result.usage),
})

/** Where the records live: one folder per session. */
export const turnsDir = (home: string): string => `${home}/.claude/model-router/turns`

/** Where a turn's record goes: one file per turn, grouped by session. */
export const recordPath = (home: string, sessionId: string, turnId: string): string =>
  `${turnsDir(home)}/${sessionId}/${turnId}.json`

/** A record read back from disk, or undefined for anything that isn't one. */
export const parseRecord = (text: string): TurnRecord | undefined => {
  try {
    const value = JSON.parse(text) as Partial<TurnRecord> | null

    return value !== null && value.version === 1 && typeof value.turnId === 'string' && Array.isArray(value.steps)
      ? (value as TurnRecord)
      : undefined
  } catch {
    return undefined
  }
}

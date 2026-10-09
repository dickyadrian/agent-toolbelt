/** Where an agent's loop stands, as `$.agent.list()` reports it. */
export type AgentRowStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** A request's reasoning effort: a level, or a numeric budget. */
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number

/** One subagent as the pane keeps it. */
export type AgentRow = {
  id: string
  description: string
  type: string
  status: AgentRowStatus
  /** The full model id; shortened only when drawn. */
  model?: string
  effort?: AgentEffort
  /** Input side of the agent's last response: uncached + cache read + cache write. */
  contextTokens?: number
  isBackground: boolean
  isWorktree: boolean
  cwd?: string
  name?: string
  /** `$.clock.now()` milliseconds. */
  startedAt: number
  /** Set while the status is completed, failed or killed. */
  endedAt?: number
}

/** The pane's rows, by agent id. */
export type AgentRows = Record<string, AgentRow>

declare module 'claude-code' {
  interface PluginState {
    'subagent-pane': { agents: AgentRows; autoOpenedAt: number | null; now: number }
  }
}

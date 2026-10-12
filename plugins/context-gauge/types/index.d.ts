/**
 * The context window folded into the gauge's groups, in tokens. Free space
 * and the reserve follow from `window`, `compactAt` and the used total.
 */
export type Snapshot = {
  /** Every used `/context` row but Messages: system prompt, tools, MCP, agents, skills, memory. */
  setup: number
  /** The Messages row. */
  chat: number
  /** The window the breakdown measures against (`rawMaxTokens`). */
  window: number
  /** Where autocompact runs; absent when it is off. */
  compactAt?: number
  /** Whether a Messages row was found, so setup and chat are told apart. */
  hasSplit: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'context-gauge': { snapshot: Snapshot | null; isHidden: boolean }
  }
}

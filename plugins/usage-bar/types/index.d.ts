/** One rate-limit window as the band keeps it. */
export type UsageWindow = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { windows: UsageWindow[]; isHidden: boolean }
  }
}

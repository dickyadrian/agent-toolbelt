/** One rate-limit window as the band keeps it. */
export type UsageWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** The account badge drawn before the bars: its label and color. */
export type Badge = { text: string; color: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { windows: UsageWindow[]; isHidden: boolean; badge: Badge | null }
  }
}

/** Ids that allowed calls minted this session (file uploads), allowed beside the file's. */
export type Minted = readonly string[]

declare module 'claude-code' {
  interface PluginState {
    'notion-scope': { isWarned: boolean; minted: Minted }
  }
}

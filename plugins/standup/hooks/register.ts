import type { EngineInterface, Register } from 'claude-code'

import { expiredDays } from './days'
import {
  configDirOf,
  encodeEntry,
  type Entry,
  entryPath,
  expandHome,
  head,
  isSkipped,
  journalDir,
  localIso,
  shortenHome,
  tail,
  workdayOf,
} from './journal'

/** The turn being recorded: opened at turn.start, written at turn.complete. */
type OpenTurn = { turnId: string; startedAt: number; prompt: string; files: string[] }

/** What the hooks share for one load of the module. */
type Journal = {
  paths: { home: string; configDir: string } | null
  repoByCwd: Map<string, string>
  turn: OpenTurn | null
  /** Edits made while no typed turn ran (a background subagent's), for the next one. */
  pendingFiles: string[]
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const pathsOf = async ($: EngineInterface, journal: Journal) => {
  if (journal.paths === null) {
    const home = (await $.env.get('HOME')) ?? ''
    const configured = await $.env.get('CLAUDE_CONFIG_DIR')
    journal.paths = { home, configDir: configDirOf(configured === undefined ? undefined : expandHome(configured, home), home) }
  }

  return journal.paths
}

/** The git top level of `cwd`, cached; the cwd itself outside a repo or without git. */
const repoOf = async ($: EngineInterface, journal: Journal, cwd: string) => {
  const known = journal.repoByCwd.get(cwd)
  if (known !== undefined) return known
  let repo = cwd
  try {
    const found = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 5000 })
    if (found.exitCode === 0 && found.stdout.trim() !== '') repo = found.stdout.trim()
  } catch {
    // no git: the cwd stands for the repo
  }
  journal.repoByCwd.set(cwd, repo)

  return repo
}

/** Adds the turn's line to this session's file for the turn's workday. */
const record = async ($: EngineInterface, journal: Journal, turn: OpenTurn, answer: string) => {
  const { home, configDir } = await pathsOf($, journal)
  const entry: Entry = {
    t: localIso(turn.startedAt),
    repo: shortenHome(await repoOf($, journal, await $.session.cwd()), home),
    prompt: turn.prompt,
    files: turn.files.map(file => shortenHome(file, home)),
    answer: tail(answer),
  }
  // the id changes after a /clear, which raises no session.start: read it per write
  const path = entryPath(configDir, workdayOf(turn.startedAt), await $.session.id())
  // $.fs has no append, and only this session writes this file
  const before = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  await $.fs.write(path, before + encodeEntry(entry))
}

/** Deletes this config's day folders past retention. */
const prune = async ($: EngineInterface, journal: Journal) => {
  const dir = journalDir((await pathsOf($, journal)).configDir)
  if (!(await $.fs.exists(dir))) return
  const names = (await $.fs.list(dir)).filter(entry => entry.kind === 'dir').map(entry => entry.name)
  for (const day of expiredDays(workdayOf(await $.clock.now()), names)) {
    const removed = await $.process.run(['rm', '-r', `${dir}/${day}`])
    if (removed.exitCode !== 0) $.ui.log(`could not delete ${dir}/${day}: ${removed.stderr.trim()}`)
  }
}

/** The file an editing tool call writes, or undefined for any other call. */
const editedPath = (e: { tool: string; file_path?: unknown; notebook_path?: unknown }): string | undefined => {
  if (e.tool === 'Edit' || e.tool === 'Write') return typeof e.file_path === 'string' ? e.file_path : undefined
  if (e.tool === 'NotebookEdit') return typeof e.notebook_path === 'string' ? e.notebook_path : undefined

  return undefined
}

export const register: Register = on => {
  const journal: Journal = { paths: null, repoByCwd: new Map(), turn: null, pendingFiles: [] }

  on('session.start', async ($, e, next) => {
    try {
      await prune($, journal)
    } catch (error) {
      $.ui.log(`could not prune the journal: ${messageOf(error)}`)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    try {
      if (isSkipped(e.text)) {
        journal.turn = null
      } else {
        journal.turn = { turnId: e.turnId, startedAt: await $.clock.now(), prompt: head(e.text.trim()), files: journal.pendingFiles }
        journal.pendingFiles = []
      }
    } catch (error) {
      journal.turn = null
      $.ui.log(`could not open a journal entry: ${messageOf(error)}`)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const path = editedPath(e)
    if (path !== undefined && result.deny === undefined && result.isError !== true) {
      const files = journal.turn?.files ?? journal.pendingFiles
      if (!files.includes(path)) files.push(path)
    }

    return result
  }).catch(($, e, next) => next(e)) // never gate a tool call on the journal; next is replay-safe

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const turn = journal.turn
    if (e.agentId !== undefined || turn === null || turn.turnId !== e.turnId) return result
    journal.turn = null
    try {
      await record($, journal, turn, e.answer)
    } catch (error) {
      $.ui.log(`could not write the journal entry: ${messageOf(error)}`)
    }

    return result
  })
}

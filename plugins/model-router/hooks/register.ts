import type { EngineInterface, Register } from 'claude-code'

import {
  builtinText,
  type Classification,
  type ClassifierState,
  classifierState,
  type Decision,
  decisionOf,
  JEV_TIMEOUT_MS,
  JEV_URL,
  jevBody,
  type JevConfig,
  jevErrorOf,
  messageOf,
  switchOf,
  TIERS,
  tierOf,
} from './classify'
import { LOGGED_PROMPT_CHARS, parseRecord, quotaOf, recordPath, stepOf, type TurnRecord, turnsDir, usageOf } from './record'
import { formatReport, summarize } from './report'

const COMMAND = 'model-router'
const USAGE = 'Usage: /model-router report'

/** What the hooks share for one load of the module. */
type Router = {
  /** Turns under way, by turn id, until their turn.complete. */
  records: Map<string, TurnRecord>
  /** Classifications under way, by the main turn they tag. */
  classifications: Map<string, Promise<Classification>>
  /** The last main turn's answer: the context the next prompt is classified in. */
  previousAnswer: string
  /** The main turn running now, which a subagent's run is filed under. */
  mainTurnId: string | null
  hasWarnedJev: boolean
}

const recordFor = (router: Router, turnId: string, agentId: string | undefined): TurnRecord => {
  const existing = router.records.get(turnId)
  if (existing !== undefined) return existing

  const record: TurnRecord = {
    version: 1,
    sessionId: '',
    turnId,
    agent: agentId === undefined ? null : { id: agentId, type: 'unknown', parentTurnId: router.mainTurnId },
    startedAt: '',
    durationMs: null,
    reason: null,
    prompt: null,
    classification: null,
    quota: null,
    usage: null,
    steps: [],
  }
  router.records.set(turnId, record)

  return record
}

/** Jev's settings from the environment; undefined while Jev is off or has no key. */
const jevConfigOf = async ($: EngineInterface): Promise<JevConfig | undefined> => {
  const key = (await $.env.get('MODEL_ROUTER_JEV_KEY'))?.trim()
  if (key === undefined || key === '' || !switchOf(await $.env.get('MODEL_ROUTER_JEV'), true)) return undefined

  return { key, zeroRetention: switchOf(await $.env.get('MODEL_ROUTER_JEV_ZERO_RETENTION'), false) }
}

const askJev = async ($: EngineInterface, jev: JevConfig, state: ClassifierState): Promise<Decision> => {
  const response = await new Promise<Awaited<ReturnType<EngineInterface['http']['fetch']>>>(
    (resolve, reject) => {
      const timer = $.clock.after(JEV_TIMEOUT_MS, () => reject(new Error(`timed out after ${JEV_TIMEOUT_MS}ms`)))
      $.http
        .fetch(JEV_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${jev.key}` },
          body: jevBody(state, jev.zeroRetention),
        })
        .then(
          value => (timer.cancel(), resolve(value)),
          error => (timer.cancel(), reject(error)),
        )
    },
  )
  if (!response.ok) throw new Error(jevErrorOf(response.status, response.text))

  return decisionOf(response.text)
}

/**
 * Tags a prompt with a tier: Jev first when it is on, and `$.model.classify`
 * when it is off or the Jev call fails. Never rejects; a failure of both is
 * a `null` tier with the reasons.
 */
const classify = async ($: EngineInterface, state: ClassifierState): Promise<Classification> => {
  const startedAt = await $.clock.now()
  const jev = await jevConfigOf($)

  let failed: Pick<Classification, 'jevError' | 'zeroRetention'> = {}
  if (jev !== undefined) {
    try {
      const { tier, probabilities } = await askJev($, jev, state)
      const latencyMs = (await $.clock.now()) - startedAt

      return { tier, source: 'jev', probabilities, zeroRetention: jev.zeroRetention, latencyMs }
    } catch (error) {
      failed = { jevError: messageOf(error), zeroRetention: jev.zeroRetention }
    }
  }

  try {
    // The built-in classifier has a fixed prompt of its own, so the rubric
    // rides in the text to keep its tags close to Jev's.
    const label = await $.model.classify(builtinText(state), TIERS)
    const tier = label === undefined ? undefined : tierOf(label)
    const latencyMs = (await $.clock.now()) - startedAt

    return tier === undefined
      ? { tier: null, source: null, latencyMs, ...failed, error: 'no tier named' }
      : { tier, source: 'builtin', latencyMs, ...failed }
  } catch (error) {
    return { tier: null, source: null, latencyMs: (await $.clock.now()) - startedAt, ...failed, error: messageOf(error) }
  }
}

const startClassifying = ($: EngineInterface, router: Router, turnId: string, state: ClassifierState) => {
  const done = new Promise<Classification>(resolve => {
    $.clock.after(0, () => {
      classify($, state).then(resolve, error =>
        resolve({ tier: null, source: null, latencyMs: 0, error: messageOf(error) }),
      )
    })
  })
  router.classifications.set(turnId, done)
  void done.then(result => {
    if (result.jevError === undefined || router.hasWarnedJev) return
    router.hasWarnedJev = true
    const retention = result.zeroRetention === true ? ' with zero data retention on' : ''
    $.ui.toast(`model-router: Jev failed${retention} (${result.jevError}), using the built-in classifier`)
  })
}

const write = async ($: EngineInterface, record: TurnRecord, classification?: Promise<Classification>) => {
  try {
    const home = await $.env.get('HOME')
    if (home === undefined || home === '') throw new Error('HOME is not set')
    const [sessionId, now] = await Promise.all([$.session.id(), $.clock.now()])
    record.sessionId = sessionId
    record.startedAt = new Date(now - (record.durationMs ?? 0)).toISOString()
    if (classification !== undefined) record.classification = await classification
    await $.fs.write(recordPath(home, sessionId, record.turnId), `${JSON.stringify(record, null, 2)}\n`)
  } catch (error) {
    $.ui.log(`could not log turn ${record.turnId}: ${messageOf(error)}`)
  }
}

/** Every record on disk, and how many files could not be read as one. */
const loadRecords = async ($: EngineInterface): Promise<{ records: TurnRecord[]; unreadable: number }> => {
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') throw new Error('HOME is not set')
  const root = turnsDir(home)
  if (!(await $.fs.exists(root))) return { records: [], unreadable: 0 }

  const sessions = (await $.fs.list(root)).filter(entry => entry.kind === 'dir')
  const texts = await Promise.all(
    sessions.map(async session => {
      const dir = `${root}/${session.name}`
      const files = (await $.fs.list(dir)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))

      return Promise.all(files.map(file => $.fs.read(`${dir}/${file.name}`).catch(() => '')))
    }),
  )
  const parsed = texts.flat().map(parseRecord)
  const records = parsed.filter((record): record is TurnRecord => record !== undefined)

  return { records, unreadable: parsed.length - records.length }
}

/**
 * Phase 1 of the router: measure only. Every main turn's prompt is tagged
 * trivial / normal / hard in the background, and every turn (main and
 * subagent) is written to disk with its per-step token counts and the quota
 * around it. Nothing here changes which model answers.
 */
export const register: Register = on => {
  const router: Router = {
    records: new Map(),
    classifications: new Map(),
    previousAnswer: '',
    mainTurnId: null,
    hasWarnedJev: false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Report what model-router has logged so far: /model-router report',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() !== '' && e.args.trim() !== 'report') return { text: USAGE }

    const { records, unreadable } = await loadRecords($)
    const report = formatReport(summarize(records), Math.random)
    const skipped = unreadable === 0 ? '' : `\n\n${unreadable} log files could not be read and were skipped.`

    return { text: report + skipped }
  }).catch(($, e, next) => ({ text: `Could not build the model-router report: ${next.error.message}` }))

  on('turn.start', async ($, e, next) => {
    try {
      router.mainTurnId = e.turnId
      const record = recordFor(router, e.turnId, undefined)
      record.prompt = e.text.slice(0, LOGGED_PROMPT_CHARS)
      record.quota = { before: quotaOf((await $.session.usage()).rateLimits), after: null }
      if (e.text.trim() !== '') startClassifying($, router, e.turnId, classifierState(e.text, router.previousAnswer))
    } catch (error) {
      $.ui.log(`could not start logging turn ${e.turnId}: ${messageOf(error)}`)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      recordFor(router, e.turnId, e.agentId).steps.push(stepOf(e, result))
    } catch (error) {
      $.ui.log(`could not log step ${e.index} of turn ${e.turnId}: ${messageOf(error)}`)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      const record = recordFor(router, e.turnId, e.agentId)
      const classification = router.classifications.get(e.turnId)
      router.records.delete(e.turnId)
      router.classifications.delete(e.turnId)

      record.durationMs = e.durationMs
      record.reason = e.reason
      record.usage = usageOf(e.usage)
      if (e.agentId === undefined) {
        router.previousAnswer = e.answer
        if (router.mainTurnId === e.turnId) router.mainTurnId = null
      }
      if (record.quota !== null) record.quota.after = quotaOf((await $.session.usage()).rateLimits)
      if (record.agent !== null) {
        const id = record.agent.id
        record.agent.type = (await $.agent.list()).find(agent => agent.id === id)?.type ?? 'unknown'
      }
      $.clock.after(0, () => void write($, record, classification))
    } catch (error) {
      $.ui.log(`could not finish logging turn ${e.turnId}: ${messageOf(error)}`)
    }

    return result
  })
}

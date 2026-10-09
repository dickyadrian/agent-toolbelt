export const TIERS = ['trivial', 'normal', 'hard'] as const
export type Tier = (typeof TIERS)[number]

/** TypeSafe's Jev, a decision model, through AI Gateway's decision endpoint. */
export const JEV_MODEL = 'typesafe-ai/jev'
export const JEV_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'
export const JEV_TIMEOUT_MS = 5000

const PROMPT_CHARS = 1000
const CONTEXT_CHARS = 500

/**
 * Which classifier tagged the prompt. `builtin` is `$.model.classify`: used
 * when Jev is off, or when the Jev call failed (`jevError` says why). `null`
 * means nothing tagged it. Jev also gives the probability it put on each
 * tier. `zeroRetention` is set whenever Jev was asked: whether the request
 * required zero data retention.
 */
export type Classification = {
  tier: Tier | null
  source: 'jev' | 'builtin' | null
  probabilities?: Partial<Record<Tier, number>>
  zeroRetention?: boolean
  latencyMs: number
  jevError?: string
  error?: string
}

/** How Jev is asked: with the AI Gateway key, and whether zero data retention is required. */
export type JevConfig = { key: string; zeroRetention: boolean }

/** What the classifiers are shown: the new prompt, and the end of the last reply as its context. */
export type ClassifierState = { prompt: string; previousReply?: string }

export type Decision = { tier: Tier; probabilities: Partial<Record<Tier, number>> }

const INSTRUCTIONS =
  'This is a prompt sent to a coding agent. Decide how capable a model the prompt needs. ' +
  'previousReply, when present, is the end of the agent\'s last reply. ' +
  'A short follow-up such as "yes" or "do it" is as hard as the work it approves.'

const CRITERIA: Record<Tier, string> = {
  trivial:
    'mechanical or lookup work a small fast model does reliably: renames, small edits with exact ' +
    'instructions, running a command, factual questions about code already shown, simple confirmations',
  normal: 'typical coding work: a contained feature, a clear bug fix, writing tests, explaining a module',
  hard:
    'deep reasoning: ambiguous requirements, design or architecture decisions, debugging an unclear ' +
    'failure, large multi-file changes, subtle correctness or security issues',
}

/** The rubric as text, for the built-in classifier, whose own prompt is fixed. */
export const RUBRIC = `${INSTRUCTIONS}\n\n${TIERS.map(tier => `${tier}: ${CRITERIA[tier]}`).join('\n')}`

export const classifierState = (prompt: string, previousAnswer: string): ClassifierState => {
  const previousReply = previousAnswer.slice(-CONTEXT_CHARS)

  return previousReply === ''
    ? { prompt: prompt.slice(0, PROMPT_CHARS) }
    : { prompt: prompt.slice(0, PROMPT_CHARS), previousReply }
}

/** The same state as text, the rubric first, for the built-in classifier. */
export const builtinText = (state: ClassifierState): string =>
  state.previousReply === undefined
    ? `${RUBRIC}\n\nprompt:\n${state.prompt}`
    : `${RUBRIC}\n\npreviousReply:\n${state.previousReply}\n\nprompt:\n${state.prompt}`

/** The tier a label names, read from its first word; undefined for anything else. */
export const tierOf = (label: string): Tier | undefined => {
  const word = label.trim().toLowerCase().match(/^[a-z]+/)?.[0]

  return TIERS.find(tier => tier === word)
}

/** A switch's value from the environment: `on`, `true`, `1` or `yes` is on, `off`, `false`, `0` or `no` is off, anything else the default. */
export const switchOf = (value: string | undefined, fallback: boolean): boolean => {
  const word = value?.trim().toLowerCase()
  if (word === 'on' || word === 'true' || word === '1' || word === 'yes') return true
  if (word === 'off' || word === 'false' || word === '0' || word === 'no') return false

  return fallback
}

/** The Jev request: one choice question over the state. */
export const jevBody = (state: ClassifierState, zeroRetention: boolean): string =>
  JSON.stringify({
    model: JEV_MODEL,
    state,
    questions: { tier: { type: 'choice', instructions: INSTRUCTIONS, criteria: CRITERIA } },
    ...(zeroRetention ? { providerOptions: { gateway: { zeroDataRetention: true } } } : {}),
  })

/** Why a Jev request failed, from its status and body: the gateway's own message when it gave one. */
export const jevErrorOf = (status: number, body: string): string => {
  let error: unknown
  try {
    error = (JSON.parse(body) as { error?: unknown }).error
  } catch {
    error = undefined
  }
  const message =
    typeof error === 'string' ? error : (error as { message?: unknown } | undefined)?.message
  const detail = (typeof message === 'string' ? message : body).trim().slice(0, 120)

  return detail === '' ? `HTTP ${status}` : `HTTP ${status}: ${detail}`
}

/** The tier a Jev response chose, with each tier's probability; throws on anything else. */
export const decisionOf = (body: string): Decision => {
  const answer = (JSON.parse(body) as { answers?: { tier?: { choice?: unknown; probabilities?: unknown } } })
    .answers?.tier
  const tier = TIERS.find(t => t === answer?.choice)
  if (tier === undefined) throw new Error(`unrecognized answer: ${JSON.stringify(answer)?.slice(0, 80)}`)

  const given = (answer?.probabilities ?? {}) as Record<string, unknown>
  const probabilities: Partial<Record<Tier, number>> = {}
  for (const t of TIERS) {
    const p = given[t]
    if (typeof p === 'number') probabilities[t] = p
  }

  return { tier, probabilities }
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

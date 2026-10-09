import { type Tier, TIERS } from './classify'
import type { TurnRecord, Usage } from './record'

/** What phase 2 needs before routing is worth trying. */
export const READY = { prompts: 300, trivial: 50, days: 7 }
/** Under this share of weighted tokens on trivial prompts, routing can't save much. */
export const WORTHWHILE_SHARE = 0.15
export const SAMPLE_SIZE = 10

const DAY_MS = 24 * 60 * 60 * 1000

export type Bucket = Tier | 'untagged'
const BUCKETS: readonly Bucket[] = [...TIERS, 'untagged']

type Totals = { prompts: number; weighted: number; fiveHour: number; sevenDay: number }

/** Jev's probability on `trivial`, for the prompts it tagged trivial, by how sure it was. */
export const CONFIDENCE_BANDS = [
  { label: '>= 0.95', min: 0.95 },
  { label: '0.85-0.95', min: 0.85 },
  { label: '0.70-0.85', min: 0.7 },
  { label: '< 0.70', min: 0 },
] as const

export type Summary = {
  prompts: number
  subagentRuns: number
  sessions: number
  firstAt: string | null
  lastAt: string | null
  spanDays: number
  hasQuota: boolean
  byTier: Record<Bucket, Totals>
  total: Totals
  sources: { jev: number; builtinAfterJev: number; builtin: number; untagged: number }
  jevErrors: [string, number][]
  confidence: { label: string; prompts: number; weighted: number }[]
  trivialPrompts: { prompt: string; probability: number | null }[]
}

/**
 * A turn's tokens weighted by what each kind costs relative to fresh input,
 * at Anthropic's API price ratios: output 5x, cache writes 1.25x, cache
 * reads 0.1x. A proxy for quota, which is weighted the same way or close.
 */
export const weightedTokens = (usage: Usage | null): number =>
  usage === null
    ? 0
    : usage.input_tokens +
      5 * usage.output_tokens +
      1.25 * usage.cache_creation_input_tokens +
      0.1 * usage.cache_read_input_tokens

/** How far a window moved over a turn; null when unknown or when it reset mid-turn. */
const quotaMoved = (record: TurnRecord, kind: string): number | null => {
  const before = record.quota?.before[kind]
  const after = record.quota?.after?.[kind]
  if (before === undefined || after === undefined || after < before) return null

  return after - before
}

const emptyTotals = (): Totals => ({ prompts: 0, weighted: 0, fiveHour: 0, sevenDay: 0 })

export const summarize = (records: readonly TurnRecord[]): Summary => {
  const main = records.filter(record => record.agent === null)
  const runs = records.filter(record => record.agent !== null)
  const tierOfTurn = new Map(main.map(record => [record.turnId, record.classification?.tier ?? null]))
  const bucketOf = (tier: Tier | null | undefined): Bucket => tier ?? 'untagged'

  const byTier = Object.fromEntries(BUCKETS.map(bucket => [bucket, emptyTotals()])) as Record<Bucket, Totals>
  const total = emptyTotals()
  let hasQuota = false
  for (const record of main) {
    const totals = byTier[bucketOf(record.classification?.tier)]
    const weighted = weightedTokens(record.usage)
    const fiveHour = quotaMoved(record, 'five_hour')
    const sevenDay = quotaMoved(record, 'seven_day')
    hasQuota ||= fiveHour !== null || sevenDay !== null
    for (const t of [totals, total]) {
      t.prompts += 1
      t.weighted += weighted
      t.fiveHour += fiveHour ?? 0
      t.sevenDay += sevenDay ?? 0
    }
  }
  // A subagent's tokens count toward the prompt that started it. Quota is
  // left alone: the main turn's before and after already include the run.
  for (const run of runs) {
    const parent = run.agent?.parentTurnId
    const weighted = weightedTokens(run.usage)
    byTier[bucketOf(parent == null ? null : tierOfTurn.get(parent))].weighted += weighted
    total.weighted += weighted
  }

  const sources = { jev: 0, builtinAfterJev: 0, builtin: 0, untagged: 0 }
  const errors = new Map<string, number>()
  for (const { classification } of main) {
    if (classification?.source === 'jev') sources.jev += 1
    else if (classification?.source === 'builtin' && classification.jevError !== undefined) sources.builtinAfterJev += 1
    else if (classification?.source === 'builtin') sources.builtin += 1
    else sources.untagged += 1
    if (classification?.jevError !== undefined) {
      errors.set(classification.jevError, (errors.get(classification.jevError) ?? 0) + 1)
    }
  }

  const weightedWithRuns = new Map(main.map(record => [record.turnId, weightedTokens(record.usage)]))
  for (const run of runs) {
    const parent = run.agent?.parentTurnId
    if (parent != null && weightedWithRuns.has(parent)) {
      weightedWithRuns.set(parent, (weightedWithRuns.get(parent) ?? 0) + weightedTokens(run.usage))
    }
  }
  const trivial = main.filter(record => record.classification?.tier === 'trivial')
  const confidence = CONFIDENCE_BANDS.map(band => ({ label: band.label, prompts: 0, weighted: 0 }))
  for (const record of trivial) {
    const probability = record.classification?.probabilities?.trivial
    if (probability === undefined) continue
    const index = CONFIDENCE_BANDS.findIndex(band => probability >= band.min)
    const band = confidence[index]
    if (band === undefined) continue
    band.prompts += 1
    band.weighted += weightedWithRuns.get(record.turnId) ?? 0
  }

  const times = records.map(record => record.startedAt).filter(at => at !== '').sort()
  const firstAt = times[0] ?? null
  const lastAt = times[times.length - 1] ?? null

  return {
    prompts: main.length,
    subagentRuns: runs.length,
    sessions: new Set(records.map(record => record.sessionId)).size,
    firstAt,
    lastAt,
    spanDays: firstAt === null || lastAt === null ? 0 : (Date.parse(lastAt) - Date.parse(firstAt)) / DAY_MS,
    hasQuota,
    byTier,
    total,
    sources,
    jevErrors: [...errors].sort((a, b) => b[1] - a[1]),
    confidence,
    trivialPrompts: trivial
      .filter(record => record.prompt !== null && record.prompt.trim() !== '')
      .map(record => ({
        prompt: record.prompt ?? '',
        probability: record.classification?.probabilities?.trivial ?? null,
      })),
  }
}

const share = (part: number, whole: number): string => (whole === 0 ? '-' : `${Math.round((100 * part) / whole)}%`)

const compact = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`

const day = (at: string): string => at.slice(0, 10)

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

const oneLine = (text: string, width: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > width ? `${line.slice(0, width - 3)}...` : line
}

/** Picks up to `size` items at random, keeping their order. */
export const sampleOf = <T>(items: readonly T[], size: number, random: () => number): T[] => {
  const indexes = items.map((_, index) => index)
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[indexes[i], indexes[j]] = [indexes[j] as number, indexes[i] as number]
  }

  return indexes
    .slice(0, size)
    .sort((a, b) => a - b)
    .map(index => items[index] as T)
}

export const formatReport = (summary: Summary, random: () => number): string => {
  if (summary.prompts === 0) {
    return 'model-router has logged no prompts yet. Send a few and run /model-router report again.'
  }

  const { byTier, total } = summary
  const lines: string[] = []
  const span = summary.firstAt === null || summary.lastAt === null ? '' : `, ${day(summary.firstAt)} to ${day(summary.lastAt)}`
  lines.push(
    `model-router: ${count(summary.prompts, 'prompt')} and ${count(summary.subagentRuns, 'subagent run')} ` +
      `over ${count(summary.sessions, 'session')}${span}`,
    '',
  )

  const quotaHeader = summary.hasQuota ? '   5h quota pts    7d quota pts' : ''
  lines.push(`Tier        Prompts     Weighted tokens${quotaHeader}`)
  for (const bucket of BUCKETS) {
    const t = byTier[bucket]
    if (bucket === 'untagged' && t.prompts === 0 && t.weighted === 0) continue
    const prompts = `${t.prompts}`.padStart(5) + ` ${share(t.prompts, total.prompts).padStart(4)}`
    const weighted = compact(t.weighted).padStart(8) + ` ${share(t.weighted, total.weighted).padStart(4)}`
    const quota = summary.hasQuota
      ? `${t.fiveHour.toFixed(1).padStart(9)} ${share(t.fiveHour, total.fiveHour).padStart(4)}` +
        `${t.sevenDay.toFixed(1).padStart(11)} ${share(t.sevenDay, total.sevenDay).padStart(4)}`
      : ''
    lines.push(`${bucket.padEnd(10)}${prompts}${weighted.padStart(18)}${quota}`)
  }
  lines.push(
    '',
    'Weighted tokens count output 5x, cache writes 1.25x and cache reads 0.1x, as the API prices them.',
    "Subagent runs count toward the prompt that started them. Quota points include anything else that used your account at the time.",
    '',
  )

  const { sources } = summary
  lines.push(
    `Classifier: Jev ${sources.jev}, built-in after Jev failed ${sources.builtinAfterJev}, ` +
      `built-in with Jev off ${sources.builtin}, untagged ${sources.untagged}`,
  )
  for (const [error, count] of summary.jevErrors.slice(0, 5)) lines.push(`  ${count}x ${error}`)
  lines.push('')

  const rated = summary.confidence.reduce((sum, band) => sum + band.prompts, 0)
  if (rated > 0) {
    lines.push("Jev's probability on trivial, for prompts it tagged trivial:")
    for (const band of summary.confidence) {
      lines.push(
        `  ${band.label.padEnd(10)}${`${band.prompts}`.padStart(5)} prompts  ` +
          `${share(band.weighted, total.weighted).padStart(4)} of weighted tokens`,
      )
    }
    lines.push('')
  }

  const mark = (ok: boolean) => (ok ? '✓' : '✗')
  const trivialCount = byTier.trivial.prompts
  lines.push(
    'Ready for phase 2?',
    `  ${mark(summary.prompts >= READY.prompts)} ${summary.prompts} prompts (need ${READY.prompts})`,
    `  ${mark(trivialCount >= READY.trivial)} ${trivialCount} tagged trivial (need ${READY.trivial})`,
    `  ${mark(summary.spanDays >= READY.days)} ${summary.spanDays.toFixed(1)} days logged (need ${READY.days})`,
  )
  const trivialShare = total.weighted === 0 ? 0 : byTier.trivial.weighted / total.weighted
  lines.push(
    trivialShare < WORTHWHILE_SHARE
      ? `  Trivial prompts took ${share(byTier.trivial.weighted, total.weighted)} of weighted tokens. Under ${WORTHWHILE_SHARE * 100}%, routing them is unlikely to pay off.`
      : `  Trivial prompts took ${share(byTier.trivial.weighted, total.weighted)} of weighted tokens: enough to be worth routing, if the tags hold up.`,
  )

  const sample = sampleOf(summary.trivialPrompts, SAMPLE_SIZE, random)
  if (sample.length > 0) {
    lines.push('', 'Prompts tagged trivial, at random. Would a small model have handled each one?')
    for (const { prompt, probability } of sample) {
      lines.push(`  ${(probability === null ? '  -' : probability.toFixed(2)).padEnd(6)}${oneLine(prompt, 90)}`)
    }
  }

  return lines.join('\n')
}

import { describe, expect, test } from 'claude-code/testing'

import {
  builtinText,
  classifierState,
  decisionOf,
  jevBody,
  jevErrorOf,
  RUBRIC,
  switchOf,
  tierOf,
} from '../hooks/classify'

const decision = (answer: unknown) => JSON.stringify({ model: 'typesafe-ai/jev', answers: { tier: answer } })

describe('tierOf', () => {
  test('reads the tier from the first word, any case or punctuation', () => {
    expect(tierOf('hard')).toBe('hard')
    expect(tierOf(' Trivial.\n')).toBe('trivial')
    expect(tierOf('normal - a contained fix')).toBe('normal')
  })

  test('names no tier for anything else', () => {
    expect(tierOf('difficult')).toBeUndefined()
    expect(tierOf('The tier is hard')).toBeUndefined()
    expect(tierOf('')).toBeUndefined()
  })
})

describe('classifierState', () => {
  test('is the prompt alone when there is no previous reply', () => {
    expect(classifierState('rename foo', '')).toEqual({ prompt: 'rename foo' })
  })

  test('carries the last 500 characters of the previous reply', () => {
    const state = classifierState('yes do it', `${'x'.repeat(600)}Shall I refactor the parser?`)
    expect(state.prompt).toBe('yes do it')
    expect(state.previousReply).toHaveLength(500)
    expect(state.previousReply?.endsWith('Shall I refactor the parser?')).toBe(true)
  })

  test('keeps the first 1000 characters of a long prompt', () => {
    expect(classifierState('p'.repeat(1500), '').prompt).toHaveLength(1000)
  })
})

describe('builtinText', () => {
  test('leads with the rubric, then the state', () => {
    expect(builtinText({ prompt: 'yes', previousReply: 'Shall I?' })).toBe(
      `${RUBRIC}\n\npreviousReply:\nShall I?\n\nprompt:\nyes`,
    )
    expect(builtinText({ prompt: 'yes' })).toBe(`${RUBRIC}\n\nprompt:\nyes`)
  })
})

describe('switchOf', () => {
  test('reads on and off in their usual spellings', () => {
    for (const on of ['on', 'ON', 'true', '1', 'yes', ' on ']) expect(switchOf(on, false)).toBe(true)
    for (const off of ['off', 'Off', 'false', '0', 'no']) expect(switchOf(off, true)).toBe(false)
  })

  test('falls back to the default when unset or unrecognized', () => {
    expect(switchOf(undefined, true)).toBe(true)
    expect(switchOf('', false)).toBe(false)
    expect(switchOf('maybe', false)).toBe(false)
  })
})

describe('Jev request', () => {
  test('asks one choice question over the state, one criterion per tier', () => {
    const body = JSON.parse(jevBody({ prompt: 'hi' }, false))
    expect(body).toMatchObject({ model: 'typesafe-ai/jev', state: { prompt: 'hi' } })
    expect(body.questions.tier.type).toBe('choice')
    expect(Object.keys(body.questions.tier.criteria)).toEqual(['trivial', 'normal', 'hard'])
    expect(body.providerOptions).toBeUndefined()
  })

  test('requires zero data retention when asked to', () => {
    expect(JSON.parse(jevBody({ prompt: 'hi' }, true)).providerOptions).toEqual({
      gateway: { zeroDataRetention: true },
    })
  })

  test('reads the chosen tier and its probabilities', () => {
    const body = decision({ type: 'choice', choice: 'hard', probabilities: { trivial: 0.05, normal: 0.15, hard: 0.8 } })
    expect(decisionOf(body)).toEqual({ tier: 'hard', probabilities: { trivial: 0.05, normal: 0.15, hard: 0.8 } })
  })

  test('throws on an answer that chose no tier', () => {
    expect(() => decisionOf(decision({ type: 'choice', choice: 'maybe' }))).toThrow('unrecognized answer')
    expect(() => decisionOf(JSON.stringify({ answers: {} }))).toThrow('unrecognized answer')
    expect(() => decisionOf('<html>')).toThrow()
  })
})

describe('jevErrorOf', () => {
  test('carries the gateway\'s own message', () => {
    expect(jevErrorOf(400, JSON.stringify({ error: { message: 'bad model' } }))).toBe('HTTP 400: bad model')
    expect(jevErrorOf(429, JSON.stringify({ error: 'slow down' }))).toBe('HTTP 429: slow down')
  })

  test('falls back to the start of the body, or the status alone', () => {
    expect(jevErrorOf(502, 'Bad Gateway')).toBe('HTTP 502: Bad Gateway')
    expect(jevErrorOf(503, 'x'.repeat(300))).toHaveLength('HTTP 503: '.length + 120)
    expect(jevErrorOf(401, '')).toBe('HTTP 401')
  })
})

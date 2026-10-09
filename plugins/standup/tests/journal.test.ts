import { describe, expect, test } from 'claude-code/testing'

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
  parseEntries,
  shortenHome,
  tail,
  workdayOf,
} from '../hooks/journal'

// Local-time constructors keep the tests independent of the machine's time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

const ENTRY: Entry = {
  t: '2026-10-09T14:32:10.000+07:00',
  repo: '~/code/app',
  prompt: 'fix the login bug',
  files: ['~/code/app/login.ts'],
  answer: 'Fixed; tests pass.',
}

describe('workdayOf', () => {
  test('is the calendar date from 4am on', () => {
    expect(workdayOf(at(9, 4))).toBe('2026-10-09')
    expect(workdayOf(at(9, 23, 59))).toBe('2026-10-09')
  })

  test('files the hours before 4am under the day before', () => {
    expect(workdayOf(at(10, 1, 30))).toBe('2026-10-09')
    expect(workdayOf(at(10, 3, 59))).toBe('2026-10-09')
  })

  test('crosses a month boundary', () => {
    expect(workdayOf(new Date(2026, 10, 1, 2).getTime())).toBe('2026-10-31')
  })
})

describe('localIso', () => {
  test('writes local wall time with its offset', () => {
    const text = localIso(new Date(2026, 9, 9, 14, 32, 10).getTime())
    expect(text.slice(0, 23)).toBe('2026-10-09T14:32:10.000')
    expect(/^[+-]\d{2}:\d{2}$/.test(text.slice(23))).toBe(true)
  })
})

describe('isSkipped', () => {
  test('skips empty prompts and messages the person did not type', () => {
    expect(isSkipped('')).toBe(true)
    expect(isSkipped('   \n')).toBe(true)
    expect(isSkipped('<agent-message from="a1">done</agent-message>')).toBe(true)
    expect(isSkipped('  <task-notification>x</task-notification>')).toBe(true)
    expect(isSkipped('<system-reminder>x</system-reminder>')).toBe(true)
  })

  test('keeps what the person typed, tags inside it included', () => {
    expect(isSkipped('fix the login bug')).toBe(false)
    expect(isSkipped('what does <div> do here')).toBe(false)
  })
})

describe('head and tail', () => {
  test('keep the first or the last characters', () => {
    expect(head('abcdef', 3)).toBe('abc')
    expect(tail('abcdef', 3)).toBe('def')
    expect(tail('ab', 3)).toBe('ab')
  })
})

describe('home paths', () => {
  test('shortens paths under home to ~', () => {
    expect(shortenHome('/Users/me', '/Users/me')).toBe('~')
    expect(shortenHome('/Users/me/code/app', '/Users/me')).toBe('~/code/app')
    expect(shortenHome('/Users/meow/x', '/Users/me')).toBe('/Users/meow/x')
    expect(shortenHome('/tmp/x', '/Users/me')).toBe('/tmp/x')
  })

  test('expands ~ back to home', () => {
    expect(expandHome('~', '/Users/me')).toBe('/Users/me')
    expect(expandHome('~/code', '/Users/me')).toBe('/Users/me/code')
    expect(expandHome('/abs', '/Users/me')).toBe('/abs')
  })
})

describe('journal paths', () => {
  test('use CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    expect(configDirOf(undefined, '/Users/me')).toBe('/Users/me/.claude')
    expect(configDirOf('', '/Users/me')).toBe('/Users/me/.claude')
    expect(configDirOf('/Users/me/.claude-work/', '/Users/me')).toBe('/Users/me/.claude-work')
  })

  test('name one file per session per day', () => {
    expect(journalDir('/Users/me/.claude')).toBe('/Users/me/.claude/journal')
    expect(entryPath('/Users/me/.claude', '2026-10-09', 's-1')).toBe('/Users/me/.claude/journal/2026-10-09/s-1.jsonl')
  })
})

describe('encodeEntry and parseEntries', () => {
  test('round-trip one line per entry', () => {
    const text = encodeEntry(ENTRY) + encodeEntry({ ...ENTRY, prompt: 'second' })
    expect(parseEntries(text)).toEqual([ENTRY, { ...ENTRY, prompt: 'second' }])
  })

  test('skips malformed lines and lines of the wrong shape', () => {
    expect(parseEntries(`not json\n{"t":1}\n\n${encodeEntry(ENTRY)}`)).toEqual([ENTRY])
  })
})

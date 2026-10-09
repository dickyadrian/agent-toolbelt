import { describe, expect, test } from 'claude-code/testing'

import { addDays, candidateDays, dayLabel, daysBetween, expiredDays, gitLogArgv } from '../hooks/days'

describe('addDays', () => {
  test('moves across month boundaries both ways', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-10-09', -14)).toBe('2026-09-25')
  })
})

describe('daysBetween', () => {
  test('counts calendar days', () => {
    expect(daysBetween('2026-09-25', '2026-10-09')).toBe(14)
    expect(daysBetween('2026-10-09', '2026-10-09')).toBe(0)
  })
})

describe('candidateDays', () => {
  test('lists earlier dates within 14 days, newest first, and nothing else', () => {
    const names = ['2026-10-09', '2026-10-12', '2026-10-08', 'notes', '2026-09-27', '2026-09-28']
    expect(candidateDays('2026-10-12', names)).toEqual(['2026-10-09', '2026-10-08', '2026-09-28'])
  })
})

describe('expiredDays', () => {
  test('lists only date folders more than 14 days old', () => {
    const names = ['2026-09-24', '2026-09-25', '2026-10-01', 'notes', '2026-9-1']
    expect(expiredDays('2026-10-09', names)).toEqual(['2026-09-24'])
  })
})

describe('gitLogArgv', () => {
  test("covers the workday from 4am to 4am, the person's commits only", () => {
    expect(gitLogArgv('2026-10-09', 'me@example.com')).toEqual([
      'git',
      'log',
      '--since=2026-10-09T04:00:00',
      '--until=2026-10-10T04:00:00',
      '--author=me@example.com',
      '--format=%h %s',
    ])
  })
})

describe('dayLabel', () => {
  test('names the weekday, day and month', () => {
    expect(dayLabel('2026-10-09')).toBe('Fri 9 Oct')
    expect(dayLabel('2026-10-12')).toBe('Mon 12 Oct')
  })
})

import { describe, expect, test } from 'claude-code/testing'

import { badgeOf, badgeWidth, bar, colorOf, labelOf, layout, resetText, segmentWidth } from '../hooks/format'

// Local-time constructors keep the tests independent of the machine's time zone.
const NOW = new Date(2026, 9, 8, 11, 0).getTime() // Thu 8 Oct 2026, 11:00am
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString()

describe('labelOf', () => {
  test('names the known windows short', () => {
    expect(labelOf('five_hour')).toBe('5h')
    expect(labelOf('seven_day')).toBe('7d')
  })

  test('shows an unknown window by its raw kind', () => {
    expect(labelOf('spend_limit')).toBe('spend_limit')
  })
})

describe('colorOf', () => {
  test('is success below 70', () => {
    expect(colorOf(0)).toBe('success')
    expect(colorOf(69.9)).toBe('success')
  })

  test('is warning from 70 to below 90', () => {
    expect(colorOf(70)).toBe('warning')
    expect(colorOf(89.9)).toBe('warning')
  })

  test('is error from 90', () => {
    expect(colorOf(90)).toBe('error')
    expect(colorOf(120)).toBe('error')
  })
})

describe('bar', () => {
  test('fills cells in proportion, rounded', () => {
    expect(bar(48, 14)).toBe('███████░░░░░░░')
    expect(bar(0, 4)).toBe('░░░░')
    expect(bar(100, 4)).toBe('████')
  })

  test('clamps past 100 to a full bar', () => {
    expect(bar(130, 4)).toBe('████')
  })
})

describe('resetText', () => {
  test('is the clock time for a reset later today', () => {
    expect(resetText(at(8, 15, 40), NOW)).toBe('3:40pm')
  })

  test('drops the minutes on the hour', () => {
    expect(resetText(at(8, 12), NOW)).toBe('12pm')
  })

  test('is the weekday and time for a reset on another day', () => {
    expect(resetText(at(12, 9), NOW)).toBe('Mon 9am')
    expect(resetText(at(9, 0, 30), NOW)).toBe('Fri 12:30am')
  })

  test('is undefined when there is no reset time', () => {
    expect(resetText(undefined, NOW)).toBeUndefined()
  })
})

describe('layout', () => {
  const fiveHour = { kind: 'five_hour', percentUsed: 48, resetsAt: at(8, 15, 40) }
  const sevenDay = { kind: 'seven_day', percentUsed: 14, resetsAt: at(12, 9) }
  const both = [fiveHour, sevenDay]

  test('builds a full segment per window', () => {
    const segment = layout([fiveHour], 200, NOW)[0]?.[0]
    expect(segment).toEqual({
      kind: 'five_hour',
      label: '5h',
      bar: '███████░░░░░░░',
      percent: ' 48%',
      color: 'success',
      reset: '3:40pm',
    })
    // 5h ███████░░░░░░░  48%  resets 3:40pm
    expect(segmentWidth(segment!)).toBe(37)
  })

  test('orders 5h before 7d whatever order they arrive in', () => {
    const rows = layout([sevenDay, fiveHour], 200, NOW)
    expect(rows.flat().map(s => s.label)).toEqual(['5h', '7d'])
  })

  test('shows 0% once the window has reset', () => {
    const stale = { kind: 'five_hour', percentUsed: 95, resetsAt: at(8, 10) }
    const segment = layout([stale], 200, NOW)[0]?.[0]
    expect(segment!.percent).toBe('  0%')
    expect(segment!.color).toBe('success')
    expect(segment!.reset).toBeUndefined()
  })

  test('puts every window on one row on a wide screen', () => {
    expect(layout(both, 200, NOW)).toHaveLength(1)
  })

  test('uses one row exactly at the width both segments need', () => {
    // 37 + 4 gap + 38 ("7d ... resets Mon 9am")
    expect(layout(both, 79, NOW)).toHaveLength(1)
  })

  test('breaks into one row per window one cell narrower', () => {
    const rows = layout(both, 78, NOW)
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.map(s => s.label))).toEqual([['5h'], ['7d']])
    expect(rows[0]![0]!.bar).toHaveLength(14)
  })

  test('shrinks the bar to fit a narrow screen', () => {
    const rows = layout(both, 33, NOW)
    expect(rows[0]![0]!.bar).toHaveLength(10)
    expect(rows[0]![0]!.reset).toBe('3:40pm')
    expect(segmentWidth(rows[0]![0]!)).toBe(33)
  })

  test('drops the reset text when the smallest bar still does not fit', () => {
    const segment = layout([fiveHour], 20, NOW)[0]?.[0]
    expect(segment!.reset).toBeUndefined()
    // The room the reset text gave back goes to the bar: 20 - "5h  48%" and spaces
    expect(segment!.bar).toHaveLength(12)
    expect(segmentWidth(segment!)).toBe(20)
  })

  test('never shrinks the bar below 6 cells', () => {
    const segment = layout([fiveHour], 10, NOW)[0]?.[0]
    expect(segment!.bar).toHaveLength(6)
  })
})

describe('badgeOf', () => {
  test('is null when no label is set', () => {
    expect(badgeOf(undefined, undefined)).toBeNull()
    expect(badgeOf('', 'warning')).toBeNull()
    expect(badgeOf('   ', 'warning')).toBeNull()
  })

  test('trims the label', () => {
    expect(badgeOf('  work ', 'warning')).toEqual({ text: 'work', color: 'warning' })
  })

  test('cuts the label to 12 characters', () => {
    expect(badgeOf('personal-account-x', 'warning')?.text).toBe('personal-acc')
  })

  test('takes a theme color name', () => {
    expect(badgeOf('work', 'suggestion')?.color).toBe('suggestion')
  })

  test('takes a #rrggbb color', () => {
    expect(badgeOf('work', '#ff8800')?.color).toBe('#ff8800')
  })

  test('falls back to claude for a missing or unknown color', () => {
    expect(badgeOf('work', undefined)?.color).toBe('claude')
    expect(badgeOf('work', 'orange')?.color).toBe('claude')
    expect(badgeOf('work', '#ff88')?.color).toBe('claude')
  })
})

describe('badgeWidth', () => {
  test('is the padded label and the gap after it', () => {
    // " work " + 1 cell gap before the bars
    expect(badgeWidth({ text: 'work', color: 'warning' })).toBe(7)
  })

  test('is 0 without a badge', () => {
    expect(badgeWidth(null)).toBe(0)
  })
})

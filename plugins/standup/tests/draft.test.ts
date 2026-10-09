import { describe, expect, test } from 'claude-code/testing'

import { type DayInput, DRAFT_SYSTEM, draftPrompt, rawListing, repoName, standupHeader } from '../hooks/draft'
import type { Entry } from '../hooks/journal'

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  t: '2026-10-08T15:00:00.000+07:00',
  repo: '~/code/app',
  prompt: 'fix the login bug',
  files: ['~/code/app/login.ts'],
  answer: 'Fixed. Still need to add a test.',
  ...overrides,
})

const YESTERDAY: DayInput = { day: '2026-10-08', entries: [entry()], commits: { '~/code/app': ['abc1234 fix login'] } }
const TODAY: DayInput = { day: '2026-10-09', entries: [], commits: {} }

describe('repoName', () => {
  test('is the folder name', () => {
    expect(repoName('~/code/app')).toBe('app')
    expect(repoName('/srv/api/')).toBe('api')
    expect(repoName('~')).toBe('home')
  })
})

describe('standupHeader', () => {
  test('names yesterday, or says there was none', () => {
    expect(standupHeader('2026-10-08')).toBe('Standup (Yesterday = Thu 8 Oct)')
    expect(standupHeader(undefined)).toBe('Standup (nothing recorded before today)')
  })
})

describe('draftPrompt', () => {
  test('lays out each day by repo: commits, then prompts with files and answer ends', () => {
    const prompt = draftPrompt(YESTERDAY, TODAY)
    expect(prompt).toContain('## Yesterday (2026-10-08)')
    expect(prompt).toContain('### app (~/code/app)')
    expect(prompt).toContain('- abc1234 fix login')
    expect(prompt).toContain('- [15:00] prompt: fix the login bug')
    expect(prompt).toContain('  files: ~/code/app/login.ts')
    expect(prompt).toContain('  answer ends: Fixed. Still need to add a test.')
    expect(prompt).toContain('## Today so far (2026-10-09)')
    expect(prompt).toContain('(nothing recorded)')
  })

  test('says when there is no earlier day', () => {
    expect(draftPrompt(undefined, TODAY)).toContain('(nothing recorded in the last 14 days)')
  })
})

describe('follow-ups', () => {
  test('show under their turn in the prompt and the raw listing', () => {
    const day: DayInput = { day: '2026-10-08', entries: [entry({ followUps: ['also update the README'] })], commits: {} }
    expect(draftPrompt(day, TODAY)).toContain('  also asked: also update the README')
    expect(rawListing([day], 'x')).toContain('    - also update the README')
  })
})

describe('DRAFT_SYSTEM', () => {
  test('asks for the three sections and forbids invented work', () => {
    expect(DRAFT_SYSTEM).toContain('Yesterday, Today, Blockers')
    expect(DRAFT_SYSTEM).toContain('Never invent work')
  })
})

describe('rawListing', () => {
  test('lists each day by repo, commits then prompts, after the reason', () => {
    const text = rawListing([YESTERDAY], 'empty-reply')
    expect(text.split('\n')[0]).toBe('Could not draft with the model (empty-reply). Raw journal:')
    expect(text).toContain('Thu 8 Oct (2026-10-08)')
    expect(text).toContain('  app')
    expect(text).toContain('    commit abc1234 fix login')
    expect(text).toContain('    - fix the login bug')
  })
})

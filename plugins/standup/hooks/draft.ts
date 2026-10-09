import { dayLabel } from './days'
import type { Entry } from './journal'

/** One day's material for the draft: its entries, and each repo's commits that day. */
export type DayInput = { day: string; entries: Entry[]; commits: Record<string, string[]> }

export const EMPTY_MESSAGE = 'Nothing in the journal for the last 14 days.'

export const DRAFT_SYSTEM = [
  "You draft a developer's daily standup from their work journal and git commits.",
  'Write exactly three sections, each heading on its own line: Yesterday, Today, Blockers.',
  'Under each heading write bullets that start with "- ", each led by the repo name and a colon, like "- app: fixed the login bug".',
  'Group by repo. Merge related prompts into one outcome per bullet. Leave out trivial chatter and questions.',
  "For Today, use today's entries so far and what yesterday's last answers say is unfinished.",
  'For Blockers, list only what the journal shows is blocked; otherwise write "- none".',
  'Never invent work that is not in the material. Plain text only: no markdown headings, no bold.',
  'Never use the em dash character; use a plain hyphen.',
].join('\n')

/** A repo's folder name; `home` for the home folder itself. */
export const repoName = (repo: string): string => {
  const trimmed = repo.replace(/\/+$/, '')
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1)

  return name === '' || name === '~' ? 'home' : name
}

/** The repos a day touched, in first-seen order: its entries', then any with commits only. */
const reposOf = (input: DayInput): string[] => [
  ...new Set([...input.entries.map(entry => entry.repo), ...Object.keys(input.commits)]),
]

const dayBlock = (title: string, input: DayInput): string => {
  const lines = [`## ${title} (${input.day})`]
  const repos = reposOf(input)
  if (repos.length === 0) lines.push('(nothing recorded)')
  for (const repo of repos) {
    lines.push(`### ${repoName(repo)} (${repo})`)
    const commits = input.commits[repo] ?? []
    if (commits.length > 0) lines.push('Commits:', ...commits.map(commit => `- ${commit}`))
    for (const entry of input.entries.filter(one => one.repo === repo)) {
      lines.push(`- [${entry.t.slice(11, 16)}] prompt: ${entry.prompt}`)
      for (const more of entry.followUps ?? []) lines.push(`  also asked: ${more}`)
      if (entry.files.length > 0) lines.push(`  files: ${entry.files.join(', ')}`)
      if (entry.answer !== '') lines.push(`  answer ends: ${entry.answer}`)
    }
  }

  return lines.join('\n')
}

export const draftPrompt = (yesterday: DayInput | undefined, today: DayInput): string =>
  [
    yesterday === undefined ? '## Yesterday\n(nothing recorded in the last 14 days)' : dayBlock('Yesterday', yesterday),
    dayBlock('Today so far', today),
  ].join('\n\n')

export const standupHeader = (yesterday: string | undefined): string =>
  yesterday === undefined ? 'Standup (nothing recorded before today)' : `Standup (Yesterday = ${dayLabel(yesterday)})`

/** What /standup prints when the model gives no draft: the material itself. */
export const rawListing = (days: readonly DayInput[], reason: string): string => {
  const lines = [`Could not draft with the model (${reason}). Raw journal:`]
  for (const input of days) {
    lines.push('', `${dayLabel(input.day)} (${input.day})`)
    for (const repo of reposOf(input)) {
      lines.push(`  ${repoName(repo)}`)
      for (const commit of input.commits[repo] ?? []) lines.push(`    commit ${commit}`)
      for (const entry of input.entries.filter(one => one.repo === repo)) {
        for (const prompt of [entry.prompt, ...(entry.followUps ?? [])]) lines.push(`    - ${prompt}`)
      }
    }
  }

  return lines.join('\n')
}

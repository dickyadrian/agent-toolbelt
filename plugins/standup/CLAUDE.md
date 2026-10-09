# standup

Journals each typed turn per config; `/standup` drafts the standup from it. Pure logic in `hooks/journal.ts` (entry format, workday, paths), `hooks/days.ts` (day picking, retention, git argv) and `hooks/draft.ts` (model prompt, fallback text); `hooks/register.ts` wires the hooks.

## Behaviour that is deliberate

- **No model call while working.** Each turn writes raw facts. The one `sonnet` call is at `/standup`. This was chosen over per-session summaries, because sessions get killed and run across days.
- **Workdays start at 4am local** (`workdayOf`). A turn is filed by its start time, so one session can write into several day folders.
- **One file per session per day.** Concurrent sessions never share a file. Writes are read-modify-write because `$.fs` has no append.
- **One journal per config dir** (`CLAUDE_CONFIG_DIR`, else `~/.claude`). `/standup` reads only its own.
- **Only typed turns.** A turn is journaled only when its prompt came through `prompt.submit` with origin `composer` or `bridge` (the person at the terminal or over Remote Control); `turn.start` carries no origin, so typed prompts are queued and claimed by text. Scheduled, SDK, peer and notification prompts are never written. The old prefix rule (`<agent-message`, `<task-notification`, `<system-reminder>`, empty) stays as a backstop.
- **Follow-ups.** A prompt typed mid-turn may be folded into the running turn, raising no `turn.start`; it arrives as a `session.append` row at door `delivery` and goes into that entry's `followUps`.
- **Edits outside a turn.** Edits made while no typed turn runs (a background subagent's) go to the next one.
- **Retention.** It deletes only `YYYY-MM-DD` folders directly under `journal/`, older than 14 days, with `rm -r`, since `$.fs` can't delete.
- **Repos and commits.** A worktree is filed under its main working tree (`git rev-parse --git-common-dir`), and `git log --all` finds commits on branches no longer checked out. Commits are filtered by each repo's `user.email`; a repo without one contributes none.

## Gotchas

- **Session id.** It's read per write. It changes after `/clear`, and no `session.start` follows.
- **Sorting.** Entries sort by their `t` string, which assumes one UTC offset within a day.
- **Hot reload.** The open turn, its pending edits and the unclaimed typed prompts live in the module; a reload mid-turn drops that turn's entry.
- **Slash commands (unverified).** Their prompt text may carry `<command-name>` wrapper tags, which would eat into the 300 kept characters; check a live entry before relying on it.

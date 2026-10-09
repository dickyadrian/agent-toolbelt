# standup

Journals each typed turn per config; `/standup` drafts the standup from it. Pure logic in `hooks/journal.ts` (entry format, workday, paths), `hooks/days.ts` (day picking, retention, git argv) and `hooks/draft.ts` (model prompt, fallback text); `hooks/register.ts` wires the hooks.

## Behaviour that is deliberate

- **No model call while working.** Each turn writes raw facts. The one `sonnet` call is at `/standup`. This was chosen over per-session summaries, because sessions get killed and run across days.
- **Workdays start at 4am local** (`workdayOf`). A turn is filed by its start time, so one session can write into several day folders.
- **One file per session per day.** Concurrent sessions never share a file. Writes are read-modify-write because `$.fs` has no append.
- **One journal per config dir** (`CLAUDE_CONFIG_DIR`, else `~/.claude`). `/standup` reads only its own.
- **Only typed turns.** Empty prompts are skipped, as are those starting `<agent-message`, `<task-notification` or `<system-reminder>`. Edits made while no typed turn runs (a background subagent's) go to the next one.
- **Retention.** It deletes only `YYYY-MM-DD` folders directly under `journal/`, older than 14 days, with `rm -r`, since `$.fs` can't delete.
- **Commits.** They're filtered by each repo's `user.email`. A repo without one contributes no commits.

## Gotchas

- **Session id.** It's read per write. It changes after `/clear`, and no `session.start` follows.
- **Sorting.** Entries sort by their `t` string, which assumes one UTC offset within a day.

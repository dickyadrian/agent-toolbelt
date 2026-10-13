# notion-scope

Limits Notion MCP calls to the page ids in a per-project allowlist. `hooks/scope.ts` is pure: id extraction, allowlist parsing, the decision, created ids. `hooks/register.ts` holds the `tool.call` guard, the file and git I/O, and `/notion-scope`.

## Behaviour that is deliberate

- **Fails closed.** The guard's `.catch` denies when the check threw before `next`. This breaks the repo's "gating hooks pass through on failure" rule on purpose: a scope guard that fails open does nothing. After `next` it passes the engine's answer through as usual.
- **One allowlist per clone.** The project root is the main working tree (`--git-common-dir` without its `/.git`), so a linked worktree, which never gets a copy of the git-excluded file, shares the main tree's. Outside git it is the cwd.
- **Denies list the allowed pages** with their trailing `# label`s, so Claude can pick one instead of dead-ending. They never name the file, so they don't invite Claude to edit it.
- **No file, no guard.** Without `.claude/notion-scope.local.txt` every Notion call goes through, with one toast per session (`isWarned` in `$.state`). A file holding only comments is on and denies everything.
- **Matcher.** `/^mcp__(?:(?!__).)*notion(?:(?!__).)*__/i`: the server part may hold single underscores (`claude_ai_Notion`). A `[^_]*` form misses the claude.ai connector; a test pins both spellings.
- **Exact ids.** No child pages. `user://` ids (mentions) and `v=` ids (database views) are not pages and are skipped.
- **Unscoped tools** (`notion-create-file-upload`, `notion-get-async-task`, `notion-get-self`) pass with any ids. An upload's `file_upload_id` joins `minted` in `$.state` for the session.
- **Created pages** from `notion-create-pages`, `notion-duplicate-page` and `notion-create-database` are appended to the file, labelled `created by Claude <date>`, only from the result's id fields, and only while the guard is on.
- **Never committed.** Only `/notion-scope add` creates the file, and then writes `/.claude/notion-scope.local.txt` to the git common dir's `info/exclude` unless `git check-ignore` already ignores it.

## Gotchas

- **Await state writes.** `update($, atom, fn)` is a Promise; unawaited, the next call reads the old value and the warning repeats.
- **The file is read on every guarded call**, so edits apply at once. The project root is cached per cwd for the load.
- **Created-id fields are a reading of Notion's API**, not seen in a real result yet (`id`, `url`, `page_id`, `page_url`, `database_id`, `data_source_id`, top level and `pages[]`). If a real create stops adding its page, check the result's shape first.

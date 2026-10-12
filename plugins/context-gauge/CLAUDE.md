# context-gauge

How full the context window is, as one row above the prompt, once it passes a threshold. `hooks/format.ts` is pure folding and layout; `hooks/register.tsx` holds the state, the refresh hooks and the `AbovePrompt` hook.

## Behaviour that is deliberate

- **Data source:** `$.session.usage({ breakdown: 'summary' })`, a local estimate with no API call. It refreshes after each main-thread step, on `session.measure` when `context` moved, and at session start (which covers `/clear`). Subagent steps never refresh it. A real (non-`precompute`) main compaction clears the snapshot without reading usage: inside the compaction's chain the engine may still report the old fill.
- **No response yet means no row:** while `context.tokens` is absent (a fresh session, just after `/clear` or a compaction), the snapshot is null and the row is hidden.
- **Groups:** every `used` `/context` row but `Messages` is setup, and `Messages` is chat. `ContextCategoryKind` has no messages kind, so chat is found by the name. Without that row, the bar has one group and the tail shows `N used`.
- **Percent:** used over the autocompact point, or over the window when autocompact is off. It can pass 100. The bar is clamped to its width.
- **Urgency:** the label, marker, percent and tail are dim below 80, `warning` from 80 and `error` from 90. The setup (`suggestion`) and chat (`claude`) colors never change, so the row never looks like usage-bar's bars.
- **Shedding:** the split goes first, then the tail, then bar cells down to 10, then the bar.
- **Refresh order:** each refresh takes a number; an older one resolving late never overwrites a newer one. A failed read keeps the last snapshot, with no toast.
- **Hide choice:** `/context-gauge` hides or shows the row, and the choice persists in `$.store`. Surveys win (`e.props.hasSurvey`).

## Gotchas

- **The band is shared.** `AbovePrompt` has one drawer. context-gauge draws `await next(e)` first and its row last. Its root (`gauge-stack`) carries `marginTop={1}` only when that tree is blank; the engine's own band (`type: 'engine'`) counts as blank. When usage-bar is outermost it strips the root margin of the tree it stacks, so the margin must stay on the root: on a child, usage-bar can't reach it and the rows get two blank lines. usage-bar's stacking test stubs this exact shape; keep the two in sync.
- **Threshold range:** `userConfig.threshold` declares 1-100. A hand-edited value outside that range makes the engine refuse to load the mod, naming the field.
- **Tests find Boxes by key, not Texts.** Every element a test looks up by key is a Box (`gauge-stack`, `gauge-row`, `gauge-bar`).
- **Compaction in tests needs a message.** The kit refuses a `session.compact` with empty `messages`, and each message needs `toolUses: []`.

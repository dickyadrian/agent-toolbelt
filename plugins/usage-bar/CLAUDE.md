# usage-bar

The 5h and 7d subscription windows as bars in the band above the prompt. `hooks/format.ts` is pure layout; `hooks/register.tsx` holds the state and the `AbovePrompt` hook.

## Behaviour that is deliberate

- **Data source:** the numbers come only from `session.measure` (`rateLimits`) and the session's usage at start. There is nothing before the first reply, and nothing on an API key, so the band leaves the site to the engine (`next(e)`) until a window is known.
- **After a reset:** once a window's `resetsAt` has passed, it shows 0% until the next reply brings fresh numbers.
- **Layout:** all windows go on one row when they fit; otherwise one row each. Each segment shrinks its bar first, then drops its reset text.
- **Badge:** comes from `USAGE_BAR_BADGE` / `USAGE_BAR_BADGE_COLOR`. A color that is neither a theme name nor `#rrggbb` falls back to `claude`, so a typo can't break the band.
- **Hide choice:** `/usage-bar` hides or shows the band, and the choice persists in `$.store`.
- **Surveys win:** the band yields to a survey (`e.props.hasSurvey`).

## Gotchas

- **The band is shared.** `AbovePrompt` has one drawer, so band mods compose `await next(e)`. usage-bar draws its rows first and the tree beneath after them, keeping that tree's root `marginTop`: it is the blank line between the two bands. context-gauge draws the tree beneath first and its row last, a blank line apart, so the screen is the same whichever loads outermost.
- **Time-zone-independent tests.** The tests build dates with local-time constructors, never ISO strings, so they pass in any time zone; keep new tests that way.

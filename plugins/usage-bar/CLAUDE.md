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

- **The band hides other bands.** While the band shows, the hook returns its own tree without calling `next(e)`, so any `AbovePrompt` band from a plugin beneath it is hidden. If another band mod is added, compose with `next(e)` instead of replacing it.
- **Time-zone-independent tests.** The tests build dates with local-time constructors, never ISO strings, so they pass in any time zone; keep new tests that way.

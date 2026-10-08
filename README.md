# claude-mod

Mods for [Claude Code](https://claude.com/claude-code), published as a plugin marketplace. Each mod lives in its own folder under `plugins/` and installs on its own.

## Mods

### usage-bar

Shows your subscription usage above the prompt, so you don't have to run `/usage` or open the website.

```
5h ███████░░░░░░░  48%  resets 3:40pm    7d █████████████░  92%  resets Mon 9am
```

- One row when the terminal is wide enough for both windows, one row per window when it isn't. The band never grows wider than it needs to.
- Bars turn yellow at 70% and red at 90%.
- Once a window's reset time has passed, it shows 0% until the next reply brings fresh numbers.
- `/usage-bar` hides or shows the band. Your choice is remembered across sessions.
- Optional account badge, for when you run more than one Claude Code config. Set it per config in the `env` block of that config's `settings.json`:

  ```json
  "env": {
    "USAGE_BAR_BADGE": "work",
    "USAGE_BAR_BADGE_COLOR": "warning"
  }
  ```

  `USAGE_BAR_BADGE` is the label, cut to 12 characters. No label means no badge. `USAGE_BAR_BADGE_COLOR` is a theme color name (`claude`, `suggestion`, `success`, `warning`, `error`, `planMode`, ...) or `#rrggbb`. Anything else falls back to `claude`.

The numbers come from Claude's API responses, so the band appears after the first reply of a session. It only shows on a Claude subscription. With an API key there are no usage windows to show.

Install:

```
/plugin install usage-bar --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then pick a scope.

## Developing

Run a mod from this checkout with hot reload:

```
claude --plugin-dir ./plugins/usage-bar
```

Check it:

```
claude plugin validate ./plugins/usage-bar
claude plugin test ./plugins/usage-bar
```

### Adding a mod

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and the hooks module.
2. Add an entry to `plugins` in `.claude-plugin/marketplace.json`.
3. Add a section to this README.

Each mod has to be self-contained. An install copies only that mod's folder, so a mod can't import code from another mod or from a shared folder.

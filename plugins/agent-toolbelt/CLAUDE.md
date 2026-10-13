# agent-toolbelt

The bundle: an empty plugin whose `dependencies` in `.claude-plugin/plugin.json` name every other mod, so one install pulls them all in. It has no hooks, types or tests.

## Keep it current

- **A new mod joins `dependencies`.** Add its name and bump `version`, or installs of the bundle miss it.
- **Bare names resolve in this marketplace.** Don't qualify them with `@agent-toolbelt`.
- **Uninstalling the bundle keeps the mods.** They were auto-installed, so `claude plugin prune` is what removes them.

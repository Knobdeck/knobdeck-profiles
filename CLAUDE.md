# KnobDeck profiles — working rules

Ready-made dial and deck profiles, served from `master` by the app site (see README.md). No builds,
no releases.

## Rule 1: build after every change, commit what it writes

`node scripts/build.mjs` completes the profile files and rewrites `registry.json`; `preview.mjs`
redraws the pictures. CI (`build.mjs --check`) fails when either is stale or an action is unknown.

## Rule 2: actions are portable

Name plugin actions `<plugin>/<action>` with the plugin's folder name in knobdeck-plugins
(`obs/record`, `os-tools/lock-screen`), never an installed id (`obs-linux-…`). Check them against
`catalog/plugins.json`; refresh it with `scripts/sync-catalog.mjs` after a plugins release.

## Rule 3: no keystrokes for what a plugin does

Use the plugin action when one exists (knobdeck/CLAUDE.md Rule 1). The built-in `keybind` action is
for app shortcuts no plugin covers; give it a macOS override (`cmd`) with `platform_overrides`.

## Rule 4: a changed profile bumps `profileVersion`

So the app can tell a newer copy from the one a user added.

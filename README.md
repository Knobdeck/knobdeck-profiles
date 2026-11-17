# knobdeck-profiles

Ready-made dial and deck profiles for KnobDeck. The app lists them under **Get Profiles** at the top
of the dial and deck profile lists, each drawn read-only from its own `profile.json` by the editor's
canvas (no images here); one click adds a profile, after installing (with your OK) the
plugins it uses and offering their setup.

Nothing here is built or released. The app site (`knobdeck-registry`) serves `registry.json` and the
profile folders straight from `master`:

| App site path | This repo |
|---|---|
| `https://app.knobdeck.harshalkudale.com/profiles/registry.json` | `registry.json` |
| `https://app.knobdeck.harshalkudale.com/profiles/<id>/profile.json` | `profiles/<id>/profile.json` |

A change is live a few minutes after it lands on `master` (the site caches for 5 minutes).

## Layout

```
registry.json              every profile's summary (generated)
profiles/<id>/profile.json the profile, one file
catalog/plugins.json       every published plugin's actions, per OS (generated)
catalog/builtin.json       KnobDeck's built-in actions (by hand)
catalog/icons/<plugin>/    plugin logos, inlined into profiles as data URIs
scripts/                   sync-catalog, build
```

## A profile file

```jsonc
{
  "format": "knobdeck-registry-profile", "version": 1,
  "id": "obs-streaming",            // = folder name: lowercase letters, digits, dashes
  "kind": "deck",                   // "dial" or "deck": which Get Profiles page lists it
  "name": "OBS Streaming",
  "summary": "One line for the card.",
  "description": "A paragraph for the details.",
  "author": "KnobDeck",
  "profileVersion": "1.0.0",
  "tags": ["Streaming"],
  // Filled in by build.mjs:
  "plugins": [{ "id": "obs", "name": "OBS Studio", "setup": true }],
  "platforms": ["linux", "macos", "windows"],   // OSes where at least one item runs
  "skippedOn": { "windows": 1 },                // items left out on that OS
  "ready": false,                               // false: some items need a pick (scene, entity…)
  "toConfigure": ["Scene 1 (scene)"],
  "items": 19,
  "profile": { "name": "OBS Streaming", "icon": "data:image/svg+xml;base64,…", "slices": [ … ] }
}
```

`profile` is the same tree the app saves (`items` on a dial, a 64-cell `slices` grid on a deck),
except that actions are named so they work on every OS:

- **`"action_type": "obs/record"`**: the `record` action of the `obs` plugin. The app turns it into
  this OS's plugin and action ids (`obs-linux`, `obs-linux-record-<hash>`). `os-tools/…` is the OS
  tools plugin that ships with KnobDeck (`mac-tools`, `win-tools`, `linux-tools`).
- **`"action_type": "volume"`** (no `/`): a built-in action, `catalog/builtin.json`.
- **`"platforms": ["windows"]`** on an item or workflow step: only there. build.mjs sets it from the
  catalog; the app leaves the item out elsewhere (a deck cell stays empty).
- **`"platform_overrides": { "macos": { "kind": { "inputs": { "preset": "cmd c" } } } }`**: merged into
  the item on that OS. Use it for keybinds (⌘ on macOS, Ctrl elsewhere).
- **Icons** are Lucide names or data URIs. Write `"icon": "plugin:obs"` for a plugin's logo and
  build.mjs inlines it; the app stores data URIs as custom icons.

Items that need a value only the user has (an OBS scene, a Home Assistant entity) are left empty;
the user picks them after adding. Fill everything else, or set `""` on an optional field.

## Adding or changing a profile

1. Write `profiles/<id>/profile.json`. Items may use the short form, which build.mjs expands into
   what the editor would make (toggle states, slider range, input defaults, ids):
   ```json
   { "action": "obs/scene", "label": "Scene 1", "cell": 8 }
   { "action": "volume", "cell": 16, "span": { "axis": "row", "length": 4 } }
   { "label": "Copy", "icon": "copy", "action": "keybind", "inputs": { "preset": "ctrl c" },
     "platform_overrides": { "macos": { "kind": { "inputs": { "preset": "cmd c" } } } } }
   ```
   `cell` places a deck item (0–63, row by row); without it items fill the grid in order. A deck
   folder gets its Back cell. Folders and workflows use the full form (`kind.type` `folder` / `multi`).
2. `node scripts/build.mjs`: checks every action against the catalog, completes the files and
   writes `registry.json`. It fails on unknown actions, a folder in a deck folder, overlapping
   sliders and so on.
3. Bump `profileVersion` when you change a published profile. Commit everything; CI runs
   `node scripts/build.mjs --check`.

When plugins gain or change actions, refresh the catalog with `node scripts/sync-catalog.mjs`
(downloads the latest `knobdeck-plugins` release; needs `gh` and `unzip`) and rebuild.

## Licence

CC0-1.0 (see LICENSE).

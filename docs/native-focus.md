# Direct native focus keys

Opt-in [issue #17](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/17), the direct-shortcut subset of #4. The [fragment](../config.focus-keys.toml) adds only native keybindings for Herdr 0.9.5:

| Key | Action |
| --- | --- |
| F6 | `zoom`: toggle the focused pane's tab between zoomed and split view. |
| F7 | `last_pane`: focus the previously focused pane. |
| prefix+z | Existing native zoom fallback, retained alongside F6. |

F6/F7 are unused in the inspected native defaults, repository Windows config and Noctty bindings. They avoid taking ordinary typing, Ctrl+Z, Ctrl+P or paste chords from an agent. F1/F2/F4/F10, pane cycling, the prefix and image/text paste bindings are unchanged. These function keys become reserved for Herdr in terminal mode after activation. If an agent or outer terminal already uses either key, do not adopt it without choosing and checking a different key. This cannot preserve an agent's own F6/F7 shortcuts simultaneously.

## What the native actions do

F6 is a **toggle**, not an idempotent enter-focus command. If the tab is already zoomed, the first press unzooms it. A single-pane tab has nothing to zoom and is a native no-op. Unzoom reveals the current split layout, which may have changed while zoomed. Hidden panes keep running. No layout snapshot, pane creation, agent restart or sidebar toggle is added.

F7 goes back and forth between the current and previous focus once native snapshots record the change. It is not next-pane cycling or a fixed manager/worker pair. Visiting another pane changes that history. The previous pane can be in another tab or workspace within the displayed endpoint. With no previous pane, or if it has closed or is absent from the snapshot, there is no target. Endpoint changes/restarts can clear history. Check the destination label before typing or answering anything.

Zoom is tab state, while previous-pane navigation changes focus. Switching panes does not promise restoration of an earlier zoom/sidebar combination. A narrow window can already use Herdr's mobile single-column layout without being zoomed. F6 does not change the width threshold or sidebar settings. The repository's existing native zoom status segment can help distinguish zoom from a narrow layout. There is no composite focus mode or guaranteed return-to-layout operation here. The existing native sidebar binding remains separate, normally prefix+b.

Use **F1** to inspect effective bindings and descriptions: look for zoom and last/previous pane, and check for conflicts or privately customized keys. Verify F1/F2/F4/F10 still show their original actions. A config parser accepting a key does not prove that the outer terminal forwards it, that an overlay handles it the same way, or that a remote client selects this keymap.

Native contracts: Herdr 0.9.5 `--default-config`, plus [client actions](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/actions.rs), [focus history](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/state.rs) and [zoom semantics](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/actions.rs).

## Stage without changing live settings

1. Confirm `herdr --version` reports `herdr 0.9.5`. Recheck defaults and validation for any other version.
2. Make a private backup and a separate staging copy of the intended config. Record whether `keys.zoom` and `keys.last_pane` were absent or their exact original values. Do not publish private config, expanded paths or diagnostic transcripts.
3. Edit only the staging copy's existing `[keys]` table, before any `[[keys.command]]` or other table. Add `zoom = ["prefix+z", "f6"]` and `last_pane = "f7"` only if absent. For existing assignments, preserve wanted aliases and add the direct key to that action's array. Never duplicate an assignment/table, blindly concatenate this fragment, or replace a whole config with it. Dotted/inline key definitions require editing their existing structure instead.
4. Check every built-in, indexed and custom-command binding for F6/F7 collisions, plus the outer terminal and agent bindings. Stop if the structure or ownership is unclear. Review the private diff: only these action bindings should change. Leave commands, input/paste bindings and all UI/layout settings alone.
5. Validate the staging file with an explicit temporary path override, restored on failure too:

```powershell
$focusStaged = '<absolute-path-to-private-staged-config.toml>'
if (-not [IO.Path]::IsPathRooted($focusStaged) -or
    -not (Test-Path -LiteralPath $focusStaged -PathType Leaf)) {
    throw 'Choose an existing absolute staging path.'
}
$focusPreviousPath = $env:HERDR_CONFIG_PATH
try {
    $env:HERDR_CONFIG_PATH = $focusStaged
    herdr config check
    if ($LASTEXITCODE -ne 0) { throw 'Staged config failed validation. Do not apply it.' }
} finally {
    $env:HERDR_CONFIG_PATH = $focusPreviousPath
}
```

Validation does not apply or activate settings. This change adds no installer/CI wiring and performs no live copy, reload, restart or synthetic key input. Any later integration needs separate owner authorization and a fresh comparison with the then-current config. Do not overwrite intervening changes using an old staging copy.

## Focused checks and rollback

```powershell
node --test tests/focus-keys.test.mjs
```

The default suite checks the setting allowlist, collisions (including custom commands), protected controls, and exact staging/rollback of public detailed and compact profiles. It is not a general private-TOML merger. To also run native checks on temporary files:

```powershell
$focusPreviousCheck = $env:HERDR_FOCUS_KEYS_NATIVE_CHECK
try {
    $env:HERDR_FOCUS_KEYS_NATIVE_CHECK = '1'
    node --test tests/focus-keys.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Focus key checks failed.' }
} finally {
    $env:HERDR_FOCUS_KEYS_NATIVE_CHECK = $focusPreviousCheck
}
```

Native tests invoke only version/default-config/config-check commands with child-process staging overrides. They validate the fragment and both merged profiles. No private config, live focus or agent is queried or changed.

Before integration, rollback means discarding the staged copy. After separately authorized integration, restore only the original zoom/last_pane values or remove the assignments if originally absent. Preserve later aliases and unrelated edits. Validate a staged rollback first. Any activation of that rollback is a separate human action, not part of these tests.

## Human verification boundary

After separately approved integration/activation, a human must check key forwarding in their actual terminal and agent setup. Start in ordinary terminal mode with no approval dialog open. Inspect F1, then observe F6 twice on an existing split tab, once from an already-zoomed tab, and on a single-pane/narrow view. Verify that F7 returns to the expected existing pane and goes back again. Check the labels before typing. Confirm ordinary agent input, paste and F1/F2/F4/F10 still work. Do not send test prompts, answer approvals, or create/close panes just to manufacture evidence.

Parser and collision checks do not establish that physical keys were delivered or that live focus/zoom behaved as expected. Remote keymap selection, narrow-layout behavior and live rollback are also unverified. Keep issue #17 open until integration and human validation. Issue #4's broader composite-focus request is not implemented.

# Native attention-first workflow

Opt-in follow-up to [issue #14](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/14). The [fragment](../config.attention.toml) changes only `ui.agent_panel_sort` to `"priority"` on Herdr 0.9.5. Existing compact rows, per-agent rows, state indicators, detector, hooks, and keybindings remain yours. No installer option, custom inventory, or jump helper is added.

## Use the existing client

Priority ordering puts blocked agents before done, working, idle, and unknown. Online endpoints precede stale endpoints; within a priority, recent activity breaks ties. Rows can move as state changes, so check the label and machine before selecting. A saved manual sidebar sort preference or an active agent view with its own sort can override the config; inspect the native UI if the order differs. This fragment does not reset those preferences or filters.

The repository already binds **Ctrl+K** and **prefix+g** to Goto. Check F1 for your effective binding if privately customized. In the native Goto picker, with the search field **not focused**:

| Key | Native action |
| --- | --- |
| `b` | Blocked agents needing input |
| `d` | Done agents according to this client's completion state |
| `a` | All; clears the status filter and search query, including ordinary terminals |
| `w` / `i` | Working / idle |
| `/` | Focus text search; clears the status filter |
| Up / Down | Select a row |
| Enter | Open the selected target |
| Esc | Leave search first; otherwise close Goto |

While editing search, letters are text, not filters. Press Esc once to leave search before `b`, `d`, or `a`. Filtering also clears the text query. Confirm the target's machine/workspace/pane before Enter, especially when stale or disconnected entries are present. Goto retains its native navigation and grouping; sidebar priority sorting does not promise an identically sorted picker. Inspect the actual prompt before answering it; navigation never authorizes an approval.

**Done is not task acceptance or a durable unread inbox.** The client tracks completion acknowledgment per endpoint boot and pane sequence, based on presented pane surfaces. A new boot's initial snapshot establishes a baseline. CLI/API `done` uses server-side seen state and cannot prove what the displayed client has seen, which endpoint it displays, or what another client has acknowledged. An empty done filter therefore does not prove all work was reviewed. Unknown and stale states remain uncertain. Existing [read-only attention helper limitations](issue-2-attention.md) still apply; this workflow uses native Goto rather than extending that helper.

Contracts inspected in Herdr [v0.9.5](https://github.com/herdrdev/herdr/tree/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01): [config model](https://github.com/herdrdev/herdr/blob/v0.9.5/src/config/model.rs), [picker keys](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/overlay_input.rs), [aggregate navigation](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/aggregate_navigation.rs), and [client acknowledgment](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/endpoint_agent_state.rs).

## Merge and validate offline

1. Confirm `herdr --version` reports `herdr 0.9.5`. On another version, recheck its native defaults/help and config validation before adopting this fragment.
2. Make a private backup and a separate staging copy of your intended config, outside this checkout. Record whether `ui.agent_panel_sort` was absent or its exact old value. Keep both copies private; never publish their contents or diagnostics containing personal paths.
3. Edit **only the staging copy**: set `agent_panel_sort = "priority"` in the existing `[ui]` table, before the next table header. Replace an existing assignment; do not duplicate it. If `[ui]` is absent, add that table only if no dotted/inline `ui` definition conflicts. For those forms, edit the existing definition instead. Do not concatenate this fragment or use it as a replacement config. Leave all row layouts, detectors, commands, and unrelated settings untouched.
4. Review the private diff: only this setting should change. If the structure is ambiguous, stop and resolve the TOML structure manually. There is no automatic private-config merger.
5. Validate the staged file explicitly. Substitute its absolute path below. The environment override is restored even on failure:

```powershell
$attentionStaged = '<absolute-path-to-private-staged-config.toml>'
if (-not [IO.Path]::IsPathRooted($attentionStaged) -or
    -not (Test-Path -LiteralPath $attentionStaged -PathType Leaf)) {
    throw 'Choose an existing absolute staged config path.'
}
$attentionPreviousPath = $env:HERDR_CONFIG_PATH
try {
    $env:HERDR_CONFIG_PATH = $attentionStaged
    herdr config check
    if ($LASTEXITCODE -ne 0) { throw 'Staged config failed validation; do not apply it.' }
} finally {
    $env:HERDR_CONFIG_PATH = $attentionPreviousPath
}
```

Validation does not install or activate the fragment. This issue's implementation performs no live copy, reload, restart, hook replacement, or approval. Any later integration must merge the single setting into the then-current config after checking for intervening edits; never overwrite a newer private config with the staged snapshot. Activation and human validation are separate work.

## Checks and rollback

Run deterministic public-fixture checks from the repository root:

```powershell
node --test tests/attention-profile.test.mjs
```

To additionally validate the fragment and staged public detailed/compact profiles with the installed native 0.9.5 parser:

```powershell
$attentionPreviousCheck = $env:HERDR_ATTENTION_NATIVE_CHECK
try {
    $env:HERDR_ATTENTION_NATIVE_CHECK = '1'
    node --test tests/attention-profile.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Attention profile checks failed.' }
} finally {
    $env:HERDR_ATTENTION_NATIVE_CHECK = $attentionPreviousCheck
}
```

Tests allowlist the fragment's sole setting, model the manual edit on public fixtures, and compare every unrelated byte, including compact rows and keybindings. Native checks use temporary files and child-process `HERDR_CONFIG_PATH` overrides, never private config or a running server. They do not test a general TOML merger or UI behavior.

Implementation checks on 2026-10-23: the default test command exited 0 (3 passed, native check skipped); the opt-in command exited 0 (4 passed). Herdr 0.9.5 `config check` exited 0 for all three temporary configs: fragment, detailed profile, and compact profile. No live installation was changed.

Before integration, rollback means discarding your staged copy. After a separately authorized integration, restore only the prior `ui.agent_panel_sort` value (normally `"spaces"`), or remove this assignment if it was previously absent. Validate a staging copy of that rollback the same way. Preserve subsequent edits; use the backup as a reference, not a wholesale overwrite. Any activation of rollback remains a separate human action.

Keep issue #14 open until integration and human validation. Live ordering, effective Ctrl+K handling, blocked/done/all selection, remote or stale targets, acknowledgment across clients, and unchanged compact rendering are unverified by these checks. A human should compare the native labels with actual pane state after separately authorized activation.

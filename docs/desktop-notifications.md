# Windows desktop notifications, sound off (#18)

This opt-in [fragment](../config.desktop-notifications.toml) uses native Herdr 0.9.5 settings:

```toml
[ui.toast]
delivery = "system"

[ui.sound]
enabled = false
```

Only delivery and the global Herdr sound switch are changed. Existing `ui.toast.delay_seconds`, `ui.toast.clipboard.enabled`/`position`, in-app toast position, compact/per-agent rows, keys, detectors and sound overrides remain untouched. No polling, plugin, notification daemon, helper, dependency or default binding is added. The installer does not apply this fragment. This change is not deployed or human-confirmed; keep issue #18 open for integration and human validation.

## What to expect

- `system` asks the operating system running the delivering client for a desktop notification. It replaces the agent-toast delivery choice; it does not mean simultaneous in-app and desktop agent toasts. Clipboard feedback is a separate setting and remains unchanged.
- Native attention/completion events still depend on detected agent transitions, delay and current-state validation. A configured delay is not a guarantee of a later popup: an obsolete event can be discarded. A notification is neither task acceptance nor permission to answer an approval.
- Active-tab suppression is intentional: the client compares the event's endpoint/tab with its selected endpoint/tab (workspace fallback when no tab is provided). External notifications are suppressed for an active target while the outer terminal is focused or its focus is unknown. A split pane in the same selected tab can therefore be suppressed too. When outer-terminal focus is explicitly lost, native policy can allow external delivery. Host focus reporting and the installed build matter; do not promise a popup merely because the window is behind another app.
- `ui.sound.enabled = false` disables Herdr's own agent notification sounds, including per-agent `"on"` overrides. It is not a system-wide mute for Windows, the outer terminal or the agents. If complete silence is required, inspect Windows' per-app notification sound setting separately; do not assume this fragment controls unrelated audio.

### Windows checks (manual, no automatic changes)

Check **Settings → System → Notifications**: global notifications, the Herdr application's permission if listed, notification banners/Notification Center, and per-app sound preferences. Check **Do Not Disturb** (Focus assist on older Windows), Focus sessions and automatic quiet rules, full-screen/presentation restrictions, and organizational policy. Suppressed banners may be available only in Notification Center; absence there is not proof that an agent never needed attention.

The application entry/registration and activation support depend on the native Windows build and its packaging. This fragment does not install an app identity, modify the registry, grant a permission, override policy or disable Do Not Disturb. Do not run a synthetic notification command to verify this change as part of automated checks.

### Click-target limitations

Setting `delivery = "system"` does not add click-to-pane support. Native builds with actionable notification support can carry endpoint, endpoint-boot and pane identity and reject stale targets; untargeted/legacy notifications cannot promise that routing. A closed client, restarted/disconnected endpoint, removed pane, expired activation context or Windows foreground restrictions can prevent navigation. Do not assume clicking a toast reopens a session, raises the correct outer-terminal tab/window, focuses the right pane or submits any input. Use the existing native Goto picker and confirm the machine/workspace/agent manually when necessary. Never treat a click as an approval response.

### Local Windows versus remote/server scope

| Situation | Boundary |
| --- | --- |
| Native Windows Herdr client, local session | The local client can deliver native events to its Windows desktop under its effective notification settings and suppression policy. |
| Native Windows client attached to a compatible remote endpoint | Events that actually reach that client may be delivered locally. Detection, event transport, protocol/build support and client configuration still apply. |
| Editing only a remote server's config | Does not establish delivery to your Windows desktop or configure the local client's permissions/sound. Legacy server-driven delivery may differ. |
| Headless/unattached server or arbitrary SSH/WSL shell | No desktop-forwarding guarantee. A Linux Herdr process inside WSL is not automatically a native Windows notification client. |

This feature creates no forwarding bridge or remote agent installation. Configure the intended native Windows client's staged config, not an unrelated server or pane's cwd. The fragment cannot fix missing remote events or prove which client/endpoint is displayed. Multiple clients can have different effective settings and suppression decisions.

## Merge and validate without activation

1. Confirm `herdr --version` reports `herdr 0.9.5`; inspect another version's native defaults and parser before adopting the fragment.
2. Make a private backup and a separate staging copy of the intended client config, outside this checkout. Record the old values **and whether each assignment/table was absent**. Keep copies and diagnostics private.
3. In that staging copy only, change `delivery` to `"system"` in the existing `[ui.toast]` table and `enabled` to `false` in `[ui.sound]`. Replace assignments rather than duplicating them. If absent, add the assignment within its table. If a table is absent, add it only after checking for dotted/inline definitions; otherwise edit the existing definition. Do not concatenate the fragment or replace the full config with it: standalone fragment defaults need not preserve your delay, clipboard settings or layout.
4. Review the diff: only those two effective settings should change (the sound assignment may already be false). Preserve subsequent/private edits and every unrelated table. Ambiguous TOML needs manual resolution, not a guessed merge.
5. Validate only the staged file from **native Windows PowerShell**. Substitute an existing absolute staging path; this restores the environment override even on failure:

```powershell
$desktopStaged = '<absolute-path-to-private-staged-config.toml>'
if (-not [IO.Path]::IsPathRooted($desktopStaged) -or
    -not (Test-Path -LiteralPath $desktopStaged -PathType Leaf)) {
    throw 'Choose an existing absolute staged config path.'
}
$desktopPreviousPath = $env:HERDR_CONFIG_PATH
try {
    $env:HERDR_CONFIG_PATH = $desktopStaged
    herdr config check
    if ($LASTEXITCODE -ne 0) { throw 'Staged config failed validation; do not apply it.' }
} finally {
    $env:HERDR_CONFIG_PATH = $desktopPreviousPath
}
```

`config check` parses configuration; it does not send a notification, focus a pane, connect to a server or activate the change. Windows binaries need Windows paths: do not hand a WSL `/tmp/...` path to the Windows process and assume it was translated. Live merge/activation is separate, explicitly authorized work. No live copy, reload, server restart, hook replacement or permission change is performed here. Do not overwrite a newer live config with an older staged snapshot.

## Focused checks and evidence

From the checkout:

```powershell
node --test tests/desktop-notifications.test.mjs
```

Optional native parser checks must use Windows Node, from native Windows PowerShell:

```powershell
$desktopPreviousCheck = $env:HERDR_DESKTOP_NOTIFICATIONS_NATIVE_CHECK
try {
    $env:HERDR_DESKTOP_NOTIFICATIONS_NATIVE_CHECK = '1'
    node.exe --test tests/desktop-notifications.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Desktop notification config checks failed.' }
} finally {
    $env:HERDR_DESKTOP_NOTIFICATIONS_NATIVE_CHECK = $desktopPreviousCheck
}
```

Tests allowlist the fragment's two settings and model manual edits on public detailed/compact fixtures, plus nondefault delay/clipboard/sound settings. They verify byte-exact rollback and preservation outside the intended assignments. They are not a private-config merger. The opt-in check requires native Windows Node, uses only its own temporary config and child-process environment override, rejects an invalid sentinel to prove the override is honored, then validates the fragment and merged/rollback profiles. No notification API, approval, focus action, live config, credential, session transcript or running server is accessed. Owned temporary fixtures are removed only after identity/link checks; uncertain paths are retained rather than deleted.

Read-only contracts inspected: installed `herdr --help`, `--version`, `--default-config` and `config --help`; local native `src/config/model.rs`, `src/config/sound.rs`, `src/cli.rs::config_check`, `src/client/shell/config.rs`, `notification_policy.rs` and `src/client/notifications.rs`. The local native source archive includes local fixes; it does not prove identical click support in every stock 0.9.5 build. No native patch is required or installed by this fragment.

Implementation checks on 2026-10-23: the default command exited 0 (8 passed, native check skipped). The opt-in native Windows command exited 0 (9 passed). Herdr 0.9.5 accepted seven temporary configs (fragment and detailed/compact/custom merged/rollback profiles), each with `config: ok` and exit 0. The invalid sentinel was rejected with the expected exit 1, proving that the temporary path override was honored. The test removed its own fixture file and empty directory only after identity/link/content checks; no other temporary artifact was created by this issue.

Native parser acceptance alone does **not** verify a real toast, Windows permission/Do Not Disturb behavior, actual silence, host focus reporting, click routing or remote delivery. These remain human-validation items after separately authorized activation, using genuine workflow events rather than an automated notification probe.

## Rollback

Before integration, discard only your owned staging copy; retain the backup/evidence. After separately authorized integration, restore only the recorded prior `ui.toast.delivery` and `ui.sound.enabled` values, or remove the assignments if previously absent. Remove a newly added table only if empty and still owned by this change; preserve later entries. Validate a separate staging copy of the rollback in the same way. Use backups as references, never as a wholesale overwrite of newer configuration. Any rollback activation is a separate human action. No agent, desktop registration, OS permission, cache or session needs deleting.

# NEURA COCKPIT

A Windows-first Herdr 0.9.3 configuration for visible terminal agents: warm Linux-style colors, native state labels, small harness marks, real account limits, readable Markdown, and explicit working directories. WSL and Noctty support files are included separately.

This repository tracks the shareable configuration and setup, not a Herdr fork or binary release. It does not connect to your machines, sync private notes/calendars, change your existing agents' folders, or trust CLI hooks.

- [Setup map and local/SSH operating guide](docs/setup.md)
- [Feature and bug tracker](https://github.com/Rajveerx11/neura-cockpit-herdr/issues)
- [Lean-change policy](CONTRIBUTING.md): reuse native capabilities, keep additions opt-in, and avoid new daemons/dependencies or default UI clutter.

## Preview and install

Requirements: Herdr **0.9.3**, Node.js 22+, Windows PowerShell 5.1. Install Leaf separately for Markdown viewing; Lazygit is optional.

Review the code first, then stage an offline preview from PowerShell:

```powershell
.\install.ps1 -StageOnly
```

This creates a separate temporary directory, validates the generated config with `herdr config check`, and does not link plugins or replace the live configuration. An explicit staging location is also supported:

```powershell
.\install.ps1 -StageOnly -Destination "$env:TEMP\cockpit-preview"
```

To install, run the following inside Herdr after reviewing the generated configuration and plugin scripts:

```powershell
.\install.ps1
```

The installer validates before copying, backs up existing destination files with timestamped `.before-*` suffixes, and links the two included plugins. It refuses to replace an already installed `neura.branding` or `neura.usage`; use staging and merge deliberately instead. It never replaces a terminal binary or stops a server. A plugin-link failure is reported explicitly; inspect staged files and the registry before retrying.

Then press `Ctrl+Shift+R` in the client and run:

```powershell
herdr server reload-agent-manifests
```

Restore configuration/helper files from the timestamped backups if needed. The two plugin registrations can be disabled with Herdr's native plugin CLI; do not blindly remove other installations. The local `agent-detection/codex.toml` override shadows future downloaded Codex rules: periodically review newer vendor rules, or remove only this override to return to vendor detection.

## Controls

| Control | Action |
|---|---|
| F1 | Searchable effective help |
| F2 | Rename Agent, Workspace, or Both using checkboxes |
| F4 | Read-only context: actual folders, visible agent states, limits, shortcuts |
| Ctrl+K | Jump/search |
| Ctrl+Shift+M | Leaf Markdown picker/watch popup |
| Ctrl+Shift+U | Refresh supported account limits |
| Ctrl+Shift+R | Reload client configuration |
| Ctrl+Shift+G | Lazygit popup |

The theme is named **NEURA COCKPIT** in the title/header. Non-Local machine labels use cyan; native blocked/working/idle state labels remain authoritative.

The F2 helper performs all checks before mutation. Agent labels are normalized; workspace labels keep human-readable text. Selecting Both performs two native calls and restores original values on failure where possible. Herdr does not expose an atomic two-entity rename, so rollback failures are reported rather than claiming success.

## Visible workers and folders

`tools/spawn-agent.mjs` creates a worker **to the right**, in the manager's current workspace/tab and authoritative API cwd, without changing focus. It requires a manager large enough to leave both panes at least 60 columns wide. It refuses unsupported kinds, ambiguous readiness, or unsafe cleanup.

Inside Windows Herdr:

```powershell
node "$env:APPDATA\herdr\tools\spawn-agent.mjs" --kind codex --name reviewer --dry-run
node "$env:APPDATA\herdr\tools\spawn-agent.mjs" --kind codex --name reviewer
```

Avoid long simulated startup prompts: a real Codex launch has failed with `timed out discarding buffered terminal input`. Supply a short native startup prompt referencing a scoped task file when starting an agent manually. Do not submit prompts or answer approvals until you inspect the actual terminal. A hook-trust dialog is intentionally **blocked**.

`fx` is not a supported Herdr `agent start` kind. In-process fx children cannot be converted into terminal panes by this configuration. For explicitly visible delegation, the manager must choose a supported real CLI worker instead. Different projects can legitimately share a workspace: do not change existing agents' directories merely to match its label.

## WSL and Noctty

`wsl/herdr` is a managed-session Windows bridge. It translates Herdr's own `--cwd` / `--cwd=...` arguments and leaves agent arguments after `--` untouched. Back up your existing wrapper before installing it at `~/.local/bin/herdr`; keep its executable permission. It requires the real Herdr-provided environment and is not a general out-of-session launcher.

The optional `wsl/herdr-spawn` wrapper needs `HERDR_COCKPIT_TOOLS` set to the WSL path of the installed tools directory. Do not copy another person's absolute paths.

Merge `noctty/config.ghostty` into your Noctty configuration after backing it up. The palette and `Ctrl+V` / `Alt+V` paste bindings were confirmed with Noctty `+show-config`. Installed Noctty 1.3.131 reports `FileTooBig` for `+validate-config`, including with the exact file path; this is not recorded as a successful validator run.

## Limits, clipboard, and SSH boundaries

The usage plugin reads only current credentials maintained by supported CLIs, never refreshes them, and queries the corresponding account usage endpoints. It caches rendered usage and credential-file revision metadata, not access tokens or account identifiers. Account-quota windows come from the provider response; API-key-only auth does not invent subscription limits. Freshness is bounded to two minutes. Idle tokens expire; focus/state events or `Ctrl+Shift+U` refresh them.

The optional `patches/windows-clipboard-paste-v0.9.3.patch` contains the missing Windows Unicode clipboard reader and Ctrl+V/Alt+V routing. It passed deterministic tests and an injected-key smoke test through a separate running Windows client. A separately built normal-profile client was activated on the reference setup, and the human confirmed text Ctrl+V works. **The config installer does not apply the patch or replace your installed binary.** Alt+V, screenshot/image paste, each harness, and SSH application paths need separate verification. Raycast keyword expansion is a separate integration and is not claimed fixed by this bundle.

SSH machines must be configured using your own authorized target and authentication. No SSH aliases, keys, known-hosts files, private calendars, Obsidian notes, runtime sessions, clipboard/history databases, auth files, or usage caches are shipped. Authorized remote 0.9.3 setup, reachability, and cross-machine workspace/pane discovery passed on the reference setup. Existing plain-SSH agents are not automatically adopted; complete remote agent lifecycle sync is not claimed verified. See [the SSH guide](docs/setup.md#ssh-over-an-existing-trusted-connection).

## Bug fixes before enhancements

Codex now uses the distinct `>_` compact mark, not a Claude-like star. The plugin only updates branding tokens, never lifecycle state. The reference setup's live token was verified.

Optional source patches for stale fx blocked-state and local Windows-to-WSL screenshot paste are documented in [the bug-fix guide](docs/bug-fixes.md). They are regression-tested but not automatically installed or claimed live-verified. Existing agents and servers are preserved; no new daemon, dependency, or protocol is added. Enhancements remain deferred.

## Deterministic checks

```powershell
node --test tests/spawn-agent.test.mjs tests/branding.test.mjs plugins/neura-usage/usage-report.test.mjs
powershell.exe -NoProfile -File tests/rename-context.tests.ps1
powershell.exe -NoProfile -File tests/install-stage.tests.ps1
```

In WSL, run `python3 tests/wsl-cwd-bridge.test.py`; it requires `wslpath` and `/mnt/c`. The installer staging test requires an installed Herdr 0.9.3 and an existing live config, but never replaces that config or links plugins.

The packaged copy passed all 87 Node cases (71 spawning + 16 usage), 41 rename cases, 13 WSL bridge cases, and isolated installer staging/backups/live-destination refusal. Spawning also passed under Linux Node. CI runs the mocked Node suites on Windows/Linux and the rename suite on Windows; it does not exercise live credentials, account requests, SSH, installer deployment, or the clipboard patch. The matching Herdr source's detector suite passed 24 tests, including hook-dialog and stale-dialog regressions. User-facing popup/physical keyboard checks remain separate.

Licensed under Apache-2.0; see `LICENSE` and `NOTICE`.

# NEURA COCKPIT

A Windows-first Herdr 0.9.5 configuration for visible terminal agents: warm Linux-style colors, native state labels, one agent name per entry, real account limits, readable Markdown, and explicit working directories. WSL and Noctty support files are included separately.

This repository tracks the shareable configuration and setup, not a Herdr fork or binary release. It does not connect to your machines, sync private notes/calendars, change your existing agents' folders, or trust CLI hooks.

- [Setup map and local/SSH operating guide](docs/setup.md)
- [Feature and bug tracker](https://github.com/Rajveerx11/neura-cockpit-herdr/issues)
- [Current issue work and verification boundaries](docs/issue-progress.md)
- [Lean-change policy](CONTRIBUTING.md): reuse native capabilities, keep additions opt-in, and avoid new daemons/dependencies or default UI clutter.

## Preview and install

Requirements: Herdr **0.9.5**, Node.js 22+, Windows PowerShell 5.1. Install Leaf separately for Markdown viewing; Lazygit is optional.

Review the code first, then stage an offline preview from PowerShell:

```powershell
.\install.ps1 -StageOnly
```

This creates a separate temporary directory, validates the generated config with `herdr config check`, and does not link plugins or replace the live configuration. Add `-CompactRows` to preview an optional two-line agent/state and workspace/machine layout. Omit it to keep the existing layout. Details remain in F4. An explicit staging location is also supported:

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

## Optional local helpers

These helpers are now installed on the authorized Windows reference installation. The installer copies them beside the existing tools without adding bindings. Stage and review before updating another installation. See the [local rollout and rollback record](docs/helper-rollout.md).

- [Manager + reviewer preset](docs/workspace-preset.md): keeps the existing manager and adds one right-hand reviewer in a single-pane tab. Start with `node .\tools\workspace-preset.mjs --kind codex --dry-run`. Normal mode creates a real pane and agent, so invoke it only when intended. No prompts are submitted. Readiness requires explicit native confirmation.
- [Workspace-linked notes](docs/issue-9-workspace-notes.md): render one explicitly selected project note with Leaf using a manually maintained local JSON mapping. No discovery, note writes, or default shortcuts. Map/project/note paths must use their exact normalized spelling, including case.
- [Connection/build evidence](docs/issue-3-identity.md): `tools/cockpit-status.ps1 -Identity -EndpointSocket '<absolute-api-socket>'` reports the trusted injected CLI's build/fingerprint and that explicit endpoint only. Displayed-client identity and provenance remain unknown. Default F4 is unchanged.

The [snippet composer remains blocked](docs/issue-8-snippet-blocker.md): Herdr 0.9.5 does not expose the fail-closed draft-paste contract this feature needs. No paste workaround was added.

## WSL and Noctty

`wsl/herdr` is a managed-session Windows bridge. It translates Herdr's own `--cwd` / `--cwd=...` arguments and leaves agent arguments after `--` untouched. Back up your existing wrapper before installing it at `~/.local/bin/herdr`; keep its executable permission. It requires the real Herdr-provided environment and is not a general out-of-session launcher.

The optional `wsl/herdr-spawn` wrapper needs `HERDR_COCKPIT_TOOLS` set to the WSL path of the installed tools directory. Do not copy another person's absolute paths.

Merge `noctty/config.ghostty` into your Noctty configuration after backing it up. The palette and `Ctrl+V` / `Alt+V` paste bindings were confirmed with Noctty `+show-config`. Installed Noctty 1.3.131 reports `FileTooBig` for `+validate-config`, including with the exact file path; this is not recorded as a successful validator run.

## Limits, clipboard, and SSH boundaries

The usage plugin reads only current credentials maintained by supported CLIs, never refreshes them, and queries the corresponding account usage endpoints. It caches rendered usage and credential-file revision metadata, not access tokens or account identifiers. Account-quota windows come from the provider response. API-key-only auth does not invent subscription limits. Freshness is bounded to two minutes. The reporter labels fresh quota and cache age, announces refreshing before a request, and reports stale age without old percentages after a failed same-revision refresh. Unavailable data is explicit for all supported providers. Labels describe the last event, not a live clock. Idle tokens still expire. Focus/state events or `Ctrl+Shift+U` refresh them.

The `patches/*-v0.9.3.patch` files are historical matching-source patches, not Herdr 0.9.5 updates. The previous custom 0.9.3 client passed deterministic and injected-key text-paste checks, followed by human text Ctrl+V confirmation. That does not verify screenshot paste or current 0.9.5 behavior. **The config installer never applies binary patches or replaces your installed executable.** The archived patches have not been ported or activated on 0.9.5. Raycast expansion remains a separate integration.

SSH machines must be configured using your own authorized target and authentication. No SSH aliases, keys, known-hosts files, private calendars, Obsidian notes, runtime sessions, clipboard/history databases, auth files, or usage caches are shipped. Authorized remote 0.9.3 setup, reachability, and cross-machine workspace/pane discovery passed on the reference setup. Existing plain-SSH agents are not automatically adopted; complete remote agent lifecycle sync is not claimed verified. See [the SSH guide](docs/setup.md#ssh-over-an-existing-trusted-connection).

## Bug fixes before enhancements

Agent rows show the native name once, without a duplicate branding mark. Custom worker names and unknown harness labels keep the same native token. The branding plugin still offers marks for opt-in layouts (Codex uses `>_`), but never changes lifecycle state.

Historical source patches for stale fx blocked state and screenshot paste are documented in [the bug-fix guide](docs/bug-fixes.md). Their tests belong to their stated source versions, not 0.9.5. The compact layout and updated helpers are now deployed on the authorized reference installation. See [the 0.9.5 rollout](docs/herdr-095-rollout.md) for runtime checks and rollback boundaries. The [issue work log](docs/issue-progress.md) distinguishes implemented work from partial or pending issues. Human visual and screenshot confirmation remain separate.

## Deterministic checks

```powershell
node --test tests/spawn-agent.test.mjs tests/workspace-preset.test.mjs tests/workspace-notes.test.mjs tests/branding.test.mjs plugins/neura-usage/usage-report.test.mjs
powershell.exe -NoProfile -File tests/rename-context.tests.ps1
powershell.exe -NoProfile -File tests/cockpit-attention.tests.ps1
powershell.exe -NoProfile -File tests/cockpit-identity.tests.ps1
powershell.exe -NoProfile -File tests/install-link.tests.ps1
powershell.exe -NoProfile -File tests/install-stage.tests.ps1
```

In WSL, run `python3 tests/wsl-cwd-bridge.test.py`; it requires `wslpath` and `/mnt/c`. The installer staging test requires an installed Herdr 0.9.5 and an existing live config, but never replaces that config or links plugins.

The helper batch passed 184 Node tests and 74 mocked PowerShell cases before local installation. The installed identity helper passed an explicit local-endpoint check, and installed Leaf rendered a disposable generated note through the notes helper. Native default/compact installer staging also passed. See the [rollout record](docs/helper-rollout.md) for boundaries and backups. CI is configured for Node suites on Windows/Linux and mocked PowerShell suites on Windows; consult each published commit's checks for hosted results. LSP was unavailable because the TypeScript language server is absent.

The earlier deployed batch passed 13 WSL bridge cases and native 0.9.5 staging for both layouts, including backup and rollback checks. Those historical checks do not verify the new preset's live behavior. Clipboard and remote harness checks remain separate. [The rollout record](docs/herdr-095-rollout.md) lists earlier live verification and its limits.

Licensed under Apache-2.0; see `LICENSE` and `NOTICE`.

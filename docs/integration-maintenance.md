# Integration freshness and manual maintenance

Issue [#15](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/15) adds an opt-in diagnostic, not an updater. It does not change F4, install hooks, launch agents, answer approvals, change trust, reload configuration, or restart Herdr. No live installation change is authorized by this guide.

## Run a read-only check

From the repository in Windows PowerShell 5.1:

```powershell
powershell -NoProfile -File .\tools\cockpit-integrations.ps1 -Binary 'C:\trusted\herdr.exe'
```

Replace the placeholder with a Herdr executable you trust. If omitted, `-Binary` uses `HERDR_BIN_PATH`. An absent or invalid value fails without searching PATH or aliases. An absolute path selects a binary, but does not prove its provenance. The helper works from the checkout without installation or a new shortcut.

The helper starts only that executable with the fixed arguments `integration status`. It inherits the caller's integration-home environment without changing it. It captures output in memory, discards native paths and stderr, and prints only known target names with their status and version labels. A probe timeout terminates only its own status subprocess. There is no polling, network request, credential-file read, or repair step in the helper.

Herdr 0.9.5 exposes this command as text, without a JSON option. The parser accepts the inspected formats, including `letta (experimental)` and legacy versions. A future format or new target fails closed rather than guessing. The known target list is pinned to the inspected CLI, not discovered from private directories.

| Summary state | Meaning |
| --- | --- |
| `current` | Native CLI reports the installed integration current relative to that executable's bundled version. |
| `outdated` | Native CLI reports an older/legacy integration, or `needs repair`. The native detail remains visible. Nothing is repaired. |
| `not-installed` | Native CLI explicitly reports `not installed`. This does not mean the agent application is absent. |
| `unavailable` | CLI could not run, failed, timed out, returned invalid output, or omitted a known target. It is not evidence of absence or freshness. |

Exit **0** means the known inventory parsed completely, even if integrations are outdated or not installed. Exit **1** means CLI/parse failure or an incomplete inventory. Command and parse failures make every row unavailable. In a partial inventory, valid reported rows remain visible and omitted targets are unavailable. Errors use fixed messages rather than echoing native output or personal paths.

Native status is limited evidence. For Claude and Codex it primarily checks the installed hook's version marker. A current marker does not establish correct registration, exact file integrity, successful event delivery, or active code in a running agent. The helper does not inspect credentials, agent sessions, process memory, or the selected client host. It does not query a remote machine.

If parsing fails after a Herdr update, stop there. A human can run the trusted executable's `integration status --help` and `integration status` locally to inspect its current contract. Raw native status includes personal paths: do not paste it into an issue or public report. Do not run an installer merely to make the diagnostic green.

## Windows and WSL are separate installations

| Context | Typical Claude home | Typical Codex home |
| --- | --- | --- |
| Windows executable | `%USERPROFILE%\.claude` | `%USERPROFILE%\.codex` |
| Native Linux executable in one WSL distribution | `$HOME/.claude` | `$HOME/.codex` |

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` override those respective defaults. Confirm overrides locally without publishing their values. Each WSL distribution has its own Linux home and can have a different Herdr build. Invoking a Windows `.exe` from WSL still checks Windows integrations. A `/mnt/c` working directory does not select Linux homes. Shared or redirected homes need deliberate review, not automatic copying between platforms.

The PowerShell helper is Windows-only. In WSL the safe fallback is the native Linux `herdr integration status`, after confirming which executable will run. Its output is not redacted. Run it separately in the intended distribution. Do not launch or install WSL software just for this check. Windows and WSL hooks can use different script extensions and shell commands. Never copy Windows hook registrations into Linux settings, or the reverse.

## Before any manual update

1. Choose one platform and executable. Identify the target integration's effective home. Inspect that build's `integration install --help` locally. Check whether the target is outdated, deliberately customized, or simply not installed. Do not install every missing integration. CLI/server/client builds may differ. The freshness baseline is the executable you invoked, not an already-running server or attached UI.
2. Ask the owner to approve the exact target and configuration changes. Schedule a pause for affected agents and save their work. Updating hooks while an agent is running can leave mixed old/new behavior. Do not interrupt an approval dialog, send synthetic input, or change trust to proceed.
3. Make private backups of only the affected hook and registration files. Record which existed and their hashes. Note permissions and exact restore locations. Do not back up whole agent homes: they can contain credentials and private sessions. Keep receipts and backups outside Git and public reports. Verify backups before writing anything. If any affected path is shared, linked, or unexpectedly redirected, stop for manual review.

For the inspected Claude/Codex integration layout, review these files in the selected home:

| Target | Hook and registration/configuration to back up |
| --- | --- |
| Claude | `hooks/herdr-agent-state.ps1` on Windows or `hooks/herdr-agent-state.sh` on Linux. Also `settings.json`. |
| Codex | `herdr-agent-state.ps1` on Windows or `herdr-agent-state.sh` on Linux. Also `hooks.json` and `config.toml`. |

Also preserve an existing legacy `.sh` sibling on Windows if present: native installation can remove it. Review the exact trusted build's behavior if its layout differs. Registration/configuration files can contain private data. Copy them locally without printing them, and never include them in an issue attachment. Preserve custom settings and unrelated hooks.

## Update and activate only after approval

These are manual examples, **not diagnostic steps**. Run only the single target the owner approved, with the same trusted binary and effective home used for the check:

```powershell
# Windows: Claude example, only after backup and explicit owner approval.
& 'C:\trusted\herdr.exe' integration install claude
```

For a separately approved Codex change, replace `claude` with `codex`. Do not run both as a batch.

In WSL use that distribution's trusted native executable and the same `integration install claude` or `integration install codex` arguments, only after separate approval. Do not use `uninstall` as a backup or rollback mechanism. If installation fails, it may already have changed a hook before failing to update its registration. Inspect the affected files against the backup and stop before retrying.

After the approved update, compare only affected files with the private backup. Verify unrelated registrations, permissions and custom settings were preserved. Rerun the read-only status check. A current result confirms installed freshness only.

Installed files and running code are different. An extension may have been loaded at agent startup. A hook may read new bytes on its next event while the agent retains old registration or environment. Neither case proves activation. Ask the owner separately before exiting or restarting each affected agent, then use the agent's supported startup/resume workflow. Do not automate that step or launch a disposable agent without permission. No Herdr server restart or configuration reload is part of this guide.

After the owner confirms activation, observe an ordinary approved task through working, idle and approval states as applicable. Never manufacture or auto-answer an approval for testing. Record only redacted observations. File-version status alone cannot close issues #10, #11 or #15.

## Rollback

Pause affected agents only with permission. Use the exact backup receipt for that platform and home. Compare current hashes with the recorded post-update hashes first. If later edits exist, stop and reconcile them instead of overwriting them.

Restore the backed-up hook and registration/configuration files with their original permissions, including any removed legacy hook. Remove a newly created file only if the receipt says it did not exist and its current hash still matches the update. Do not restore entire directories, touch credentials, or remove unrelated hooks. Check restored registration locally and rerun native status. An intentionally restored older version can correctly report outdated. Reactivating restored code requires the same separate owner confirmation as an update. Do not downgrade binaries or restart the Herdr server as a shortcut.

The repository diagnostic itself needs no live rollback: it is not installed and writes no state. Stop invoking it to opt out. Remove only its task-owned files if abandoning the repository change. No config or shortcut restoration is needed.

## Focused verification

```powershell
powershell -NoProfile -File .\tests\cockpit-integrations.tests.ps1
```

The tests use inert executable fixtures and mock the process boundary. They cover native status variants, omitted targets, command/start/timeout failures, malformed output, redaction, exit codes and a command allowlist that rejects mutation commands. They never run an integration installer or query a live agent. This check is manual. No CI or installer wiring is added.

The inspected Windows CLI reported Claude and Codex outdated. Only help/status and the read-only helper were used for native validation. Integration installation, rollback on a live home, WSL execution, running-code activation and human workflow behavior remain unverified. Keep issue #15 open until integration and human validation are complete.

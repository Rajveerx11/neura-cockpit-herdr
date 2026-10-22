# Local helper rollout

The reviewed helper batch is installed on the authorized Windows reference installation running Herdr 0.9.5. This is not a binary release or an installation on remote machines. The published installer remains a staging/install tool for new configurations. Existing installations should review and merge helper updates rather than overwrite private configuration.

## Installed files

Five files under `%APPDATA%\herdr\tools` now match the reviewed source hashes:

- `cockpit-identity.ps1`: new opt-in CLI build/fingerprint and explicit endpoint evidence.
- `workspace-preset.mjs`: new manager + reviewer preset entrypoint.
- `workspace-notes.mjs`: new explicit local mapping and Leaf renderer.
- `spawn-agent.mjs`: preset guards and explicit boolean readiness confirmation.
- `cockpit-status.ps1`: identity mode alongside the unchanged default F4 view.

The existing `rename-context.ps1` dependency was checked against the earlier reviewed baseline and left unchanged. The existing F4 binding already targets the installed status helper. Helpers are loaded on invocation, so no configuration reload or server restart was needed. No new shortcut was added.

Configuration hashes matched before and after installation. Plugin registrations and sources were not changed. No binary, machine profile, agent directory, focus, or pane was modified by the deployment script. No reviewer agent was launched, and no prompt or approval response was sent.

## Verification

| Check | Result |
| --- | --- |
| Node feature and regression suites | 184 passed |
| Mocked PowerShell suites | 74 passed: 41 rename, 11 attention, 16 identity, 6 installer |
| Native installer staging | Default and compact layouts passed config validation, backup checks and live-destination refusal |
| Deployment fixtures | Plan, verified backups/receipt, five installed hashes, configuration preservation, idempotence, non-file refusal and concurrent-edit rollback passed |
| Independent feature integration review | 20 files reviewed, zero skipped, no remaining code blockers |
| Private deployment-script review | Initial concurrent-edit finding corrected and independently rechecked before live use |
| Installed files | All five source hashes matched |
| Installed identity helper | Actual `-Identity -TestRender` passed against the explicit local API socket. CLI and server reported 0.9.5 |
| Installed preset/notes entrypoints | Both `--help` checks passed |
| Installed notes helper | Native Leaf rendered a disposable generated note through the installed helper |

Local checks are not hosted CI results. GitHub Actions runs on publication. Inspect the commit's checks for its Windows/Linux result. LSP was attempted but the TypeScript language server is absent. The second-model prose pass was unavailable. Authored prose received manual review and local linting.

Issue #3 remains partial: CLI evidence cannot identify the displayed UI client or its selected host. Issue #8 remains blocked, with no paste workaround. The preset's real agent launch/layout/focus behavior and note selection using human project data still need explicit workflow confirmation. These checks do not establish remote harness or screenshot behavior. No GitHub issue was closed by the rollout.

## Backups and rollback

Private receipts and backups are under `%APPDATA%\herdr\backups\helpers-*`. Use the exact receipt created for your installation, not a wildcard restore. The receipt records source/original hashes, which files existed, and their backup locations. It is not published.

Existing helpers have verified original backups. Atomic replacement also retains the bytes actually displaced. If a concurrent edit is detected, the rollout fails and attempts to restore those displaced bytes. Any edit racing rollback is retained for manual recovery rather than discarded. Crash durability and every rollback race were not exhaustively tested.

Before rollback, verify that each installed target still matches its recorded source hash. Restore only the affected existing helpers from their receipt's backups. Remove a newly introduced helper only if it still matches its recorded source hash. Restore the prior `cockpit-status.ps1` before removing its identity dependency. Preserve any later edits and leave all other configuration and plugins alone. Helpers are read on invocation. Rollback does not require a server restart or binary downgrade.

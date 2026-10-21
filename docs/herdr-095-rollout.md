# Herdr 0.9.5 rollout

The profile now targets [Herdr v0.9.5](https://github.com/herdrdev/herdr/releases/tag/v0.9.5), the latest stable release checked for this update. Contract inspection used the official tag at commit `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`.

This records one authorized live installation. It is not permission for the installer to overwrite another user's existing configuration.

## Compatibility changes

- The installer accepts exactly `herdr 0.9.5`. Older releases and preview/future versions are refused before destination writes.
- The spawn helper requires both CLI and server version 0.9.5, with compatible protocols. Its existing cwd, geometry and readiness checks remain in place.
- Plugin linking now uses the documented path-first form, `herdr plugin link <path>`. A strict mocked installer test covers this previously untested non-staging branch and a second-link failure.
- The optional compact template validates with native 0.9.5. Ordinary installation still keeps the original four-row layout unless `-CompactRows` is selected.

The versioned 0.9.3 clipboard patches remain historical. They were not applied to 0.9.5. The optional fx patch was not activated, and neither bug issue is closed by this rollout.

## Live changes

The installed CLI and server already reported 0.9.5 with compatible protocols. Both running Herdr process images matched the CLI executable's file hash. No binary replacement or server restart was needed.

The rollout validated a candidate made from the existing live configuration. Only its agent-row section changed to the compact layout. All other configuration text stayed identical, including private bindings. Existing helper paths were retained.

Changed helpers and usage-plugin files were copied with backups. The usage registration now points to the reviewed copy under `%APPDATA%\herdr\local-plugins\neura-usage`. Its previous external source was left intact. Both unrelated plugin registrations were verified unchanged.

Native `herdr server reload-config` returned `applied` with no diagnostics. In 0.9.5, the server requests attached clients to reload through `drain_client_config_reload_request`; clients handle that message through `apply_reload`. No simulated keys or agent prompts were used.

## Verification

| Check | Result |
| --- | --- |
| Node helper/plugin suites | 100 passed |
| Mocked PowerShell suites | 41 rename, 11 attention, 6 installer-link cases passed |
| WSL bridge | 13 passed against an owned argv-only executable |
| Native installer staging | Default and compact layouts validated, with backup preservation and rollback checks |
| Private rollout fixtures | 2 passed, including refusal of a backup junction before target mutation |
| Live config | Native validation passed and reload returned applied |
| Deployed files | Source hashes matched installed copies. Original config backup hash verified. |
| Pane preservation | All four pane identities, terminal IDs, directories and focus values matched before/after snapshots |
| F4 helper | One-shot rendering against the live context exited successfully |
| Attention helper | Explicit local-endpoint read succeeded without a focus action |
| Usage action | Native invocation finished with status succeeded and exit code 0 |
| Worker preflight | Native read-only dry-run succeeded. No worker pane was created. |
| Final source/document review | 18 files reviewed, zero skipped. OCR covered 12 code/config files, with six Markdown files reviewed manually. |

No live agent currently exposed supported provider metadata. The usage action therefore did not exercise a real account quota request. No provider was assigned just to manufacture a successful quota check.

The refresh labels remain event-time snapshots. Native idle token expiry still applies. Human visual comparison, physical screenshot paste and remote harness behavior are not established by these checks. The remaining issue scope is listed in [the work log](issue-progress.md).

LSP checks were attempted but could not run because `typescript-language-server` is absent. Syntax checks and runtime tests passed instead. The rival-model prose command failed, so editorial review was manual, with lint checks on new prose.

## Backups and rollback

Private backups are under `%APPDATA%\herdr\backups\cockpit-095-*`. The exact directory, file map and original usage registration are recorded in `.local/live-095-receipt.json` on the reference machine. Neither receipts nor expanded configuration are published.

Use the exact recorded backup, not a wildcard restore. Restore the prior config and the changed helpers from their recorded backups. For files introduced by this rollout, verify they still match the recorded deployed hash before removing them. Restore the original usage registration and its recorded enabled state through the native plugin CLI. Leave other plugins alone.

Validate the restored config before running `herdr server reload-config`. Rollback does not require a server stop or binary downgrade. Another installation must create its own backups rather than reuse this machine's receipt.

# Issue #3: connection and build evidence

Partial implementation. **Attached-client identity is blocked:** the inspected Herdr 0.9.5 CLI cannot establish which UI executable or host is displayed. This change does not close issue #3.

## Opt-in use

The existing F4 helper has an optional identity mode. Default F4 and attention behavior are unchanged. No binding is added. From a trusted caller, supply the reviewed CLI executable and an explicit API socket:

```powershell
$env:HERDR_BIN_PATH = 'C:\reviewed-tools\herdr.exe'
powershell.exe -NoProfile -File tools/cockpit-status.ps1 -Identity -EndpointSocket 'C:\fixture\explicit.sock'
```

The paths above are placeholders, not host discovery instructions. Only use an endpoint you are authorized to query. The executable must be an existing absolute local Windows `.exe` path supplied through `HERDR_BIN_PATH`. The caller must establish that this executable is trustworthy before invocation. There is no PATH lookup, profile discovery, `--machine` selection, or inherited/local socket fallback. Missing inputs report unavailable without launching a command. `-Identity` and `-Attention` together are rejected before querying.

`-TestRender` renders once without waiting for a key. Otherwise Esc or Q closes. The script exits zero after rendering, including unavailable states. That exit code is not a connectivity guarantee. Dot-sourcing remains inert.

## Evidence shown

- **Displayed client build and displayed host/connection:** always unknown. CLI endpoint connectivity is not UI connectivity.
- **Invoked CLI executable/build:** basename, version from `status client --json`, and SHA256 of the supplied file. The returned binary path must match the resolved executable. Full paths are not rendered. The supported build format is `0.9.5` with an optional channel/build suffix. Unsupported versions remain unknown.
- **CLI provenance:** unknown. Two binaries can report the same version. A different hash distinguishes bytes, not official versus custom provenance. No trusted release hash baseline is bundled.
- **Explicit CLI endpoint:** connected only for a matching-socket `status: running`, `running: true` response. Disconnected only for matching-socket `not_running`, `false`. Failed, timed-out, conflicting, or malformed responses are unknown, not an empty or local result. Server build is separate from CLI build.

The endpoint address, raw errors, and full status responses are not rendered. All evidence is an on-demand snapshot, not a live indicator. Local/remote host identity is not inferred from a pipe name, socket path, pane ID, or UI selection. Changing the explicit socket performs fresh reads without carrying forward the previous endpoint's state.

Only `status client --json` and `status server --json` are invoked. Output is decoded as UTF-8, including non-ASCII paths. PowerShell's JSON validation rejects extra roots and trailing commas. A token check rejects non-JSON primitives accepted by the platform decoders. A built-in .NET dictionary decoder rejects duplicate top-level JSON names, including escaped names. Case-conflicting names are also rejected before status fields are used. Build labels cannot contain trailing control characters. Each child receives the exact socket override and has a three-second process wait, followed by bounded output-drain or kill waits. The caller's environment is never changed. No server start/restart, agent, prompt, approval, clipboard, or focus commands are used. Hashing a file does not prove it was the UI executable, or exclude replacement between hashing and invocation.

## Native contract evidence

Inspected official [Herdr v0.9.5 source](https://github.com/herdrdev/herdr/tree/v0.9.5), commit `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`:

- `src/cli/status.rs::client_status_json` and `current_exe_label`: `version` comes from build metadata. `binary` comes from the invoked process's `current_exe`. Status uses bare JSON, not the regular API `result` envelope. This is not attached-UI process discovery.
- `src/build_info.rs::version`: stable version is the package version. Nonstable builds append channel and optional build ID. A custom build can retain the stable version.
- `src/cli/status.rs::server_status_json` and `read_server_runtime_status`: server responses contain `status`, boolean `running`, nullable `version`, and `socket`. A recognized unavailable local socket becomes `not_running`. Other errors can fail the command.
- `src/cli/target.rs::api_client`: without explicit `--machine`, the CLI uses its local API socket client, not the UI-selected machine. This helper never uses `--machine` or starts an SSH bridge.
- `src/session.rs::configure_from_args` and `active_api_socket_path`: with no explicit `--session` argument, `HERDR_SOCKET_PATH` overrides the session-default API socket. No session argument is passed here.
- `src/app/custom_commands.rs::custom_command_env`: popup environment includes the current process executable, API socket, and active IDs. Those values do not prove the displayed client process or its selected remote host. They are not treated as such here.

No attached-client identity API is claimed. Supporting that scope requires a verified client-side contract, outside this configuration-only change.

## Validation and rollback

```powershell
powershell.exe -NoProfile -File tests/cockpit-identity.tests.ps1
powershell.exe -NoProfile -File tests/cockpit-attention.tests.ps1
powershell.exe -NoProfile -File tests/rename-context.tests.ps1
```

Identity tests exercise the actual script entry and rendering with inert executable fixture files and mocked native process objects. Byte-backed output fixtures check UTF-8 decoding. Regressions cover conflicting or escaped duplicate JSON names, malformed roots and primitives, and version control characters. They check different fingerprints with identical versions and reject missing or ambiguous inputs. Invalid JSON and timeouts remain unknown. Other cases cover disconnected endpoints, local/remote-labelled socket transitions, environment preservation, and one-shot `-TestRender`. Existing suites check default F4 and attention behavior. No real agents or endpoints are used. PowerShell parser checks pass. LSP and PSScriptAnalyzer are unavailable in this environment.

Installed on the authorized Windows reference machine. The installed helper passed a one-shot identity check against an explicit local API socket. That establishes CLI/endpoint evidence only, not displayed-client identity. No live UI client comparison, remote connection, binary replacement, or binding change was performed. See the [rollout record](helper-rollout.md). The installer includes the identity helper dependency, and CI includes its tests. Independent review found encoding and parsing defects that received targeted fixes and follow-up validation. Second-model prose cleansing was unavailable. Prose was checked manually and with the local SlopMonster linter.

Rollback: restore `tools/cockpit-status.ps1` to its prior version and remove the new identity helper/test/document. If integrated elsewhere later, undo any opt-in binding separately. Do not remove the new helper while retaining the modified status script, which imports it. No runtime or authentication state needs rollback.

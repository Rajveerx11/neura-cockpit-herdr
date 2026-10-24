# Explicit manager bookmark: diagnostic only

`tools/manager-bookmark.mjs` is an opt-in, dependency-free terminal helper for an explicitly chosen pane and local CLI endpoint. **Return is BLOCKED on the inspected Herdr 0.9.5 contract.** Even matching IDs are not proof that the original server, boot or terminal still exists. This helper never sends focus or input, including for an explicit `return` command.

This is separate from F7's previous-pane history. It does not infer a manager from agent names, focused UI, injected pane variables, labels or shared cwd. The authorized Windows reference installation includes this diagnostic helper only; see the [deployment record](cockpit-wave-rollout.md). No return shortcut, focus action, default binding or polling is enabled.

## Commands

Supply a trusted Herdr 0.9.5 binary and the intended local API socket explicitly. On Windows, a local named pipe such as `\\.\pipe\<name>` is also accepted. These are placeholders; obtain the actual endpoint yourself. Remote paths, saved-machine connections and implicit endpoint discovery are unsupported.

```powershell
node tools/manager-bookmark.mjs --help

# Read-only diagnostic pin: no state file created.
node tools/manager-bookmark.mjs pin --herdr '<absolute-herdr-binary>' --endpoint '<local-api-socket>' --pane 'w1:p1'

# Explicitly persist a diagnostic pin in an existing private directory.
node tools/manager-bookmark.mjs pin --herdr '<absolute-herdr-binary>' --endpoint '<local-api-socket>' --pane 'w1:p1' --state '<absolute-private-directory>/manager.json'

node tools/manager-bookmark.mjs inspect --herdr '<absolute-herdr-binary>' --endpoint '<local-api-socket>' --state '<absolute-private-directory>/manager.json'
node tools/manager-bookmark.mjs return --herdr '<absolute-herdr-binary>' --endpoint '<local-api-socket>' --state '<absolute-private-directory>/manager.json'
```

`pin` and `inspect` exit 0 when diagnostics succeed; their output still says `return_status: "BLOCKED"`, `identity_verified: false` and `focus_sent: false`. `return` exits 2 after successful diagnostics, with the blocker explained. Invalid arguments, stale or malformed state, changed IDs, incompatible/unavailable servers and transport errors exit 1. No exit code indicates successful navigation.

Every invocation selects the endpoint independently. The helper removes inherited `HERDR_*` routing/context variables in the child environment, then sets only `HERDR_SOCKET_PATH`. It requires the reported socket to match exactly. That socket string is a routing assertion, **not authoritative server identity**. Equivalent aliases are deliberately not accepted as a saved endpoint match.

Selecting a CLI endpoint does not identify the displayed UI client, its active endpoint, its local navigation state or its focus. `status client` describes the CLI binary, not an attached displayed client. Cross-client reliable navigation is not claimed.

## What diagnostics establish

The helper runs only `--version`, `status server --json` and `pane get <explicit-ID>`. It requires a running compatible 0.9.5 server, a matching reported socket, and a valid pane response. It saves only endpoint, pane ID, terminal ID, workspace ID and tab ID, plus schema/diagnostic markers and null server/boot identities. It does not capture terminal text, cwd, titles, agent names or credentials.

Inspection compares all four IDs against a fresh response. A closed pane, replaced terminal, moved pane or changed context is rejected. A different supplied endpoint is rejected before any native query. Unknown state versions, extra state fields and fabricated boot/server identities are rejected. Missing or malformed responses never enable an action.

Matching IDs are merely observed matches. A restart, endpoint replacement or stale record can reuse every ID, socket path and revision. There is no age-based exemption, guessed boot ID, PID-based identity or fallback to a current pane. Even healthy-looking matching records remain blocked. Repinning does not remove the blocker.

## Local contract evidence

Read-only inspection used the local 0.9.5 source under `.local/herdr-095-tree` and matching pane schema under `.local/herdr-095-contracts`, plus `tools/spawn-agent.mjs` and `docs/native-focus.md`. Relevant upstream source at the inspected version:

- [`src/api/schema/session.rs`](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/schema/session.rs): public `SessionSnapshot` has version, protocol and session inventories, but no server or boot identity. The bundled `docs/next/api/herdr-api.schema.json` likewise exposes neither `boot_id` nor `server_id`.
- [`src/cli/status.rs`](https://github.com/herdrdev/herdr/blob/v0.9.5/src/cli/status.rs): `ServerStatusJson` reports compatibility, socket and session; it supplies no server/boot identity. `socket` is derived from the selected transport path.
- [`src/api/schema/panes.rs`](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/schema/panes.rs): `PaneInfo` supplies pane/terminal/workspace/tab IDs and revision, but no server incarnation.
- [`src/api/schema/common.rs`](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/schema/common.rs) and [`src/app/api/panes.rs`](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/api/panes.rs): raw `pane.focus` accepts only a pane ID. `handle_pane_focus` changes shared focus, marks the active tab seen and changes mode. It cannot atomically check expected boot, terminal or context identity, nor select a displayed client.
- [`src/cli/pane.rs`](https://github.com/herdrdev/herdr/blob/v0.9.5/src/cli/pane.rs): CLI `pane focus` is directional, not the direct raw `pane.focus` contract. It is not a return-to-bookmark substitute.
- [`src/protocol/endpoint.rs`](https://github.com/herdrdev/herdr/blob/v0.9.5/src/protocol/endpoint.rs): boot-bearing client endpoint protocol data exists separately. The helper does not open a client protocol connection or treat invented CLI fields as that evidence.

A new public contract must establish authoritative endpoint/server incarnation and target identity, plus supported focus behavior with atomic identity preconditions and clear client semantics, before a later implementation can enable return. Another read just before an unconditional focus call would still leave a replacement race. No upstream files or contracts are changed here.

## Private state and rollback

There is no default state location or repository/config write. Choose a trusted, existing private directory outside the repository. Keep its ancestor directories under trusted control. State paths must be absolute local paths; symlink/junction components, UNC paths and alternate data streams are rejected. Creation uses create-exclusive semantics; existing files, links and directories are never overwritten. To repin, choose a new filename and explicitly discard an old file yourself after inspection.

On POSIX, the parent and file must belong to the current user with no group/other permissions (normally directory 0700 and file 0600). On Windows, the helper uses the system Windows PowerShell to **read** ACLs, explicitly importing the built-in Security manifest from that child's `$PSHOME` rather than inherited module search paths. Current-user ownership is required, null DACLs are rejected, and allow rules may name only that user, SYSTEM or Administrators. The private parent supplies inherited file protection at creation; file ACLs are checked before writing. ACL errors/timeouts fail closed. The helper never changes permissions or creates the directory. Systems without a verifiable private directory can still use read-only `pin` diagnostics.

Reads reject multiple hardlinks, nonregular/oversized files, invalid UTF-8/JSON and file identity changes during open. Writes flush and close their file descriptor. An unsuccessful write may retain an empty or partial exclusive file; it is never deleted or overwritten automatically. Choose a fresh filename after investigating. Privacy checks do not protect against malicious code already running as the same user or administrator.

Rollback means stop invoking the helper and remove only your explicitly created private state file. There are no live settings to restore.

## Focused verification and integration

```powershell
node --test tests/manager-bookmark.test.mjs
```

Herdr calls are mocked with synthetic data and an allowlist of the three read-only commands. Tests cover explicit selection, no default writes, zero focus for every command, endpoint collisions, restarts/reused IDs, replacement, context changes, stale/forged state, malformed responses, transport failure and version mismatch. Temporary-file tests cover native private state roundtrips, exclusive creation, links/junctions, malformed files, read replacement and write failure. Windows tests create private ACLs only on disposable test directories; they do not change user configuration or live agents. Windows unsafe-ACL rejection is mocked: this test environment denied construction of a permissive ACL fixture with `SeSecurityPrivilege` unavailable. Private ACL acceptance and file operations run natively.

The source implementation owns only this helper, its focused tests and this guide. The coordinating manager separately added CI coverage and the [authorized reference installation](cockpit-wave-rollout.md). Focused suites passed on Windows and Linux; an installed explicit read-only pin check also passed without writing state or focusing anything. Live navigation remains unavailable, not validated. Return must remain visibly blocked; a passing diagnostic test is not evidence of a functioning navigation feature.

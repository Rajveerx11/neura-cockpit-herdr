# Issue #2: attention inventory

This is a read-only, on-demand slice of [issue #2](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/2), not the full jump queue.

## Use

Run the existing helper with an explicitly supplied API socket:

```powershell
powershell.exe -NoProfile -File tools/cockpit-status.ps1 -Attention -EndpointSocket '<absolute-api-socket-path>'
```

Use a socket whose identity you already know. `-EndpointSocket` accepts an absolute Windows path or UNC/named-pipe path, not a drive-relative or root-relative path. The helper does not discover hosts or read machine profiles. It temporarily passes that exact socket through `HERDR_SOCKET_PATH` to the existing `rename-context.ps1` CLI adapter, then restores the environment. There is no inherited-socket, session-default, or local fallback for attention reads.

F4 keeps its existing context view and keys. Attention requires the explicit `-Attention` command above; there is no default attention shortcut. Without `-EndpointSocket` it reports unavailable and makes no query. `-Attention -TestRender` renders once without reading keys. Dot-sourcing exposes functions without running commands or opening UI.

## Supported output

- **Blocked:** native `agent_status: blocked` in the explicit endpoint's inventory.
- **Unseen completion:** unavailable. A CLI `done` value does not establish what the displayed client has seen.
- **Unknown / completion unverified:** native unknown, unsupported/missing status, ambiguous pane IDs, and CLI done. The raw native status remains visible.

Idle and working agents are omitted. Rows sort by category, workspace, tab, pane, native status, then reason. Reversing inventory order does not change output. IDs from separate endpoint queries are never merged. Missing or duplicate IDs within an endpoint become unknown. Closed panes disappear on the next invocation. The screen is a snapshot, not a live guarantee. Empty inventory is distinct from disconnected/invalid inventory.

## Contract limits

The current contract was checked against official [Herdr v0.9.5](https://github.com/herdrdev/herdr/tree/v0.9.5), commit `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`. Earlier investigation used older local trees, but they are not the basis for the current version claim. A read-only query against the explicitly inherited local API socket succeeded after deployment. That does not establish the host displayed by another client or its seen state.

Source inspected:

- `src/app/creation.rs::pane_info` and `src/app/api_helpers.rs::pane_agent_status`: API status maps idle plus server-side `seen == false` to done.
- `src/app/agents.rs::agent_info` and `src/api/schema/agents.rs::AgentInfo`: CLI inventory exposes that status, not the displayed client's acknowledgment map or endpoint boot identity.
- `src/client/shell/endpoint_agent_state.rs::EndpointAgentPresentation`: client seen state is tracked per boot/pane sequence and acknowledged from presented surfaces. Its initial snapshot establishes a baseline independently of server seen state.
- `src/cli/target.rs`, `src/api/client.rs`, and socket API docs: CLI defaults can target a local session. `HERDR_SOCKET_PATH` supplies an explicit socket override. This helper never uses `--machine` or profile lookup.
- `src/app/custom_commands.rs::custom_command_env`: popup active IDs and socket variables alone do not prove the displayed client's endpoint identity.
- `src/cli/agent.rs::agent_focus` and `src/app/agents.rs::focus_agent_target`: native focus exists, but the inspected CLI contract does not carry a displayed-client endpoint/boot precondition or client acknowledgment state.

**Jump is unavailable.** The helper never issues focus, pane input, prompt, approval, or rename commands. Enter and number keys do nothing. Without a verified client endpoint and fresh identity contract, adding a selection handler would risk targeting the wrong host or pane. No completion history or synthetic seen state is stored.

## Validation and rollback

```powershell
powershell.exe -NoProfile -File tests/cockpit-attention.tests.ps1
powershell.exe -NoProfile -File tests/rename-context.tests.ps1
```

The new test uses injected CLI JSON only. It covers import safety, default F4 behavior, explicit endpoint routing/restoration, duplicate IDs across/within endpoints, closed panes, empty/disconnected inventories, invalid responses, ordering, status classification, control-character filtering, and inert selection keys.

The helper is deployed, and its explicit-endpoint inventory was queried successfully without focus or pane mutation. No human popup comparison or remote query is claimed. See [the rollout record](herdr-095-rollout.md) for backups and rollback. Restore only the affected helper if undoing this feature alone. Leave unrelated installer and usage work untouched.

# Manager + reviewer preset (#6)

This opt-in helper keeps the existing injected agent pane as manager and adds one reviewer to its right. That's the entire preset. It does not create a workspace or tab, start or rename the manager, rearrange existing panes, or assign work.

Run from the repository tools directory inside Windows Herdr 0.9.5:

```powershell
node .\workspace-preset.mjs --kind codex --dry-run
node .\workspace-preset.mjs --kind codex
```

`--kind` is required and uses `spawn-agent.mjs`'s supported native kinds. `fx` is not a supported reviewer launch kind. The existing manager may be fx: it is neither launched nor converted. The reviewer name defaults to `reviewer`. `--name reviewer-2` selects another validated unique live name. Existing names cause refusal, not reuse.

`--cwd` asserts the manager's authoritative API cwd. It cannot select another directory. For example, pass `--cwd 'D:\Work\project'` on Windows or `--cwd '/mnt/d/Work/project'` from WSL. WSL requires the existing `~/.local/bin/herdr` bridge. Both paths are assertions only: the split receives the Windows API cwd, never shell `PWD`. Prefer `foreground_cwd` when present, otherwise API `cwd`.

## Topology and safety

- Exactly one existing agent pane in an unzoomed tab is required. Other panes cause refusal before mutation. Other tabs/workspaces are not changed.
- The manager needs at least 121 columns and 12 rows. The helper checks that both resulting panes have at least 60 columns and 12 rows and that the reviewer is immediately to the right. There is no down-split fallback.
- The split preserves workspace/tab/cwd and uses `--no-focus`. Returned IDs are verified. No predicted pane IDs or focus commands are used.
- Dry-run returns `topology.requested_panes: 2`, the existing manager ID and the proposed reviewer kind/name/side. Its reviewer pane ID is null because nothing was created. It reads version/status, pane/layout and agent-list data, plus `wslpath` for a WSL cwd assertion. It submits no prompts and writes no native state.
- Normal mode calls `spawnAgent` once. It checks context, geometry, duplicate names and readiness. Success requires the expected reviewer identity, `idle` or `done`, and explicit boolean `interactive_ready: true`. Missing, false or malformed readiness is unavailable, not success. The existing helper deliberately also rejects `unknown`, even though native Codex startup can return it with interactive readiness.
- Before agent startup, a failed split validation can close only the returned, positively verified, unfocused shell with matching terminal/context and no foreground job. If ownership cannot be proved, it retains the pane. Once startup is dispatched, all failures retain it. Lost split responses retain any unverified outcome. Inspect before retrying. The helper never retries. Native `agent start` still performs its bounded readiness wait and pre-launch busy handling, as defined by Herdr 0.9.5.

No prompt option is exposed, including `--prompt-file`. The helper does not answer approvals, read terminal output, or claim task activity/completion. Layout and process checks are snapshots, not an atomic transaction or a layout lock; another client can still change state afterward.

## Native contract evidence

Verified with installed `herdr --version` (`herdr 0.9.5`), read-only `herdr pane split --help` and `herdr agent start --help`, plus official source at tag [v0.9.5](https://github.com/herdrdev/herdr/tree/v0.9.5):

- `pane split` supports `--pane`, `--direction right`, `--cwd` and `--no-focus`. `agent start` targets an existing shell pane and waits for readiness, defaulting to 30000 ms. Its help lists supported kinds, excluding fx.
- `src/api/schema/panes.rs:449-465,494-519,593-616` defines pane IDs/context/cwd/agent, shell process information, and layout geometry/focus/zoom fields.
- `src/api/schema/agents.rs:211-227` defines launch/readiness/context/cwd fields. False `interactive_ready` is omitted by serialization. The shared helper now requires explicit true instead of accepting a missing field.
- `src/cli/agent.rs:598-627` returns successful startup only for the expected identity with boolean interactive readiness. `src/app/agents.rs:371-405` populates that readiness in the returned agent information.

## Verification and boundaries

```powershell
node --test tests/workspace-preset.test.mjs tests/spawn-agent.test.mjs
```

The preset tests execute the actual Node entrypoint with a test-only preload intercepting every native call. Fixtures cover dry-run reads, Windows/WSL cwd assertions and unsupported kinds. They test refusal of zoomed, narrow or occupied layouts and duplicate names. They also test readiness, partial launch failures, and shell cleanup versus retention. No real agents are launched.

The helper is installed on the authorized Windows reference machine, and its installed `--help` entrypoint passed. No real reviewer launch or native dry-run was performed in this rollout. See the [rollout record](helper-rollout.md). The installer copies the helper beside `spawn-agent.mjs`, and CI includes its tests. No default configuration or shortcut was added. No live pane was created, modified or inspected. Human confirmation of layout/focus/readiness on Windows and WSL remains pending authorized runtime testing. Unsupported platform/server contracts fail closed.

Rollback: stop invoking the new entrypoint and remove `tools/workspace-preset.mjs` if copied manually. Keep `spawn-agent.mjs` beside it when copying. No configuration or persistent preset registration exists. Inspect any retained pane yourself. Rollback never closes agents automatically. Reverting this source diff also removes the shared explicit-readiness fix.

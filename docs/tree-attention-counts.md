# Optional collapsed tree counts — Herdr 0.9.5

`patches/agent-tree-attention-v0.9.5.patch` is an incremental client presentation patch. Apply it AFTER `patches/agent-tree-v0.9.5.patch`, on that patch's Herdr v0.9.5 source commit `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`. Source review originally marked this addition **not installed or activated**; the later authorized reference installation is now active and recorded in the [deployment guide](cockpit-wave-rollout.md). The configuration installer does not apply this binary patch.

Collapsed machine, workspace and tab headers show their native group name first, then nonzero descendant counts: `Workspace | 2 blocked 1 working 1 native done 1 idle 1 unknown`. Expanded headers retain their original count-free labels. Counts cover the entire collapsed subtree, including nested collapsed groups and offscreen descendants. They are recalculated from the current native snapshot, not visible rows.

Only validated native membership contributes state counts. Missing optional pane metadata remains allowed; conflicting membership remains excluded. Missing workspace/tab metadata keeps the existing noninteractive unavailable row. A collapsed machine includes an explicit unavailable count for those agents, without inventing their parent groups or statuses. Cached disconnected snapshots retain stale markers, dim styling and action fencing. Unknown remains unknown. Counts use the same projected `agent_status` as native tree leaves. `native done` reports the client's existing `Done` state, subject to its existing completion/seen rules; it does not assert task acceptance or add reviewed/unread tracking. Custom leaf state labels remain unchanged; aggregate counts use native states.

Names precede counts so narrow panes retain group identity. Rows remain one line and clip at the available width; long names or mixed states may hide some or all counts. Expand the group or widen the pane to inspect descendants. There is no inferred manager hierarchy, new API/protocol/runtime state, terminal inspection, filesystem I/O in rendering, or action attached to a count. Collapse keys and native navigation remain unchanged.

The projection adds two borrowed-ID count maps and one machine accumulator per endpoint. Each validated agent updates three fixed-size counters once, before collapse filtering. Each header reads its counter directly: no descendant scan per header. Additional aggregation work is linear in agent count per projection; temporary storage is proportional to occupied workspaces/tabs. Existing membership lookup and row flattening remain intact.

## Apply and undo

In a separate source tree with the published tree patch already applied, set `PATCH_DIR` to this repository's patches directory:

```sh
git apply --check "$PATCH_DIR/agent-tree-attention-v0.9.5.patch"
git apply "$PATCH_DIR/agent-tree-attention-v0.9.5.patch"
```

Do not apply twice or force mismatches. Roll back this addition before reversing the underlying tree patch:

```sh
git apply --reverse --check "$PATCH_DIR/agent-tree-attention-v0.9.5.patch"
git apply --reverse "$PATCH_DIR/agent-tree-attention-v0.9.5.patch"
```

## Focused verification

Use upstream `just test-one agent_tree` when available. The local environment lacks `just`; the equivalent cached Windows test commands are:

```sh
cargo +1.96.1 fmt --all -- --check
cargo +1.96.1 test --locked --offline --bin herdr client::shell::tests::agent_tree::
cargo +1.96.1 test --locked --offline --bin herdr client::shell::
cargo +1.96.1 clippy --locked --offline --bin herdr --tests -- -D warnings
cargo +1.96.1 test --locked --offline --bin herdr agent_tree_render_scale_profile -- --ignored --nocapture --test-threads=1
```

Set `ZIG` to the existing Zig 0.16.0 executable when absent from PATH. These commands use the existing static-CRT configuration and dependency cache. No release build is required for these synthetic tests.

From the configuration repository:

```sh
node --test tests/tree-attention.test.mjs tests/agent-tree.test.mjs
```

Packaging tests reconstruct the two tree-enabled files from the published tree patch, check the incremental patch's exact scope, apply/reverse it, verify exact restoration, and reject double application. Each fixture uses an isolated temporary Git repository and cleans up afterward; it does not inspect or alter the parent repository. Native cases cover nested collapse, every native state, hidden snapshot updates, endpoint/boot collisions, missing/conflicting membership, stale counts, narrow widths, identity at 38 columns, count-free expansion, and unchanged actions/navigation.

Verified, all commands exited 0: 21 native tree tests passed, with the manual profile ignored in that run; the profile passed separately (1 test). Broader client-shell regressions passed 395 tests, with 3 ignored. All 6 packaging tests passed (3 attention tests and 3 existing tree tests). Full Cargo formatting checks and focused Clippy with warnings denied passed. Native tests ran against the existing local patch stack, not a separately compiled stock-only tree; isolated packaging checks establish application after the published tree patch.

The existing fixed 106×30 profile measures expanded-tree debug client composition at 1 and 15 panes with 20 warmup and 1,000 measured frames. It measured **590.6 µs/frame at 1 pane** and **733.0 µs/frame at 15 panes**: +142.4 µs, approximately +24.1% as pane count increased. This is a within-candidate scaling sample, not a before/after regression measurement. It does not measure collapsed-summary formatting, release performance, PTY throughput or live UI behavior. The later release build, packaging validation and authorized activation are recorded separately in the [deployment guide](cockpit-wave-rollout.md); no release performance claim is made.

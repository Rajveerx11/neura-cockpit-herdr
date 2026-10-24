# Optional native agent tree — Herdr 0.9.5

`patches/agent-tree-v0.9.5.patch` adds a client-only tree to the expanded Agents section in grouped (`spaces`) mode. It targets stock [Herdr v0.9.5](https://github.com/herdrdev/herdr/tree/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01), commit `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`. Selecting a separately built patched client is the opt-in; the configuration installer does not apply this patch.

The authorized reference installation is complete; see [its installation record](#authorized-reference-installation) for deployment boundaries and pending human checks. The build-stage verification notes below describe the earlier pre-installation state. This repository publishes source and checks, not the local release binary.

## Behavior and boundaries

- Native machine, workspace and tab membership supplies the hierarchy. Headers expand/collapse; they cannot focus, move, close or acknowledge an agent. No manager/child relationship is inferred from names.
- Each leaf uses one line: native status and one identity label. Explicit nonblank worker names take precedence over harness/display/title fallbacks. Native custom state labels and per-client completion/seen state remain intact. Labels strip control characters.
- Collapse state lives only in the client, keyed by endpoint, server boot, node kind and stable IDs. Renaming a group does not reset it; another endpoint or server boot cannot inherit it. Explicit Goto/index navigation expands actual ancestors after destination activation. Global navigation eligibility and ordering remain unchanged.
- Rendering, wheel/thumb scrolling and reveal use the same flattened visible rows. Row gaps remain configurable. Tree leaves use one line; configurable multi-line rows remain available in priority/custom-view modes. Compact sidebar and mobile presentation retain their existing paths.
- Cached disconnected endpoints stay dim/stale, preserve their frozen surface, and retain native action fencing. An endpoint without a snapshot shows unavailable metadata. Missing auxiliary pane metadata does not remove an otherwise valid native agent. Present conflicting membership is rejected. Missing workspace/tab metadata produces a noninteractive unavailable count instead of inventing parent groups or claiming there are no agents.

There are no server, runtime, API, wire-codec, dependency or configuration-schema changes. Rendering performs no terminal inspection or I/O. The upper machine/workspace controls are unchanged.

## Apply to stock source

Use a separate source checkout at the exact commit above. From its root, with `PATCH_DIR` pointing to this repository's `patches` directory:

```sh
git apply --check "$PATCH_DIR/agent-tree-v0.9.5.patch"
git apply "$PATCH_DIR/agent-tree-v0.9.5.patch"
```

This is a standalone patch. The older local image-shortcut and harness-attention patches are **not prerequisites** and are not assumed to be published. If you already have those matching-version patches, both composition orders were checked: tree before them, and tree after them. Each order reproduces the same tree-touched files as the local combined candidate. Do not apply a patch twice or use `--reject` to force a mismatch.

Stock verification reconstructed touched files in isolated fixtures by reversing the older optional patches, then checked their exact LF bytes against the recorded upstream Git blob hashes. All 32 existing files in the union of the verification fixtures matched v0.9.5. Tree apply/reverse restored exact original fixture bytes on both stock and local-stack baselines. The original source archive and older patch files were left unchanged.

## Build and test

Follow upstream build prerequisites and Windows packaging instructions. The local proof used Rust/Cargo 1.96.1 and Zig 0.16.0, existing dependency caches, and the source's static-CRT Cargo configuration. `just`/nextest were unavailable locally, so equivalent focused Cargo commands were used:

```sh
cargo +1.96.1 fmt --all -- --check
cargo +1.96.1 test --locked --offline --bin herdr client::shell::
cargo +1.96.1 test --locked --offline --bin herdr protocol::
cargo +1.96.1 clippy --locked --offline --bin herdr --tests -- -D warnings
cargo +1.96.1 build --locked --offline --release --bin herdr
python -m unittest scripts.test_ui_hot_path_architecture
cargo +1.96.1 test --locked --offline --bin herdr agent_tree_render_scale_profile -- --ignored --nocapture
```

Set `ZIG` to the installed Zig executable if it is not on PATH. `--offline` requires dependencies already cached. Keep build/cache outputs in the isolated source tree. From the configuration repository, `node --test tests/agent-tree.test.mjs` checks patch packaging and scope; it does not replace the native Rust tests.

Use **release profile** for the custom client stage, as required by [setup instructions](setup.md). Debug builds use separate `herdr-dev` roots and must not be used for this deployment. The native tests and scaling measurements below used debug/test builds; they are separate from the release executable prepared for independent review.

Native tests cover header-only actions, name-only/Unicode/unknown states, custom labels, sanitation, endpoint/boot collisions, missing/moved membership, offline/no-snapshot rendering, local snapshot fallback, native navigation, remote deferred reveal, scrolling, priority/custom/compact/mobile behavior, and mouse capture disabled. The cached-disconnect regression specifically removes optional pane metadata while retaining native agents, frozen terminal content, stale styling and disabled actions.

Existing fixture changes are deliberate: multi-line configured-row assertions select priority mode, and the overflow fixture uses a shorter viewport because tree leaves occupy one line. The existing disconnected-surface test now runs both grouped and priority modes; its real sidebar width is widened to prevent the full-label assertion testing clipping instead. Frozen content, reconnecting status, no pane hits/cursor, and dim status assertions remain. No pane metadata was added to conceal the regression.

## Build-stage verification (historical)

The local executable includes the existing optional patch stack; standalone stock application is separately verified by blob hashes and apply/reverse/composition checks. Local runtime test results therefore describe that combined candidate, not a separately compiled stock-only executable.

Verified locally: 390 client-shell tests passed (3 ignored); 155 protocol tests passed; 6 architecture tests and 3 bundle tests passed. Formatting and Clippy with warnings denied passed. The ignored tree profile was run explicitly and passed; the other two ignored shell tests were not run. A full source comparison against the saved baseline found only 15 modified client files and 2 new client files, with all runtime/protocol files unchanged.

The scaling test composes the client tree at fixed 106×30 geometry, with 20 warmup frames and 1,000 measured frames for 1 and 15 populated panes. It measures debug client composition, not PTY throughput, hidden output performance, release performance, or an interactive user session. It is supporting evidence, not a timing threshold.

The final run measured **620.7 µs/frame at 1 pane** and **740.8 µs/frame at 15 panes**: +120.1 µs, approximately +19.3%. An earlier run measured 652.9/800.2 µs, illustrating normal local timing variation; neither run is a stock-versus-patched comparison.

A Windows executable must stay beside the pinned app-local ConPTY assets, marker and notices. Validate the complete stage with upstream `scripts/package_windows_conpty.py` helpers and `packaging/windows/conpty.json`; do not copy a lone executable over an installed release. The reviewed source/build baseline and final stage are retained for independent manager testing. At completion of build review, no client had been launched, installed, or activated; no server/session had been changed.

The release build succeeded with `cargo +1.96.1 build --locked --offline --release --bin herdr` (exit 0, 7m 47s), using the retained target/cache and unchanged source. The local review stage at `.local/staged/herdr-095-tree` now contains the **release** executable and all six pinned ConPTY/notice files. Upstream `validate_stage` passed again for exact seven-file layout, asset/notices hashes, marker and static MSVC runtime. The staged executable matches `target/release/herdr.exe`; its SHA-256 is `0ab5c617f5199aeab3741985862f3d219ec2e43e8222708e0fb767b113a4688a`.

The debug executable and its prior validation receipt are retained only as test evidence. Source and patch input hashes remained unchanged during the release build. Release compilation and static packaging checks do not constitute release runtime or live UI validation. The source, build outputs, logs and final stage remain available for independent manager review; commit/push and activation still require their separate gates. This ignored local stage is not a published release binary.

## Authorized reference installation

After explicit owner approval, the release bundle was installed side-by-side with stock Herdr, with a separate **NEURA Cockpit** Start-menu launcher. The original server and client were not replaced or stopped. The new client started in a minimized window and completed its generation-1 handshake with the existing main server. All seven existing agent identities and working directories were preserved. Installed asset hashes, static-runtime packaging, native config validation and the image-aware client configuration were checked again.

A backed-up, targeted config merge retains grouped tree mode, private bindings and sound off; it adds F6 zoom/F7 previous-pane and native system notification delivery. The worker launcher and read-only integration checker were copied beside the existing guarded spawn helper. Hooks, credentials, plugin registrations, global PATH and existing shortcuts were not replaced. The launcher remains attach-only and requires an already-running compatible main server. Private paths, backup maps and deployment receipts are recorded only in `.local/agent-tree-installed-receipt.json`.

This verifies installation and connection, not physical key forwarding, tree interactions or genuine Windows notification banners/click routing. Those remain human checks. Window responding/minimized state was verified; uninterrupted OS foreground focus was not established by the foreground-handle probe.

## Rollback

In an isolated source tree, first check and then reverse only this patch:

```sh
git apply --check --reverse "$PATCH_DIR/agent-tree-v0.9.5.patch"
git apply --reverse "$PATCH_DIR/agent-tree-v0.9.5.patch"
```

Reversal leaves the older optional patches intact. If a patched client is later activated through a separate review, reverting to the previously reviewed client is a separate client-selection action. Do not restart servers or delete user state to roll back this presentation change.

# Cockpit health, attention and checkpoint rollout

The owner authorized installation of this helper/tree batch on the Windows reference machine. This repository publishes portable source and optional patches, not a binary release. Existing private configuration, hooks, credentials, PATH, plugin registrations and the stock Herdr server were preserved.

## Installed features

| Feature | Reference installation | Boundary |
| --- | --- | --- |
| [Cockpit doctor](cockpit-doctor.md) | Helper installed; Start → NEURA Cockpit Doctor | Explicit main-endpoint/CLI evidence, not displayed-client identity; read-only, no repair |
| [Collapsed tree attention counts](tree-attention-counts.md) | Release client installed and activated through the existing NEURA Cockpit launcher | Native snapshot counts, not task acceptance or a durable unread inbox; narrow panes may clip counts |
| [Private handoff checkpoint](handoff-checkpoint.md) | Manual helper installed; protected private output directory prepared | Explicit project/pane selection and a new file required; no transcripts, diffs or automatic resume |
| [Manager bookmark](manager-bookmark.md) | Diagnostic helper installed | Return remains BLOCKED; no focus/input or return shortcut enabled |

The three new helpers live beside the existing tools under `%APPDATA%\herdr\tools`. The doctor reuses the existing identity/integration adapters, whose installed bytes already matched reviewed source. Start → **NEURA Cockpit Tools** opens the installed `Quickstart.md` with manual examples. No new default keybinding or F4 action was added; the portable configuration installer remains unchanged.

Private checkpoint storage is `%LOCALAPPDATA%\NeuraCockpit\checkpoints`, outside the repository, with current-user ownership, protected ACLs and private file inheritance. The helper still refuses existing filenames and unsafe/nonprivate output. User-supplied next steps are command arguments: do not include secrets. Checkpoints and deployment receipts are not published.

## Release client and activation

The release build completed successfully:

```sh
cargo +1.96.1 build --locked --offline --release --bin herdr
```

Exit **0**, approximately **7m 2s**, using cached Rust/Cargo 1.96.1, Zig 0.16.0 and the existing static-CRT configuration. All 1,587 recorded source/build inputs remained unchanged across the build; the two count-patch source hashes matched the native-tested candidate.

The complete seven-file bundle passed upstream `validate_stage`: exact layout, pinned ConPTY binaries, marker, notices, x86-64 executable identity and static MSVC runtime. It was installed side-by-side with the previous bundle, not over an executable in use:

```text
%LOCALAPPDATA%\Programs\NeuraCockpit\releases\0.9.5-tree-attention-270c8aa8619b
```

Executable SHA256: `270c8aa8619bd011ef72134d00990dddabc2ba709a03a9b1d7a6d7360a008741`.

The launcher pointer was changed only after packaged-client configuration and attach-only preflight passed. The new client completed a generation-1 handshake with the unchanged main Herdr 0.9.5 server. All nine agent pane/terminal identities and working directories were preserved during that transition. The new window was visible, restored and observed in the foreground; the superseded client/window closed through its normal window-close path. No server stop, update, handoff or agent restart was performed.

The executable retains the earlier optional local image/attention patch stack. Tests/build results describe that combined candidate. The new count patch is independently packaged as an incremental addition **after** the published base tree patch; no stock-only release compilation or release-performance comparison is claimed.

## Verification

| Check | Result |
| --- | --- |
| Native tree tests | 21 passed, profile ignored in this run |
| Broader client-shell tests | 395 passed, 3 ignored |
| Formatting and Clippy with warnings denied | Passed, exit 0 |
| Explicit debug 1/15-pane profile | Passed; supporting debug evidence only, not release performance |
| Combined Node patch/helper suites | Windows: 54 passed, 1 skipped; Linux: 52 passed, 3 skipped; exit 0, including Windows module-path regressions |
| Doctor plus identity/integration PowerShell suites | 43 passed; exit 0 |
| Private installer fixtures | Dry-run, destination-drift refusal, exclusive writes, backup, private ACL and config preservation passed |
| Installed doctor | Main endpoint/CLI evidence and five helper hashes verified; diagnostic exit 1 correctly flags existing outdated Claude/Codex integrations |
| Installed bookmark | Explicit read-only pin passed; no state write or focus; return BLOCKED |
| Installed checkpoint | New private file created; explicit main-endpoint pane/project identity verified |
| Installed bundle/helpers and live configuration | Reviewed hashes matched; private base configuration unchanged |

Exact source-stage commands and limits are in the feature guides. Initial hosted Windows checks exposed inherited PowerShell 7 module paths breaking child Windows PowerShell ACL-command loading. A narrow follow-up pins the runtime and fixture ACL scripts to the child's built-in Security manifest under `$PSHOME`; regressions reproduce the incompatible-module failure without weakening ACL checks or changing global module paths. The installed helper copies, integrity manifest and pinned Doctor wrapper were refreshed with backups; no client rebuild or restart was needed. CI includes the focused Node suites on both platforms and the doctor suite on Windows; consult the published commit's hosted checks for its result. Private build/install/cleanup receipts and hashes are retained locally, not in Git.

The doctor deliberately did not replace outdated integrations. Version-marker freshness, registration correctness, running code and genuine lifecycle delivery remain different facts. Real visual tree interaction, physical key forwarding and Windows notification banners/click routing still require human observation; process/handshake checks do not establish them.

## Backup, cleanup and rollback

The targeted installation retains a hash-verified backup of the previous launcher and the complete previous client bundle. No private bindings were rewritten. New helper files, shortcuts, manifest and private-directory creation are recorded individually in the private install receipt. The installer refuses changed/unreviewed destinations rather than blindly replacing them.

Worker cleanup removed only proven-owned disposable fixtures. Final source, build cache, validated bundles, before/after source evidence, rollback backups and verification receipts were retained. Private checkpoint files are user data, not disposable test fixtures.

Rollback is a client-selection and targeted-file operation, **not a server restart**:

1. Use the private receipt to verify current installed hashes before changing anything. Stop and reconcile later edits rather than overwriting them.
2. Restore only the backed-up launcher pointer and select the retained previous client bundle. Keep its six adjacent ConPTY/notice assets; never substitute a lone executable.
3. Remove a new helper/shortcut/manifest only if the receipt says it was created by this deployment and its current bytes still match. Existing identity/integration adapters were not replaced. Do not delete unrelated tools or registrations.
4. Leave private checkpoint files, credentials, hooks, configuration, live agents and server state untouched. Reactivating the chosen client is separate from changing files.

The manager-bookmark return action cannot be enabled by installation or rollback; it requires a separately reviewed identity-safe native contract.

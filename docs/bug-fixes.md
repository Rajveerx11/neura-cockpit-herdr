# Bug-first fixes

No enhancement is implemented by this batch. Existing controls and filesystem staging are reused; no new daemon, runtime dependency, protocol, or automatic binary installer is added.

| Bug | Correction | Activation boundary |
| --- | --- | --- |
| Codex shown with a Claude-like star | Existing branding plugin uses distinct `>_`; stale tokens are replaced without lifecycle writes | Live reference token verified; portable plugin updated |
| fx stays blocked after attention resolves | fx emits working/idle after the final question/approval closes; genuine remaining blockers and finished-turn idle are preserved | Optional matching-source patch; running fx sessions untouched |
| Screenshot Ctrl+V into local WSL pane does nothing | Windows client stages PNG/DIB-derived image through existing service, translates with `wslpath`, and inserts one quoted image path using semantic paste | Optional client patch; physical screenshot/application confirmation still required |

## Matching-source patches

These are independent local modifications under Apache-2.0, not vendor releases. Back up your source and binaries. Use isolated source; never apply over unreviewed user changes.

### Herdr 0.9.3: text patch, then image patch

Use the [Herdr 0.9.3 source](https://github.com/herdrdev/herdr/tree/v0.9.3). The image patch is incremental: its baseline already contains this repository's Windows text clipboard patch.

From that source directory, replacing `BUNDLE` with the absolute bundle path:

```bash
git apply --check BUNDLE/patches/windows-clipboard-paste-v0.9.3.patch
git apply BUNDLE/patches/windows-clipboard-paste-v0.9.3.patch
git apply --check BUNDLE/patches/windows-wsl-image-paste-v0.9.3.patch
git apply BUNDLE/patches/windows-wsl-image-paste-v0.9.3.patch
```

On Windows, use Rust and Zig 0.16.0 as required by Herdr's build documentation. Set `ZIG` to your Windows Zig executable if it is not on PATH:

```powershell
cargo fmt --all -- --check
cargo test --locked --bin herdr client::shell::tests::
cargo test --locked --bin herdr clipboard_image
cargo test --locked --bin herdr wsl_clipboard -- --include-ignored
cargo clippy --locked --bin herdr --tests -- -D warnings
cargo build --locked --release --bin herdr
```

The ignored WSL round-trip test generates its own PNG, checks identical bytes from WSL, then removes its fixture. It never accesses or replaces the clipboard. Other regressions cover image eligibility, missing panes, popup ownership, unrelated events in the same batch, spaces/quotes, and remote-policy preservation. The patch never presses Enter.

Scope: local Windows client, reachable local surface, valid WSL pane, default WSL distribution. Native Windows and remote routing retain existing behavior. Multiple distributions, timeout fault injection, actual harness image attachment, Alt+V, and remote/Pi application paths are not established by these tests. Successful staged image files use existing 24-hour stale cleanup; failed translation removes its file. Translation has a three-second timeout.

### fx v0.0.13: resolved attention

Use [fx v0.0.13](https://github.com/vercel-labs/fx/tree/v0.0.13), commit `4d966e272cfc4296cdf703f409480088cf2e72ba`:

```bash
git apply --check BUNDLE/patches/fx-herdr-resume-v0.0.13.patch
git apply BUNDLE/patches/fx-herdr-resume-v0.0.13.patch
bash BUNDLE/tools/test-fx-herdr-state.sh "$PWD" /path/to/linux-zig-0.16.0
/path/to/linux-zig-0.16.0 build --cache-dir /path/on/linux/filesystem/fx-cache -Doptimize=ReleaseSafe
./zig-out/bin/fx --version
./zig-out/bin/fx --help
```

The focused helper passes 108 offline tests, including resolved approval/question, remaining blockers, cancellation, idle, and reporter serialization. Removing the resume call reproduced the original regression in two worker tests; restoring it passed. ReleaseSafe build and exact built-binary version/help passed. A Linux-local cache avoids the observed cache-rename `AccessDenied` on a Windows-mounted source directory.

The reporter's transport remains best effort. Tests prove resume emission logic, not live server delivery. Existing sessions must finish safely before choosing how to activate a replacement binary. No active fx process is restarted or replaced. Full upstream Linux/macOS CI and live blocked-to-working/idle happy paths are not claimed complete.

## Reference verification

Final successful commands exited 0:

| Command | Result |
| --- | --- |
| `node --test tests/spawn-agent.test.mjs tests/branding.test.mjs plugins/neura-usage/usage-report.test.mjs` | 90 passed |
| `cargo fmt --all -- --check` | Passed |
| `cargo test --locked --bin herdr client::shell::tests:: -- --test-threads=1` | 302 passed; 2 manual profiles ignored |
| `cargo test --locked --bin herdr clipboard_image` | 8 passed; generated-WSL test intentionally ignored here |
| `cargo test --locked --bin herdr wsl_clipboard -- --include-ignored` | 4 passed, including generated-PNG WSL round-trip |
| `cargo clippy --locked --bin herdr --tests -- -D warnings` | Passed after correcting two cloned-slice test assertions |
| `cargo build --locked --release --bin herdr` | Optimized build passed |
| Focused fx helper above | 108 passed |
| fx ReleaseSafe build; exact binary `--version`, `--help` | Passed; `0.0.13` |
| Both source patches' apply/reverse checks; text-then-image chain | Passed; exact tested source reproduced in disposable copies |
| Staged Windows client's `--version` and existing launcher's `-CheckOnly` | `0.9.3`, config ok, existing server compatible, no restart needed; default executable hash unchanged |

The optimized Windows client and Linux fx binary are staged privately, not bundled or activated. No clipboard contents were read/replaced during these checks.

## Publication and confirmation

The configuration CI checks portable helpers and patch syntax, not vendor builds or live clipboard/SSH behavior. Keep state/image bug issues open until activation and human end-to-end confirmation. Do not mark the entire Obsidian clipboard checklist complete based on source tests alone.

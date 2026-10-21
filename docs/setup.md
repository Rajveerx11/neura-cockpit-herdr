# Setup map and operating boundaries

This repository is the source of truth for the shareable NEURA COCKPIT setup. Keep machine-specific configuration local. See [installation](../README.md#preview-and-install) and [the lean-change policy](../CONTRIBUTING.md).

| Surface | Tracked here | Kept local |
|---|---|---|
| Herdr | `config.windows.toml`, installer, detection override | Expanded config, runtime/session stores |
| Helpers | Rename, F4 context, visible-worker spawn | Actual pane IDs and project directories |
| Plugins | Branding and supported account-usage reporting | CLI credentials and usage cache |
| WSL | Managed-session cwd and spawn bridges | Distribution/home paths |
| Noctty | Palette and paste bindings | Application install and restored windows |
| Clipboard patch | Version-specific source diff | Source checkout, compiler toolchain, built client |
| SSH/Tailscale | Native setup procedure below | Targets, credentials, host keys, saved profiles |
| Notes/calendar | Optional integration boundary below | Vault notes, calendar data, private integration code |

## Local setup

1. Install Herdr 0.9.5, the latest stable release verified for this profile. The installer and spawn helper reject other versions rather than silently assuming compatibility.
2. Review `install.ps1 -StageOnly`. Merge deliberately if plugins/configuration already exist.
3. Validate with `herdr config check`, then run `herdr server reload-config` in the intended local session. On 0.9.5 this also asks attached clients to reload their local config. Ctrl+Shift+R remains the manual alternative.
4. Merge the optional Noctty config. Reload its existing instance with `noctty.exe +perform-action reload_config`, or restart only the outer client when appropriate. This does not replace executable code.
5. Use the existing F1 help and F4 context before adding another always-visible panel.

The authorized reference installation has been updated using backups and a targeted merge, not a wholesale replacement of its live config. See [the 0.9.5 rollout record](herdr-095-rollout.md). Existing installations should stage first and preserve private commands and plugin registrations.

## Historical Windows clipboard build (0.9.3 only)

These patches have not been ported to 0.9.5 and were not activated by the current rollout. Do not apply them to a 0.9.5 source tree or downgrade a running client to use them. The installer never applies a source patch or replaces a binary. Text Ctrl+V was confirmed by a human on the reference Windows setup; Alt+V, image paste, each harness, and remote application paths are separate checks. Screenshot paste is under investigation.

To reproduce a custom client, use a separate source checkout of public Herdr v0.9.3, follow its Windows Rust/Zig build instructions, review/apply `patches/windows-clipboard-paste-v0.9.3.patch`, and run its focused tests before `cargo build --release --locked --bin herdr`. Use the release profile: debug builds use different `herdr-dev` roots. Keep required app-local ConPTY assets and their notices with the executable. Never overwrite a live executable or stop the main server to test a client.

Record the source version, applied patch, test results, binary SHA256, and active client path locally. The optional launcher packages the existing attach-only workflow without a personal path:

```powershell
powershell.exe -NoProfile -File tools/start-patched-client.ps1 -ClientPath C:\work\reviewed-client\herdr.exe -CheckOnly
# Only after preflight and explicit approval:
noctty.exe -e powershell.exe -NoProfile -File tools/start-patched-client.ps1 -ClientPath C:\work\reviewed-client\herdr.exe
```

Run from the repository directory, or use an absolute launcher path when opening another terminal. The launcher is not enabled by the installer; it requires an already-running compatible main server and does not stop it. The repository does not distribute executables or promise automatic upgrades of a custom build.

## SSH over an existing trusted connection

Use your own authorized SSH target/alias; do not paste passwords or private keys into issues. Check host identity through OpenSSH and establish access first. Tailscale connectivity does not replace SSH authentication or host verification.

```powershell
herdr machine add YOUR_SSH_ALIAS --label "Home server" --remote-session default
herdr machine list --json
herdr machine status "Home server" --json
herdr --machine "Home server" status server
herdr --machine "Home server" workspace list
herdr --machine "Home server" pane list
herdr --machine "Home server" agent list
```

Native setup asks before installing missing remote Herdr. Approve installation only on your authorized machine. Refuse any prompt to stop an incompatible existing server unless you separately intend to stop its processes. The reference setup's remote Herdr 0.9.3, reachability, and workspace/pane API discovery passed; an empty agent list was reported honestly.

Selecting a saved machine in the UI does not retarget commands in an existing local pane. Use `--machine` for supported remote API commands. Herdr 0.9.5 supports `--machine ... status server`, but not `status client`. This syntax was checked against the official source, not against a live remote host in this rollout. On older versions, run the remote executable's `status` through your authorized SSH connection. Use its explicit installed path if remote PATH lacks Herdr.

An agent launched through plain SSH is not automatically adopted into Herdr-owned PTYs. Start/resume it in a remote Herdr pane when ready, preserving its intended directory and existing session. Do not terminate the old agent automatically.

## Private notes and calendar integrations

The reference setup has optional private notes/calendar actions. Their service/data integration is not shipped in this portable bundle. Keep those registrations and bindings in local configuration and review them independently. Leaf's Markdown picker is already available without a notes-sync service. Workspace-linked notes are a proposed opt-in enhancement, not permission to upload a vault.

## Verification boundaries

CI covers mocked helper regressions, not live SSH, account requests, clipboard data, GUI input, or deployment. Distinguish source-tested, staged, running, and human-confirmed results. Report stuck blocked-state and screenshot-paste regressions in this repository without private terminal transcripts or screenshots.

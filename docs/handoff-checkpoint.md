# Private local handoff checkpoint

Opt-in manual helper, installed on the authorized Windows reference machine with a protected private checkpoint directory. See the [deployment and rollback record](cockpit-wave-rollout.md). The portable installer, plugins and default keybindings remain unchanged; no daemon is added. Requires Node.js 22+, Git, and an existing private output directory outside every repository. It creates one new Markdown file; it never restores or resumes a session.

## Use

Explicitly select the repository root, workspace ID, every pane ID, next steps, and a **new** private output filename. Nothing is inferred from cwd, focused UI, injected pane IDs, a map, or saved sessions.

```powershell
node .\tools\handoff-checkpoint.mjs --project 'C:\Projects\example' --workspace 'workspace-id' --pane 'pane-id' --private-output 'C:\PrivateCheckpoints\handoff-001.md' --next-step 'Review the pending implementation and run its focused tests'
```

Repeat `--pane` and `--next-step` as needed (at most 32 each; next steps total at most 16,000 UTF-16 code units). Quote values using your shell's literal quoting rules. Next steps are command-line arguments and may be retained by shell history or process inspection: do not supply secrets. The helper does not inspect history or read a next-step file.

`--private-output` is the caller's explicit assertion that the destination is private, local, and neither published nor synced. The helper also enforces filesystem checks below. It cannot discover arbitrary web-server roots, backup agents, or sync configurations. Do not choose those locations even if their permissions pass.

Without native verification, the file labels selected workspace/pane IDs as **user selections, unverified**. To verify them against an endpoint you already know, additionally provide both:

```powershell
--herdr 'C:\TrustedApps\herdr.exe' --endpoint-socket 'C:\PrivateRuntime\herdr-api.sock'
```

The helper uses the explicit socket via `HERDR_SOCKET_PATH`; it clears inherited `HERDR_*` routing values. It checks `herdr --version` for the inspected 0.9.5 contract, then calls only `workspace get SELECTED_ID` and `pane get SELECTED_ID` for selected panes. The workspace ID and every pane/workspace relationship must match. Each pane's `foreground_cwd`, falling back to `cwd`, must exactly match the selected local repository root using native path comparison. A mismatch, missing cwd, malformed response, unsupported version, timeout, or command failure makes **all native verification unavailable**, without copying native errors or partially trusted IDs into the authoritative section. Git can still be saved when native verification is unavailable. Invalid local arguments or an unsafe executable path abort instead.

The endpoint is caller-selected, not authenticated by the helper. IDs are authoritative only within that endpoint at observation time. The contract supplies no atomic endpoint boot identity or guarantee that panes still exist after observation. No remote host, machine profile, endpoint discovery, translation, or fallback is attempted. A local socket that the caller has forwarded elsewhere does not establish remote identity and must not be used for remote verification.

## Contents and privacy

The file includes an observation start/end timestamp in UTC, selected project path, actual Git HEAD and branch (including detached HEAD), dirty/untracked **path names**, native verification status, selected IDs, and user-supplied next steps. All variable data is rendered as indented JSON, escaping control and bidi characters so filenames and next steps cannot introduce Markdown headings, links, raw HTML, or terminal escapes.

Git uses NUL-delimited porcelain output with rename detection disabled; a rename is represented by its old/new path names. Ignored files and submodule internals are excluded. No diff, file body, commit message, remote URL, prompt, title, transcript, screen, native token, or session content is included. Native responses may contain optional metadata, but only validated workspace/pane IDs and the cwd comparison are used; the rest is discarded. The helper does not request agent/session inventories or read other projects. Git itself reads the selected repository's working tree and metadata to determine status. It disables fsmonitor, untracked-cache writes, optional locks, global/system Git config, and inherited `GIT_*` routing; it does not inspect credentials or config files itself.

Collection is sequential, not atomic. HEAD and branch are checked again after the path inventory; movement explicitly labels Git data **stale**. Otherwise it is a **snapshot**, potentially stale immediately: file changes between commands cannot be detected reliably. Neither a clean path inventory nor any native status establishes task completion. No completion claim or resume promise is made. Git failures, unborn HEAD, invalid UTF-8 path output, and malformed inventories abort before file creation. Native verification failures are recorded as unavailable, without inventing state.

Checkpoint content itself is private: filenames, branch names, project paths, IDs, and manually entered next steps may be sensitive. Nothing is uploaded or printed to stdout except a fixed success message. CLI failures use a fixed message without echoing arguments or native error output.

## Filesystem guarantees and limits

Output parents must already exist. No directory creation, ACL change, overwrite, cleanup deletion, or automatic discovery is performed. The destination must end in `.md`. Existing files, directories, symlinks, junctions, and dangling links at that name are refused. The selected project, this helper's source repository, any ancestor containing `.git` or the bare-repository markers `HEAD`/`objects`/`refs`, and common public/sync directory names are refused. Relative paths, traversal components, control characters, URLs, UNC/device paths, DOS reserved names, alternate data streams, and Windows trailing-dot/space aliases are refused.

On **Windows**, output requires a fixed NTFS drive, an owner matching the current user's SID, and a protected parent ACL. Every allow rule must target only that user, SYSTEM, or Administrators. The user needs an inheritable FullControl rule for child files. Fixed PowerShell code imports the built-in Security manifest from the child Windows PowerShell's `$PSHOME`, checks directory ACLs and rejects all reparse-point ancestors; inherited PowerShell 7 module paths cannot redirect Security-module loading. Paths are passed as environment data, never interpolated into script source. The helper does not create or repair private directories. A normal directory inheriting broad access is deliberately refused. Newly created files inherit the parent's restricted ACL; Node's POSIX mode argument is not claimed to secure Windows files. Administrators/SYSTEM remain trusted.

On **Linux/WSL**, the existing parent must be owned by the current UID with no group/other mode bits. New files use mode `0600` and `O_NOFOLLOW` where available. Output supports ext4, XFS, Btrfs, and tmpfs only; unknown/network filesystems and `/mnt/<drive>` paths are refused. Use WSL's native Linux storage and Linux Git/Herdr paths. Windows and WSL paths are not translated, and cross-OS pane cwd values remain unverified. macOS output is currently refused.

All parent components are checked with bigint `lstat` and `realpath`, then their exact device/inode identity is rechecked before and after an exclusive `O_CREAT | O_EXCL` open. Bigint preserves NTFS file IDs above JavaScript's safe integer range. The resulting descriptor must be a regular, singly linked file, checked using bigint `fstat` and link count. Permissions are rechecked before writing. Concurrent creation at the destination fails without replacing it. The file is written through its descriptor and synced before success is reported.

**Race boundary:** portable Node APIs do not provide a directory-handle-relative open across all supported platforms. These checks reject pre-existing and observed redirection, but cannot prevent an adversary from swapping ancestors, mount points, or ACLs between checks, nor prove that a private directory is not published by another process. Use a trusted, stable directory tree; this helper is not a sandbox against hostile concurrent filesystem actors. Other processes running as the same user and administrators can still access or change the file. A write/sync failure or detected race after exclusive creation may leave an empty or partial **new** file; the helper retains it and reports failure, so inspect it and choose a different new filename. It never deletes a path that could have changed owners. Directory-entry durability across power loss is not guaranteed.

## Focused validation and integration

```powershell
node --test tests/handoff-checkpoint.test.mjs
node --check tools/handoff-checkpoint.mjs
node --check tests/handoff-checkpoint.test.mjs
```

On Linux, select a temporary root outside repositories. In the reference environment, `/tmp` and home contain pre-existing `.git` markers; use `TMPDIR=/var/tmp node --test tests/handoff-checkpoint.test.mjs`. Repository-output refusal remains enabled during tests.

Tests use temporary synthetic Git repositories and files, actual filesystem permission/exclusive-create checks, and mocked native responses. They cover spaces, Unicode, control-character serialization, detached HEAD, renames, command/contract failures, stale HEAD, secret exclusion, exact read-only native commands, output refusal, symlink/junction rejection, and concurrent destination creation. Precision regressions simulate distinct device/inode IDs that collide as Numbers, checking rejection both before and after opening output; another test retains multiple-link refusal with bigint counts. Windows verifies inherited file ACLs; Linux additionally exercises real control-character filenames. Tests do not query or mutate live panes, agents, configuration, credentials, or notes.

The native contract was read from the repository's saved Herdr 0.9.5 API schema: `WorkspaceInfo.workspace_id`; `PaneInfo.pane_id`, `workspace_id`, `foreground_cwd`, and `cwd`. CLI `workspace get` and `pane get` follow the existing repository adapters. No server or client integration is required for manual invocation. CI runs the focused suite on Windows and Linux. The authorized reference installation passed a live, explicit pane/project checkpoint check; details and installed-file rollback are in the [deployment record](cockpit-wave-rollout.md). User-created checkpoint files remain private and untouched during helper rollback.

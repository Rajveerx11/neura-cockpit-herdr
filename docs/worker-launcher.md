# Visible worker launcher (#16)

Opt-in, terminal-only frontend to `tools/spawn-agent.mjs`, following the [manager/reviewer work](workspace-preset.md). No runtime, service, dependency, installer change or default shortcut is added. This repository change is not deployed or human-confirmed. Issue #16 stays open for integration and authorized human validation.

## Run and optional setup

Requires Windows PowerShell 5.1, an existing `node.exe` on PATH, and the existing Windows Herdr 0.9.5 guarded helper contract. Run **manually in the intended manager's terminal**, with its original inherited `HERDR_ENV`, `HERDR_BIN_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID` and `HERDR_PANE_ID`. Do not run inside an agent's input box: use its existing shell workflow, without terminating another process or changing directories.

```powershell
& 'C:\path\to\cockpit\tools\worker-launcher.ps1'
```

It asks separately for an exact supported worker kind and a unique name matching `[a-z][a-z0-9_-]{0,31}`. There is no default kind/name, normalization, automatic suffix, or reuse of an existing agent. Blank input at either prompt or Ctrl+C cancels before invoking the helper. Invalid input fails without creating anything; it is not retried. `fx` is not a supported native worker kind; an existing fx manager is left alone.

For a shorter one-action invocation, optionally define a **session-local PowerShell function yourself** in that manager terminal:

```powershell
function Start-VisibleWorker { & 'C:\path\to\cockpit\tools\worker-launcher.ps1' }
Start-VisibleWorker
```

Use the repository's actual absolute path, keeping `worker-launcher.ps1` beside `spawn-agent.mjs`. No copying, installation, profile edit, live settings edit or reload is performed. The installer does not install this optional launcher. From a WSL manager terminal, an explicit manual invocation is possible through Windows PowerShell, provided its child process inherits the original Herdr context:

```bash
powershell.exe -NoProfile -File 'C:\path\to\cockpit\tools\worker-launcher.ps1'
```

Do not manufacture IDs, copy context from another pane or unset popup markers to make an invocation pass. Missing or changed context is a refusal, not permission to use UI focus. A WSL shell's `PWD` is never passed as a worker cwd.

## Why no popup binding or TOML fragment?

Read-only installed `herdr --help`, `herdr --default-config`, `herdr config`, `herdr pane` and `herdr agent` inspection confirmed Herdr 0.9.5 and its command surfaces. The command groups print usage with exit 2; no operation is performed. Default configuration describes `popup` as session-modal and says Windows command strings use `cmd.exe /d /c`. It does **not** establish an authoritative popup-to-intended-manager identity contract. The repository's rename popup uses `HERDR_ACTIVE_*` context for a different purpose; those IDs, popup IDs, a popup cwd, or the currently focused pane are not proof of this launcher's intended manager.

Consequently no popup launch is supported or advertised. `-Popup` always fails closed, even with otherwise plausible caller IDs. Known `HERDR_ACTIVE_PANE_ID`, `HERDR_ACTIVE_WORKSPACE_ID`, `HERDR_ACTIVE_TAB_ID` and `HERDR_ACTIVE_PANE_CWD` popup markers also cause refusal before prompting. This is not authentication of arbitrary caller-supplied environment variables: terminal-only usage with original injected context is a requirement. A popup without markers cannot be independently identified by this script. Do not bind it as a Herdr popup, shell, or temporary-pane command, or pass popup/active IDs into caller-ID variables. No `config.worker-launcher.toml` is supplied because a validated safe popup binding is unavailable. The manual terminal command/session-local function above is the safe fallback setup.

## Guarded execution and failures

After both answers, the launcher passes exactly these arguments once to the existing helper through a native `node.exe` argument array:

```text
<absolute spawn-agent.mjs path> --kind <kind> --name <name>
```

It does not add `--prompt-file`, `--cwd`, native agent arguments, a preliminary helper invocation, an approval response, retries or raw-input fallback. It does not change caller environment or cwd. The helper remains responsible for authoritative API context/cwd, live name uniqueness and native version compatibility. It splits right in the manager's existing workspace/tab with `--no-focus`, requires at least 121x12 before splitting and at least 60 columns/12 rows in each resulting pane, and rejects zoomed or uncertain geometry. There is no alternate topology or smaller-pane fallback. Other panes and agents are not adopted, moved or renamed.

Only a verified helper response with the requested kind/name and matching caller context, boolean readiness, preserved focus and no submitted prompt counts as success. This means ready for interactive input, **not** a submitted task, observed work or completion. Native `agent start` retains its bounded readiness wait; the launcher adds no polling.

Nonzero exit preserves the helper's error text, including `pane_id`, cleanup evidence and startup failure. Lost/malformed responses are ambiguous even if the subprocess exits zero. The launcher never invokes the helper twice or performs cleanup. The existing helper can close only its positively identified untouched shell on a failure *before* startup dispatch. Uncertain split outcomes and startup failures retain any possible/known pane. Inspect manager layout and any retained pane yourself before deciding what to do; do not blindly rerun. Never automatically answer an approval or trust dialog. Snapshot checks are not an atomic layout lock, and another client may change state afterward.

## Focused verification

From the checkout on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/worker-launcher.tests.ps1
node --test tests/spawn-agent.test.mjs
```

The dependency-free PowerShell suite parses and dot-sources the launcher, mocks input and the native invocation boundary, and checks cancellation, invalid kind/name, missing context, popup refusal, exact once-only arguments, context preservation, kind-list parity, propagated failures and ambiguous success responses. Adapter tests mock executable resolution and native output. Separate native PowerShell processes verify safe popup/missing-context rejection. Existing Node tests exercise the real guarded spawn implementation with mocked Herdr calls, including geometry/focus, unique names, API cwd and retained-pane failures. None of these tests launch an agent or read private transcripts.

Local results: the PowerShell command above passed all 56 tests on native Windows PowerShell 5.1 (exit 0), including both separate-process fail-closed checks. The Node command passed all 80 tests (exit 0). An initial PowerShell fixture incorrectly treated an arbitrary opaque pane ID as invalid; it was corrected to test reuse of the known manager pane ID, then the suite passed.

Native interactive success, Windows/WSL environment inheritance, actual layout/focus preservation, cancellation keystrokes and harness startup remain unverified live. This task does not change live settings, other agents, hooks, trust or server state. No config validation is claimed: no config fragment is provided.

## Rollback

Stop invoking the launcher. If you defined the session-local function above, remove only that function:

```powershell
Remove-Item Function:\Start-VisibleWorker
```

No default binding, profile entry, persistent registration or live config was added. Removing the new launcher/test/doc source files removes this opt-in addition; retain `spawn-agent.mjs` and every other helper. Rollback does not close a retained pane or stop an agent. Inspect those manually and preserve any later edits. No server restart or reload is needed.

# Issue #8: snippet composer blocked on native safety

Status: **not implemented; not deployed**. No snippet helper or upstream patch was added. This report does not complete the feature's acceptance criteria.

## Contract evidence

Read-only inspection used installed `herdr 0.9.5` help and bundled `herdr api schema --json`, plus official v0.9.5 source at commit [`2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`](https://github.com/herdrdev/herdr/tree/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01). The existing `tools/rename-context.ps1` was inspected first; it provides no paste operation.

- [`src/cli/pane.rs:1017–1025`](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/cli/pane.rs#L1017-L1025): `pane send-text` calls `PaneSendText`. Its [handler at `src/app/api/panes.rs:1912–1927`](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/app/api/panes.rs#L1912-L1927) sends raw bytes, not semantic paste. Embedded newlines can become terminal input rather than draft text.
- [`src/app/api_helpers.rs:25–31,69–84`](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/app/api_helpers.rs#L25-L84): API `pane.send_input` can encode text without keys, but brackets it only when the runtime enables bracketed paste. Otherwise it falls back to raw bytes. This is not a fail-closed no-submit contract for arbitrary multiline text.
- [`src/api/schema/panes.rs:338–344,449–483`](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/api/schema/panes.rs#L338-L483): input parameters contain only `pane_id`, `text`, and `keys`. `PaneInfo` does not expose bracketed-paste mode. There is no input precondition for the expected terminal identity or agent state.
- [`src/app/api/panes.rs:1930–1958`](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/app/api/panes.rs#L1930-L1958): the input handler resolves the pane, encodes input and sends bytes. It does not atomically check an expected terminal identity or reject an approval state. A separate fresh read cannot prevent a target or state change between that read and the write.
- [`src/cli/pane.rs:1039–1052`](https://github.com/herdrdev/herdr/blob/2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01/src/cli/pane.rs#L1039-L1052): `pane run` supplies `keys: ["Enter"]`. Installed `agent prompt --help` describes prompt submission, not draft insertion. Neither is an acceptable fallback. Key injection and hand-built escape wrappers are excluded too.

## Missing acceptance

A safe composer needs one native paste that rejects unsupported draft insertion and changed target/state, without raw-newline fallback or an approval response. These checks cannot be inferred from a successful command exit or simulated in a mock to claim real support.

No payload, cancellation, target-change, or real-harness paste tests are claimed. No pane was mutated, prompted, or read for this investigation. Clipboard, history databases, authentication and session stores were not accessed. There is no deployed change to roll back; removing this report removes the entire issue-specific change. Revisit only after a supported native contract can meet these requirements.

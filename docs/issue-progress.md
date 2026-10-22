# Open-issue work log

This log distinguishes the earlier first batch from the new helper rollout. The new helpers are installed on the authorized Windows reference machine. See the [rollout record](helper-rollout.md) for verification and backups. None of their GitHub issues was closed by this batch.

See [the rollout record](herdr-095-rollout.md) for compatibility evidence and rollback. Private configuration and receipts are not published.

## Issue status

| Issue | Current status | Remaining work |
| --- | --- | --- |
| [#1 Compact rows](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/1) | Opt-in two-row layout deployed. Native 0.9.5 validation and reload passed. | Human comparison at minimum width with long/missing names, across hosts and focus states |
| [#2 Attention queue](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/2) | Partial: read-only blocked/unknown inventory deployed. Explicit local-endpoint query succeeded. | Client-specific unseen completion and safe jumping remain unavailable |
| [#3 Connection/build identity](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/3) | Partial, installed: opt-in CLI fingerprint/build and explicit CLI endpoint evidence. Installed local-endpoint check passed. | Attached UI client/host identity is unavailable in the inspected 0.9.5 contract. See [identity boundaries](issue-3-identity.md). |
| [#4 Focus mode](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/4) | Triaged, not implemented | Check native zoom/sidebar actions and restoration before adding an opt-in action |
| [#5 Quota freshness](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/5) | Partial: event-time status code deployed. Native refresh action exited successfully. | Idle expiry still hides the badge until another event. No live agent exposed supported provider metadata for a real quota fetch. |
| [#6 Workspace preset](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/6) | Implemented and installed: one opt-in manager + reviewer preset reusing guarded spawning | Authorized live Windows/WSL launch, layout and focus confirmation remains pending. See [usage and rollback](workspace-preset.md). |
| [#7 Remote launch/resume](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/7) | Triaged, not implemented | Verify saved-profile contracts and test an explicitly authorized target. No target has been chosen. |
| [#8 Snippet composer](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/8) | Blocked, not implemented | Native 0.9.5 input lacks the required fail-closed draft-paste and target/state guarantees. See [source evidence](issue-8-snippet-blocker.md). |
| [#9 Workspace notes](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/9) | Implemented and installed: explicit local map/project/note selection with one-shot Leaf rendering. Installed synthetic-note check passed. | Human project/note workflow validation. No automatic workspace inference or note editing. See [notes helper](issue-9-workspace-notes.md). |
| [#10 Health check](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/10) | Triaged, not implemented | Extend F4/launcher preflight after identity checks. No automatic repair. |
| [#11 Stale blocked state](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/11) | Prior optional fx source patch published, not activated here | Safe activation and human end-to-end confirmation. Keep issue open. |
| [#12 Screenshot paste](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/12) | Prior optional 0.9.3 patch published, not ported or activated on 0.9.5 | Matching-version work and physical screenshot/harness confirmation. Keep issue open. |

The current parallel batch added partial connection evidence, the preset, and explicit note selection. Snippet safety is blocked rather than worked around. The read-only health check remains pending. Bug activation gates remain separate. See [historical bug fixes](bug-fixes.md) and [attention limitations](issue-2-attention.md).

## Compact rows

```powershell
.\install.ps1 -StageOnly -CompactRows
```

The flag replaces the entire agent-row section, including per-agent overrides, using `config.compact-rows.toml`. Native state precedes the harness mark and agent label. Workspace and machine occupy the second row. F4 retains details. Native rendering handles truncation and absent tokens. No detector changes.

Without the flag, the portable template retains its original four-row layout. The live reference installation deliberately selected compact rows. Staging never reloads a client or links plugins. Existing installations must merge reviewed changes rather than overwrite their private config.

## Quota status

The reporter publishes `limits refreshing` before a provider request. Successful quota is labeled `fresh`, with age on cache hits. A failed same-revision refresh retains only the previous success time and reports `limits stale` with age, without old percentages. Missing credentials or quota data report `limits unavailable`. Changed-revision failures cannot retain the previous account's success age.

Age describes the event, not a live clock. Native two-minute token expiry still applies. Idle tokens can disappear until the next focus/state event or manual refresh. This is not a persistent stale badge after expiry. No polling job or second usage service was added. Cache records contain no credentials, account IDs, or provider error text.

The live refresh action completed, but it had no eligible provider metadata to process. Provider account requests remain unverified. No metadata was invented to force them.

## New helper batch

The manager integrated three isolated worker lanes, with #9 replacing the blocked #8 implementation. Independent review identified Unicode path-association and identity-response parsing/encoding defects. Those findings received targeted fixes and regression checks. The shared spawn helper now requires explicit boolean readiness rather than accepting an omitted false field. No helper retries or live prompts were added.

The installer stages all helper dependencies. CI includes the new helper tests. Five helpers were installed with verified backups and matching source hashes. Configuration and plugin registrations were left unchanged. No server reload/restart, remote lifecycle or clipboard operation was performed. The combined local checks passed 184 Node tests and 74 mocked PowerShell cases. Native installer staging passed for default and compact layouts. The installed notes helper rendered a disposable generated note through Leaf, and the installed identity helper passed an explicit local-endpoint check. Independent feature review covered 20 changed files with zero skipped and no code blockers. Its stale-documentation findings were corrected. The private deployment code was independently reviewed and a concurrent-edit finding was fixed before live use. Consult each published commit's GitHub Actions checks for hosted results. LSP was attempted but the TypeScript language server is absent. Native agent layout and endpoint acceptance remain separate from mocked tests.

## Earlier deployed-batch checks

The updated bundle passed 100 Node cases and 58 mocked PowerShell cases. WSL bridge tests passed 13 cases. Native 0.9.5 validated both staged layouts. Two private rollout fixtures passed before activation, including a backup-junction refusal. Runtime checks verified deployed hashes and preserved pane context. See the rollout record for the full matrix.

Independent reviews found and then verified corrections for path-first plugin linking and backup-path validation before activation. OCR code review and manual documentation review remain separate from visual confirmation. LSP was attempted but unavailable. The rival-model prose command failed, so prose received manual editorial review and lint checks.

The prior 0.9.3 patch tests are historical evidence, not proof of 0.9.5 clipboard behavior. This rollout did not replace a binary or stop a server. It did not test a remote lifecycle or physical screenshot paste.

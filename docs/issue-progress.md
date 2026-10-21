# Open-issue work log

All twelve GitHub issue bodies were checked before this batch. The implemented first batch is now deployed on the authorized reference installation using Herdr 0.9.5. This is not a claim that all twelve issues are fixed or closed.

See [the rollout record](herdr-095-rollout.md) for compatibility evidence and rollback. Private configuration and receipts are not published.

## Issue status

| Issue | Current status | Remaining work |
| --- | --- | --- |
| [#1 Compact rows](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/1) | Opt-in two-row layout deployed. Native 0.9.5 validation and reload passed. | Human comparison at minimum width with long/missing names, across hosts and focus states |
| [#2 Attention queue](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/2) | Partial: read-only blocked/unknown inventory deployed. Explicit local-endpoint query succeeded. | Client-specific unseen completion and safe jumping remain unavailable |
| [#3 Connection/build identity](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/3) | Triaged, not implemented | Establish displayed client and endpoint identity, not just a static label |
| [#4 Focus mode](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/4) | Triaged, not implemented | Check native zoom/sidebar actions and restoration before adding an opt-in action |
| [#5 Quota freshness](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/5) | Partial: event-time status code deployed. Native refresh action exited successfully. | Idle expiry still hides the badge until another event. No live agent exposed supported provider metadata for a real quota fetch. |
| [#6 Workspace preset](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/6) | Triaged, not implemented | Extend existing spawn guards for one explicit preset. Retain ambiguous partial launches. |
| [#7 Remote launch/resume](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/7) | Triaged, not implemented | Verify saved-profile contracts and test an explicitly authorized target. No target has been chosen. |
| [#8 Snippet composer](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/8) | Triaged, not implemented | Verify semantic paste and explicit confirmation without Enter |
| [#9 Workspace notes](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/9) | Triaged, not implemented | Add explicit local project/note selection using Leaf. Do not discover or upload private notes. |
| [#10 Health check](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/10) | Triaged, not implemented | Extend F4/launcher preflight after identity checks. No automatic repair. |
| [#11 Stale blocked state](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/11) | Prior optional fx source patch published, not activated here | Safe activation and human end-to-end confirmation. Keep issue open. |
| [#12 Screenshot paste](https://github.com/Rajveerx11/neura-cockpit-herdr/issues/12) | Prior optional 0.9.3 patch published, not ported or activated on 0.9.5 | Matching-version work and physical screenshot/harness confirmation. Keep issue open. |

The next implementation group is connection identity and read-only health checks, followed by spawn helpers and local opt-in tools. Bug activation gates remain separate. See [historical bug fixes](bug-fixes.md) and [attention limitations](issue-2-attention.md).

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

## Checks and boundaries

The updated bundle passed 100 Node cases and 58 mocked PowerShell cases. WSL bridge tests passed 13 cases. Native 0.9.5 validated both staged layouts. Two private rollout fixtures passed before activation, including a backup-junction refusal. Runtime checks verified deployed hashes and preserved pane context. See the rollout record for the full matrix.

Independent reviews found and then verified corrections for path-first plugin linking and backup-path validation before activation. OCR code review and manual documentation review remain separate from visual confirmation. LSP was attempted but unavailable. The rival-model prose command failed, so prose received manual editorial review and lint checks.

The prior 0.9.3 patch tests are historical evidence, not proof of 0.9.5 clipboard behavior. This rollout did not replace a binary or stop a server. It did not test a remote lifecycle or physical screenshot paste.

# Keep the cockpit lean

This repository owns portable configuration, small helpers, setup instructions, and optional local patches. It is not the upstream Herdr repository or a new agent runtime.

## Feature budget

- Start with a tracked issue, a concrete workflow problem, and measurable acceptance criteria.
- First try an existing Herdr command, binding, token, or helper. Extend F4, F1, or the existing plugin before adding a competing panel or service.
- Configuration first; one small helper only when necessary; native UI work only after confirming the existing API cannot express the behavior.
- Optional features remain opt-in. Do not add ten default shortcuts, recurring polling jobs, a dashboard framework, or a dependency for each issue.
- No new background daemon, database, web UI, or package dependency without an explicit, evidence-backed decision in the issue.
- Prefer native state/events and existing caches. Unknown, stale, unavailable, and disconnected are real states; never fabricate readiness, completion, quota, or connectivity.
- Keep changes scoped to one issue. Run focused checks and state what remains unverified. Do not call a user report a reproduced defect until reproduction exists.

## Safety and compatibility

- Preserve running servers, user panes, focus, agent directories, and existing authentication. Never automatically answer approvals.
- Keep credentials, machine profiles/addresses, private notes/calendars, clipboard data, logs, caches, session stores, compiled binaries, and personal paths out of Git and issue attachments.
- Use placeholders in examples. Review staged content, not only ignore rules, before publication.
- Keep Herdr's published endpoint contracts unchanged. An optional patch must identify its exact source version and can be built/tested separately; the configuration installer must not silently apply it.
- Do not submit this backlog or implementation patches to upstream Herdr. This project's issues govern this configuration repository only.

## Definition of done

Acceptance criteria, smallest implementation, focused passing checks, safe rollback, documentation, and honest deployment status. A feature can be declined or simplified when its complexity exceeds its demonstrated value.

The GitHub issue tracker is the backlog; the first-batch milestone is a sequencing guide, not permission to implement every feature at once.

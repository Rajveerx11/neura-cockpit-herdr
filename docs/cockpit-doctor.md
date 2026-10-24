# Manual Cockpit doctor

Backlog #10: a one-shot, read-only health summary using the existing identity and integration adapters. The authorized Windows reference installation now includes this helper and a **NEURA Cockpit Doctor** Start-menu shortcut; see the [deployment and rollback record](cockpit-wave-rollout.md). The portable configuration installer and F4 binding remain unchanged.

Run with Windows PowerShell 5.1 and explicitly trusted inputs:

```powershell
powershell -NoProfile -File tools/cockpit-doctor.ps1 -Binary 'C:\trusted\herdr.exe' -EndpointSocket 'C:\trusted\server.sock'
```

Replace the example paths yourself. The doctor never selects a binary from PATH or `HERDR_BIN_PATH`, discovers endpoints, runs installers, repairs integrations, reads credentials, or changes panes, configuration, agent state or running servers. Only the supplied executable is trusted to implement the three read-only commands. Do not supply an untrusted executable.

Dot sourcing is inert: no file probes, native commands, output, UI, exits or preference changes. Call `Get-CockpitDoctor` with the same parameters for a structured result; call `Show-CockpitDoctor` for text. The renderer sets `LASTEXITCODE`; the structured getter returns `ExitCode`. The entrypoint exits with that code.

## Evidence and exit status

- CLI version and SHA256 identify the invoked file. They do not establish official/custom provenance or the attached UI's identity.
- Server evidence comes from `status server --json` at the explicit endpoint. A connected server with a parsed `0.9.5` build establishes only the observed 0.9.5 status contract. Other builds, invalid replies and failures have unknown compatibility; this is not proof of protocol or feature compatibility.
- Attached-client build, selected host and connection remain unknown. No popup, pane ID or inherited routing variable supplies that evidence.
- `integration status` describes installed files in the invoked CLI's inherited integration homes. It does not inspect integrations on the explicit server, prove hook registration, or establish which code running agents loaded. `current` is relative to that CLI's bundled version. Omitted targets are unavailable; `not-installed` is a distinct valid observation.
- Exit **0** means the CLI/server evidence is recognized, integration inventory is complete with no outdated/needs-repair rows, and requested integrity checks match. Optional integrations reported `not-installed` do not fail the check. Exit **1** means evidence needs review: unknown/unavailable identity, disconnected server, incomplete inventory, outdated/needs-repair integrations, or failed requested integrity verification. It never triggers a repair.

The identity adapter runs `status client --json` and `status server --json` once each; the integration adapter runs `integration status` once. Each child has a 3-second execution wait, at most a 1-second termination wait on timeout, and bounded 1-second stdout/stderr completion waits. Only a timed-out probe child is terminated. There is no polling or retry. File reads use local storage; these process timeouts are not disk I/O deadlines.

For adapter reuse, the getter temporarily sets the current PowerShell process's `HERDR_BIN_PATH` to the explicit binary and restores it in `finally`. It does not change persistent environment settings or the caller's socket. Run this manual helper synchronously, not concurrently with other environment-dependent operations in the same process.

## Optional hash-only installation manifest

Supply both `-ManifestPath` and `-ManifestSha256` to verify an explicitly reviewed installation manifest and the bundle/helper files it lists:

```powershell
powershell -NoProfile -File tools/cockpit-doctor.ps1 -Binary 'C:\trusted\herdr.exe' -EndpointSocket 'C:\trusted\server.sock' -ManifestPath 'C:\reviewed-bundle\manifest.json' -ManifestSha256 '<trusted 64-character SHA256>'
```

The JSON object maps relative file names to expected SHA256 values. Replace these illustrative zero hashes with independently reviewed values:

```json
{
  "herdr.exe": "0000000000000000000000000000000000000000000000000000000000000000",
  "tools/cockpit-doctor.ps1": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

The manifest's directory is the only permitted root. The expected manifest hash must come from a trusted baseline; calculating it from an unreviewed receipt does not establish trust. Other receipt formats, installer commands and arbitrary metadata are unsupported. No receipt content is evaluated or executed. Include the supplied CLI in this root/list if its bytes must also be compared to an expected hash; the normal CLI fingerprint alone has no baseline. A matching bundle file does not prove an installed copy or running process uses those bytes.

Limits: 64 KiB of strict UTF-8 JSON, 1–32 entries, and 256 MiB per listed file. File hashes stream from a read-only handle, including the 26,955,264-byte bundle regression fixture. The handle denies concurrent write/delete sharing. No directory enumeration, recursive scan or user-home discovery occurs. The manifest and listed files must be on a local fixed disk, with no symlink/junction/reparse-point component. Names use portable ASCII letters, digits, spaces, `_`, `-`, `.`, and `/` separators; traversal, rooted paths, ADS, device names, duplicate/case-conflicting entries, trailing dots/spaces and malformed hashes are rejected.

Use a stable, reviewed directory. Ancestor checks are not an atomic defense against an adversary replacing directories during the check. Integrity is a bounded file snapshot, not a signature verifier or hostile-filesystem security boundary. A missing/unsafe/oversized file makes integrity unavailable; manifest mismatch and file mismatch remain distinct. Counts can retain successfully checked entries before a later unavailable file, but the overall state never reports success in that case.

Reports contain only allowlisted status/version text, the CLI fingerprint, and aggregate integrity counts. Executable names, full paths, receipt entries, native stderr and raw exceptions are not rendered. Keep receipts and their paths private; they are not generated or published by this tool.

## Tests and future F4 integration

```powershell
powershell -NoProfile -File tests/cockpit-doctor.tests.ps1
powershell -NoProfile -File tests/cockpit-identity.tests.ps1
powershell -NoProfile -File tests/cockpit-integrations.tests.ps1
```

Doctor tests use inert files and mocked native processes, including script invocation, timeouts and reparse-point attributes. They exercise partial/unavailable evidence, outdated-but-parsed integrations, redaction, manifest validation, mismatch, bundle size, import safety and no persistent mutation. They do not query live agents or integrations.

Deploy `cockpit-doctor.ps1` beside `cockpit-identity.ps1` and `cockpit-integrations.ps1`; optional integrity inputs remain opt-in. The reference Start-menu entry passes the reviewed client, explicit main socket, helper manifest and pinned manifest hash. Its installed smoke check verified all five helper hashes and correctly reported the existing outdated Claude/Codex integrations; none was repaired. CI runs the doctor suite on Windows. No F4 binding, portable installer or shared configuration was changed. A future F4 integration must retain explicit endpoint selection and unknown attached-client identity. Removing the entrypoint requires no server restart; see the [deployment record](cockpit-wave-rollout.md) for installed-file rollback.

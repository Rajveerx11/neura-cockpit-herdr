#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, spawnAgent } from './spawn-agent.mjs';

export const HELP = `Usage: node workspace-preset.mjs --kind codex [--name reviewer] [--cwd PATH] [--dry-run]
One opt-in manager+reviewer preset for Herdr 0.9.5.
The existing injected agent pane remains manager; add one reviewer to its right.
Requires a single-pane, unzoomed tab with at least 121 columns and 12 rows.
Both panes remain >=60 columns, in the same workspace/tab and API cwd, without focus changes.
--kind is required; --name defaults to reviewer and must be unique among live agents.
--cwd only asserts the manager's authoritative Windows/WSL cwd; it never overrides it.
--dry-run reads native state and shows the requested two-pane topology; it writes nothing.
No prompts, approvals, manager launches, renames, tab/workspace creation or rearrangement.
Uses spawn-agent.mjs kind/readiness guards and owned-shell cleanup.
Ambiguous launches retain the new pane: inspect before retrying. No helper-level retries.
Native agent-start readiness waits and pre-launch busy handling remain unchanged.
`;

export function workspacePreset(argv, dependencies = {}) {
  if (argv.includes('--prompt-file')) throw new Error('Workspace preset does not submit prompts.');
  const args = argv.includes('--name') ? argv : [...argv, '--name', 'reviewer'];
  const options = parseArgs(args);
  if (options['--help']) return { help: HELP };
  const result = spawnAgent(args, { ...dependencies, workspacePreset: true });
  return { ...result, preset: 'manager-reviewer', topology: {
    requested_panes: 2,
    manager: { pane_id: result.parent_pane_id, preserved: true, side: 'left' },
    reviewer: { pane_id: result.pane_id ?? null, name: result.name, kind: result.kind, side: 'right' },
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = workspacePreset(process.argv.slice(2));
    console.log(result.help ?? JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, pane_id: error.pane_id ?? null,
      cleanup: error.cleanup ?? 'no_mutation', cli_exit_code: error.cliExitCode ?? null }));
    process.exitCode = 1;
  }
}

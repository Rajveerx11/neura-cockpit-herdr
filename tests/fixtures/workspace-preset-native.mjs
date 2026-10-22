// Test-only preload: intercept every native call made by the real CLI entrypoint.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';

const fixture = JSON.parse(process.env.WORKSPACE_PRESET_FIXTURE);
Object.defineProperty(process, 'platform', { value: fixture.platform ?? 'win32' });
const parent = { pane_id: 'wA7:pB2', terminal_id: 'terminal-manager', workspace_id: 'wA7',
  tab_id: 'wA7:tC3', cwd: 'D:\\Project with spaces\\exact', agent: 'fx', focused: true, ...fixture.parent };
const child = { ...parent, pane_id: 'wA7:pF9', terminal_id: 'terminal-reviewer', agent: null,
  focused: false, ...fixture.child };
const rect = (x, width) => ({ x, y: 0, width, height: 37 });
const before = { workspace_id: parent.workspace_id, tab_id: parent.tab_id, zoomed: false,
  focused_pane_id: parent.pane_id, panes: [{ pane_id: parent.pane_id, rect: rect(0, 128) }], ...fixture.before };
const after = { ...before, panes: [{ pane_id: parent.pane_id, rect: rect(0, 64) },
  { pane_id: child.pane_id, rect: rect(65, 63) }], ...fixture.after };
const ok = result => ({ status: 0, stdout: JSON.stringify({ result }), stderr: '' });
const calls = [];
let split = false;
let parentReads = 0;
childProcess.spawnSync = (command, argv, options) => {
  assert.equal(options.shell, false);
  const verb = argv.slice(0, 2).join(' ');
  calls.push({ command, argv });
  if (fixture.failure?.verb === verb) {
    if (fixture.failure.invalidJSON) return { status: 0, stdout: '{', stderr: '' };
    return { status: 1, stdout: '', stderr: JSON.stringify({ error: { code: fixture.failure.code } }) };
  }
  if (command === 'wslpath') return { status: 0, stdout: fixture.converted ?? parent.foreground_cwd ?? parent.cwd, stderr: '' };
  if (argv[0] === '--version') return { status: 0, stdout: 'herdr 0.9.5\n', stderr: '' };
  if (argv[0] === 'status') return { status: 0, stdout: 'client:\n  version: 0.9.5\nserver:\n  version: 0.9.5\n  endpoint_compatible: yes\n  private_protocol_compatible: yes\n', stderr: '' };
  if (verb === 'pane get') {
    if (argv[2] === parent.pane_id) {
      parentReads++;
      return ok({ pane: parentReads > 1 ? { ...parent, ...fixture.laterParent } : parent });
    }
    assert.equal(argv[2], child.pane_id);
    return ok({ pane: { ...child, ...fixture.liveChild } });
  }
  if (verb === 'pane layout') return ok({ layout: split ? after : before });
  if (verb === 'agent list') return ok({ agents: fixture.agents ?? [] });
  if (verb === 'pane split') { split = true; return ok({ pane: child }); }
  if (verb === 'agent start') {
    const agent = { ...child, cwd: parent.foreground_cwd ?? parent.cwd,
      name: argv[2], agent: argv[4], agent_status: 'idle', interactive_ready: true, ...fixture.started };
    if (fixture.omitReadiness) delete agent.interactive_ready;
    return ok({ agent });
  }
  if (verb === 'pane process-info') return ok({ process_info: fixture.processInfo ?? {
    pane_id: child.pane_id, shell_pid: 4927, foreground_processes: [{ pid: 4927, name: 'powershell.exe' }] } });
  if (verb === 'pane close') return ok({ pane_id: child.pane_id });
  assert.fail(`Unexpected native call: ${command} ${argv.join(' ')}`);
};
syncBuiltinESMExports();
process.on('exit', () => process.stderr.write(`MOCK_CALLS=${JSON.stringify(calls)}\n`));

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../tools/workspace-preset.mjs', import.meta.url));
const preload = new URL('./fixtures/workspace-preset-native.mjs', import.meta.url).href;
const cwd = 'D:\\Project with spaces\\exact';
const args = ['--kind', 'codex'];
function run(extra = [], fixture = {}) {
  const result = spawnSync(process.execPath, ['--import', preload, script, ...args, ...extra], {
    encoding: 'utf8', env: { ...process.env, HERDR_ENV: '1', HERDR_BIN_PATH: 'C:\\Mock\\herdr.exe',
      HERDR_WORKSPACE_ID: 'wA7', HERDR_TAB_ID: 'wA7:tC3', HERDR_PANE_ID: 'wA7:pB2',
      PWD: '/unrelated/shell/cwd', WORKSPACE_PRESET_FIXTURE: JSON.stringify(fixture) },
  });
  assert.ifError(result.error);
  const match = result.stderr.match(/^MOCK_CALLS=(.*)$/m);
  assert.ok(match, result.stderr);
  const calls = JSON.parse(match[1]);
  const errorText = result.stderr.replace(/^MOCK_CALLS=.*\r?\n?/m, '').trim();
  return { ...result, calls, error: errorText ? JSON.parse(errorText) : null,
    output: result.stdout.startsWith('{') ? JSON.parse(result.stdout) : result.stdout };
}
const verbs = result => result.calls.map(call => call.argv.slice(0, 2).join(' '));
const writes = result => result.calls.filter(call => /^(pane (split|close)|agent (start|prompt))$/.test(call.argv.slice(0, 2).join(' ')));
function refused(result, message, cleanup = 'no_mutation') {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.error.error, message);
  assert.equal(result.error.cleanup, cleanup);
}

// Each case executes the actual CLI with all native process calls mocked by preload.
test('entrypoint help, missing kind and outside-Herdr refusal', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /One opt-in manager\+reviewer preset/);
  assert.deepEqual(help.calls, []);
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stderr).error, /Unsupported kind/);
  const outside = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, HERDR_ENV: '0' } });
  assert.equal(outside.status, 1);
  assert.match(JSON.parse(outside.stderr).error, /Not inside Herdr/);
});

test('dry-run requests exactly two panes, reads only, preserves authoritative cwd', () => {
  const result = run(['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.cwd, cwd);
  assert.equal(result.output.preset, 'manager-reviewer');
  assert.deepEqual(result.output.topology, { requested_panes: 2,
    manager: { pane_id: 'wA7:pB2', preserved: true, side: 'left' },
    reviewer: { pane_id: null, name: 'reviewer', kind: 'codex', side: 'right' } });
  assert.deepEqual(result.output.split_args, ['pane', 'split', '--pane', 'wA7:pB2', '--direction', 'right', '--cwd', cwd, '--no-focus']);
  assert.equal(result.output.dry_run, true);
  assert.equal(result.output.ready, false);
  assert.equal(result.output.prompt_requested, false);
  assert.equal(result.output.prompt_submitted, false);
  assert.deepEqual(verbs(result), ['--version', 'status', 'pane get', 'pane layout', 'agent list']);
  assert.ok(result.calls.every(call => call.command === 'C:\\Mock\\herdr.exe'));
  assert.deepEqual(writes(result), []);
});

test('normal entrypoint creates only reviewer, same workspace/tab/cwd and no focus or prompt', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.ready, true);
  assert.equal(result.output.workspace_id, 'wA7');
  assert.equal(result.output.tab_id, 'wA7:tC3');
  assert.equal(result.output.topology.reviewer.pane_id, 'wA7:pF9');
  assert.equal(result.output.focus, false);
  assert.equal(result.output.prompt_submitted, false);
  assert.deepEqual(writes(result).map(call => call.argv), [
    ['pane', 'split', '--pane', 'wA7:pB2', '--direction', 'right', '--cwd', cwd, '--no-focus'],
    ['agent', 'start', 'reviewer', '--kind', 'codex', '--pane', 'wA7:pF9'],
  ]);
});

test('custom reviewer name reuses validation and startup target', () => {
  const result = run(['--name', 'reviewer-2']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.topology.reviewer.name, 'reviewer-2');
  assert.ok(result.calls.some(call => call.argv.join(' ') === 'agent start reviewer-2 --kind codex --pane wA7:pF9'));
});

test('Windows cwd assertion uses exact API cwd and foreground cwd over label', () => {
  const actual = 'E:\\Actual work\\';
  const result = run(['--cwd', 'e:\\actual work', '--dry-run'], { parent: { foreground_cwd: actual } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.cwd, actual);
  assert.deepEqual(writes(result), []);
});

test('WSL cwd assertion converts only assertion and uses Windows API path for split', () => {
  const asserted = '/mnt/d/Project with spaces/exact';
  const result = run(['--cwd', asserted], { platform: 'linux' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.find(call => call.command === 'wslpath').argv, ['-w', asserted]);
  assert.ok(result.calls.filter(call => call.command !== 'wslpath').every(call => call.command.endsWith('/.local/bin/herdr') && !call.argv.includes(asserted)));
  assert.equal(result.output.cwd, cwd);
});

for (const [label, extra, fixture, message] of [
  ['prompt-file', ['--prompt-file', 'must-not-read.md'], {}, /does not submit prompts/],
  ['approval response', ['--approve'], {}, /Unknown argument/],
  ['bad name', ['--name', 'Bad Name'], {}, /Name must match/],
  ['duplicate name', [], { agents: [{ name: 'reviewer' }] }, /already in use/],
  ['custom duplicate name', ['--name', 'reviewer-2'], { agents: [{ name: 'reviewer-2' }] }, /already in use/],
  ['zoomed', [], { before: { zoomed: true } }, /zoomed/],
  ['narrow', [], { before: { panes: [{ pane_id: 'wA7:pB2', rect: { x: 0, y: 0, width: 120, height: 37 } }] } }, /too narrow/],
  ['multiple panes', [], { before: { panes: [{ pane_id: 'wA7:pB2', rect: { x: 0, y: 0, width: 128, height: 37 } }, { pane_id: 'wA7:other' }] } }, /single-pane tab/],
  ['no manager agent', [], { parent: { agent: null } }, /existing agent as manager/],
  ['different Windows cwd', ['--cwd', 'C:\\wrong'], {}, /differs from the parent/],
  ['different WSL cwd', ['--cwd', '/mnt/c/wrong'], { platform: 'linux', converted: 'C:\\wrong' }, /differs from the parent/],
  ['moved parent', [], { parent: { tab_id: 'wA7:other' } }, /Injected parent context/],
]) {
  test(`entrypoint refuses ${label} before writes`, () => {
    const result = run(extra, fixture);
    refused(result, message);
    assert.deepEqual(writes(result), []);
  });
}

test('unsupported kind rejects before any native call', () => {
  for (const kind of ['fx', 'unknown']) {
    const result = spawnSync(process.execPath, ['--import', preload, script, '--kind', kind], {
      encoding: 'utf8', env: { ...process.env, WORKSPACE_PRESET_FIXTURE: '{}' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported kind/);
    assert.match(result.stderr, /MOCK_CALLS=\[\]/);
  }
});

for (const failure of [
  { verb: 'pane split', code: 'transport' }, { verb: 'pane split', invalidJSON: true },
  { verb: 'agent start', code: 'timeout' }, { verb: 'agent start', code: 'agent_not_ready' },
  { verb: 'agent start', code: 'agent_kind_not_found' }, { verb: 'agent start', invalidJSON: true },
]) {
  test(`partial failure ${JSON.stringify(failure)} never retries, prompts or closes`, () => {
    const result = run([], { failure });
    assert.equal(result.status, 1);
    assert.equal(result.error.cleanup, failure.verb === 'pane split' ? 'no_verified_created_pane' : 'retained');
    assert.equal(result.error.pane_id, failure.verb === 'pane split' ? null : 'wA7:pF9');
    assert.equal(verbs(result).filter(verb => verb === failure.verb).length, 1);
    assert.ok(!verbs(result).includes('pane close'));
    assert.ok(!verbs(result).includes('agent prompt'));
  });
}

for (const started of [{ agent_status: 'blocked' }, { agent_status: 'unknown' },
  { interactive_ready: false }, { interactive_ready: null }, { interactive_ready: 'true' },
  { interactive_ready: 1 }, { launch_pending: true }, { agent: 'fx' },
  { name: 'other' }, { tab_id: 'wA7:other' }, { cwd: 'C:\\wrong' }]) {
  test(`unproven readiness retains reviewer ${JSON.stringify(started)}`, () => {
    const result = run([], { started });
    refused(result, /does not prove/, 'retained');
    assert.deepEqual(writes(result).map(call => call.argv.slice(0, 2).join(' ')), ['pane split', 'agent start']);
  });
}

test('omitted readiness field cannot claim preset is ready', () => {
  const result = run([], { omitReadiness: true });
  refused(result, /does not prove/, 'retained');
  assert.deepEqual(writes(result).map(call => call.argv.slice(0, 2).join(' ')), ['pane split', 'agent start']);
});

test('minimum preflight geometry 121x12 remains read-only', () => {
  const result = run(['--dry-run'], { before: { panes: [
    { pane_id: 'wA7:pB2', rect: { x: 0, y: 0, width: 121, height: 12 } },
  ] } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(writes(result), []);
});

test('post-split topology failure cleans only verified owned shell', () => {
  const result = run([], { after: { panes: [
    { pane_id: 'wA7:pB2', rect: { x: 0, y: 0, width: 64, height: 37 } },
    { pane_id: 'wA7:pF9', rect: { x: 65, y: 0, width: 63, height: 37 } },
    { pane_id: 'wA7:other' },
  ] } });
  refused(result, /topology changed/, 'closed_created_shell');
  assert.deepEqual(writes(result).map(call => call.argv), [
    ['pane', 'split', '--pane', 'wA7:pB2', '--direction', 'right', '--cwd', cwd, '--no-focus'],
    ['pane', 'close', 'wA7:pF9'],
  ]);
});

for (const [label, fixture, cleanup] of [
  ['wrong child cwd', { child: { cwd: 'C:\\wrong' } }, 'closed_created_shell'],
  ['parent cwd changed', { laterParent: { cwd: 'C:\\changed' } }, 'closed_created_shell'],
  ['manager exited', { laterParent: { agent: null } }, 'closed_created_shell'],
  ['narrow post-split', { after: { panes: [
    { pane_id: 'wA7:pB2', rect: { x: 0, y: 0, width: 59, height: 37 } },
    { pane_id: 'wA7:pF9', rect: { x: 60, y: 0, width: 68, height: 37 } },
  ] } }, 'closed_created_shell'],
  ['focused child', { child: { focused: true } }, 'retained_unverified_or_cleanup_failed'],
  ['occupied child', { liveChild: { agent: 'codex' } }, 'retained_unverified_or_cleanup_failed'],
  ['foreign foreground job', { child: { cwd: 'C:\\wrong' }, processInfo: {
    pane_id: 'wA7:pF9', shell_pid: 4927, foreground_processes: [{ pid: 999, name: 'node.exe' }],
  } }, 'retained_unverified_or_cleanup_failed'],
]) {
  test(`partial setup ${label}: safe cleanup or retention`, () => {
    const result = run([], fixture);
    assert.equal(result.status, 1);
    assert.equal(result.error.cleanup, cleanup);
    assert.equal(verbs(result).includes('pane close'), cleanup === 'closed_created_shell');
    assert.ok(!verbs(result).includes('agent start'));
    assert.ok(!verbs(result).includes('agent prompt'));
  });
}

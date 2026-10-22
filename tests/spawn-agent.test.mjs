import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnAgent, parseArgs } from '../tools/spawn-agent.mjs';

const parent = { pane_id: 'wA7:pB2', terminal_id: 'term-parent-opaque', workspace_id: 'wA7',
  tab_id: 'wA7:tC3', cwd: 'D:\\Project with spaces\\exact', focused: true, agent: 'fx' };
const child = { ...parent, pane_id: 'wA7:pF9', terminal_id: 'term-child-opaque', focused: false, agent: null };
const env = { HERDR_ENV: '1', HERDR_BIN_PATH: 'C:\\Apps\\Herdr\\herdr.exe', HERDR_WORKSPACE_ID: parent.workspace_id,
  HERDR_TAB_ID: parent.tab_id, HERDR_PANE_ID: parent.pane_id, PWD: '/never/send/this/to/windows' };
const args = ['--kind', 'pi', '--name', 'reviewer'];
const rect = (x, width, height = 37) => ({ x, y: 0, width, height });
const before = { workspace_id: parent.workspace_id, tab_id: parent.tab_id, zoomed: false,
  focused_pane_id: parent.pane_id, panes: [{ pane_id: parent.pane_id, rect: rect(0, 128) }], splits: [] };
const after = { ...before, panes: [{ pane_id: parent.pane_id, rect: rect(0, 64) }, { pane_id: child.pane_id, rect: rect(65, 63) }] };
const ok = result => ({ status: 0, stdout: JSON.stringify({ id: 'mock-response', result }), stderr: '' });
const fail = (code = 'timeout') => ({ status: 1, stdout: '', stderr: JSON.stringify({ error: { code, message: 'mock failure' } }) });

function fixture(overrides = {}) {
  const calls = [];
  let split = false;
  let parentReads = 0;
  const deps = { env: { ...env, ...overrides.env }, platform: overrides.platform ?? 'linux', home: '/home/mock',
    read: overrides.read ?? (() => Buffer.from('Review only.\nNo approval bypass.')), spawn(command, argv, options) {
      calls.push({ command, argv, options });
      assert.equal(options.shell, false);
      assert.equal(options.env, deps.env);
      const verb = argv.slice(0, 2).join(' ');
      const custom = overrides.response?.(verb, argv, calls);
      if (custom) return custom;
      if (command === 'wslpath') return { status: 0, stdout: overrides.converted ?? `${parent.cwd}\n`, stderr: '' };
      if (argv[0] === '--version') return { status: 0, stdout: overrides.version ?? 'herdr 0.9.5\n', stderr: '' };
      if (argv[0] === 'status') return { status: 0, stdout: overrides.status ?? 'client:\n  version: 0.9.5\nserver:\n  version: 0.9.5\n  endpoint_compatible: yes\n  private_protocol_compatible: yes\n', stderr: '' };
      if (verb === 'pane get') {
        if (argv[2] === parent.pane_id) {
          parentReads++;
          return ok({ pane: parentReads > 1 ? (overrides.laterParent ?? overrides.parent ?? parent) : (overrides.parent ?? parent) });
        }
        assert.equal(argv[2], child.pane_id);
        return ok({ pane: overrides.liveChild ?? overrides.child ?? child });
      }
      if (verb === 'pane layout') return ok({ layout: split ? (overrides.after ?? after) : (overrides.before ?? before) });
      if (verb === 'agent list') return ok({ agents: overrides.agents ?? [] });
      if (verb === 'pane split') { split = true; return ok({ pane: overrides.child ?? child }); }
      if (verb === 'agent start') return ok({ agent: overrides.started ?? { ...child, name: 'reviewer', agent: 'pi', agent_status: 'idle', interactive_ready: true } });
      if (verb === 'agent prompt') return ok({ agent: { ...child, agent: 'pi', agent_status: 'idle' } });
      if (verb === 'pane process-info') return ok({ process_info: overrides.processInfo ?? { pane_id: child.pane_id, shell_pid: 4927, foreground_processes: [{ pid: 4927, name: 'powershell.exe' }] } });
      if (verb === 'pane close') return ok({ pane_id: child.pane_id });
      assert.fail(`Unexpected command ${command} ${argv}`);
    } };
  return { calls, deps, run: extra => spawnAgent([...args, ...(extra ?? [])], deps) };
}
const verbs = f => f.calls.map(c => c.argv.slice(0, 2).join(' '));
const mutation = f => f.calls.filter(c => /^(pane (split|close)|agent (start|prompt))$/.test(c.argv.slice(0, 2).join(' ')));

 test('actual subprocess help and out-of-Herdr refusal need no API/credentials', () => {
  const script = fileURLToPath(new URL('../tools/spawn-agent.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /fx intrinsic subagents remain in-process/);
  const outside = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, HERDR_ENV: '0' } });
  assert.equal(outside.status, 1);
  assert.match(JSON.parse(outside.stderr).error, /Not inside Herdr/);
});

test('dry-run uses actual JSON IDs, authoritative cwd and WSL bridge, with no mutations', () => {
  const f = fixture();
  const result = f.run(['--dry-run']);
  assert.equal(result.parent_pane_id, parent.pane_id);
  assert.equal(result.cwd, parent.cwd);
  assert.deepEqual(result.split_args, ['pane', 'split', '--pane', parent.pane_id, '--direction', 'right', '--cwd', parent.cwd, '--no-focus']);
  assert.equal(result.ready, false);
  assert.equal(result.prompt_submitted, false);
  assert.deepEqual(mutation(f), []);
  assert.ok(f.calls.every(c => c.command === '/home/mock/.local/bin/herdr'));
});

test('real plan starts only the returned new pane without creating tabs/workspaces/focus', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.pane_id, child.pane_id);
  assert.equal(result.ready, true);
  assert.equal(result.prompt_submitted, false);
  assert.deepEqual(mutation(f).map(c => c.argv), [
    ['pane', 'split', '--pane', parent.pane_id, '--direction', 'right', '--cwd', parent.cwd, '--no-focus'],
    ['agent', 'start', 'reviewer', '--kind', 'pi', '--pane', child.pane_id],
  ]);
});

for (const interactive_ready of [undefined, false, null, 'true', 1]) {
  test(`startup requires explicit boolean readiness: ${interactive_ready}`, () => {
    const f = fixture({ started: { ...child, name: 'reviewer', agent: 'pi', agent_status: 'idle', interactive_ready } });
    assert.throws(() => f.run(['--prompt-file', 'x']), error => {
      assert.match(error.message, /does not prove/);
      assert.equal(error.cleanup, 'retained');
      return true;
    });
    assert.equal(verbs(f).filter(v => v === 'agent start').length, 1);
    assert.ok(!verbs(f).includes('agent prompt') && !verbs(f).includes('pane close'));
  });
}

test('prompt-file preserves multiline Unicode/quotes/paths through agent prompt (CLI owns bracketing)', () => {
  const prompt = '--literal "quoted"\r\nReview C:\\A B\\file.ts; $x `not shell` Ω 😀\n';
  const f = fixture({ read: filename => { assert.equal(filename, '/local/prompt.md'); return Buffer.from(prompt); } });
  const result = f.run(['--prompt-file', '/local/prompt.md']);
  assert.equal(result.prompt_submitted, true);
  assert.equal(result.turn_activity_verified, false);
  assert.deepEqual(f.calls.at(-1).argv, ['agent', 'prompt', 'reviewer', prompt]);
  assert.ok(!verbs(f).some(v => /pane (run|send-)/.test(v)));
});

test('foreground Windows cwd is preferred over stale label cwd', () => {
  const actual = 'E:\\actual-parent';
  const f = fixture({ parent: { ...parent, foreground_cwd: actual } });
  assert.equal(f.run(['--dry-run']).cwd, actual);
});

test('Windows --cwd assertion retains exact API spelling and trailing slash', () => {
  const f = fixture({ parent: { ...parent, cwd: `${parent.cwd}\\` } });
  assert.equal(f.run(['--cwd', parent.cwd.toLowerCase(), '--dry-run']).cwd, `${parent.cwd}\\`);
});

test('WSL --cwd converted for assertion only, never sent raw to Windows', () => {
  const f = fixture();
  assert.equal(f.run(['--cwd', '/mnt/d/Project with spaces/exact', '--dry-run']).cwd, parent.cwd);
  assert.deepEqual(f.calls.find(c => c.command === 'wslpath').argv, ['-w', '/mnt/d/Project with spaces/exact']);
  assert.ok(f.calls.filter(c => c.command !== 'wslpath').every(c => !c.argv.includes('/mnt/d/Project with spaces/exact')));
});

test('UNC parent cwd accepted, native Windows execution uses injected binary', () => {
  const f = fixture({ platform: 'win32', parent: { ...parent, cwd: '\\\\server\\share\\folder' } });
  assert.equal(f.run(['--dry-run']).cwd, '\\\\server\\share\\folder');
  assert.ok(f.calls.every(c => c.command === env.HERDR_BIN_PATH));
});

for (const bad of [[], ['--kind', 'fx', '--name', 'reviewer'], ['--kind', 'unknown', '--name', 'reviewer'],
  ['--kind', 'pi', '--name', 'Bad Name'], [...args, '--kind', 'pi'], [...args, '--cwd'], [...args, '--direction', 'down'], [...args, '--', '-m', 'x']]) {
  test(`invalid arguments refuse before subprocess: ${JSON.stringify(bad)}`, () => {
    const f = fixture();
    assert.throws(() => spawnAgent(bad, f.deps));
    assert.equal(f.calls.length, 0);
  });
}

for (const [label, overrides, extra, message] of [
  ['outside', { env: { HERDR_ENV: '0' } }, [], /Not inside Herdr/],
  ['missing pane', { env: { HERDR_PANE_ID: '' } }, [], /HERDR_PANE_ID/],
  ['missing tab', { env: { HERDR_TAB_ID: '' } }, [], /HERDR_TAB_ID/],
  ['missing workspace', { env: { HERDR_WORKSPACE_ID: '' } }, [], /HERDR_WORKSPACE_ID/],
  ['wrong binary', { env: { HERDR_BIN_PATH: '/usr/bin/herdr' } }, [], /Windows Herdr binary/],
  ['old version', { version: 'herdr 0.9.3' }, [], /Only Herdr 0.9.5/],
  ['unverified version', { version: 'herdr 0.9.6' }, [], /Only Herdr 0.9.5/],
  ['preview version', { version: 'herdr 0.9.5-preview' }, [], /Only Herdr 0.9.5/],
  ['mixed server version', { status: 'client:\n  version: 0.9.5\nserver:\n  version: 0.9.3\n  endpoint_compatible: yes\n  private_protocol_compatible: yes\n' }, [], /running, compatible and version 0.9.5/],
  ['preview server version', { status: 'client:\n  version: 0.9.5\nserver:\n  version: 0.9.5-preview\n  endpoint_compatible: yes\n  private_protocol_compatible: yes\n' }, [], /running, compatible and version 0.9.5/],
  ['moved parent', { parent: { ...parent, tab_id: 'wA7:tMoved' } }, [], /Injected parent context/],
  ['missing cwd', { parent: { ...parent, cwd: null } }, [], /Windows cwd/],
  ['raw WSL API cwd', { parent: { ...parent, cwd: '/mnt/c/project' } }, [], /Windows cwd/],
  ['relative cwd assertion', {}, ['--cwd', 'relative'], /absolute Windows or WSL/],
  ['different cwd assertion', {}, ['--cwd', 'C:\\different'], /differs from the parent/],
  ['WSL conversion differs', { converted: 'C:\\other' }, ['--cwd', '/mnt/c/other'], /differs from the parent/],
  ['name taken', { agents: [{ name: 'reviewer' }] }, [], /already in use/],
  ['narrow repeated column', { before: { ...before, panes: [{ pane_id: parent.pane_id, rect: rect(0, 64) }] } }, [], /too narrow/],
  ['minimum width minus one', { before: { ...before, panes: [{ pane_id: parent.pane_id, rect: rect(0, 120) }] } }, [], /too narrow/],
  ['short row', { before: { ...before, panes: [{ pane_id: parent.pane_id, rect: rect(0, 128, 11) }] } }, [], /too narrow\/short/],
  ['zoomed', { before: { ...before, zoomed: true } }, [], /zoomed/],
  ['missing geometry', { before: { ...before, panes: [] } }, [], /geometry/],
  ['invalid prompt UTF8', { read: () => Buffer.from([0xff]) }, ['--prompt-file', 'x'], /encoded data/],
  ['empty prompt', { read: () => Buffer.from(' \n') }, ['--prompt-file', 'x'], /nonempty UTF-8/],
  ['paste-boundary injection', { read: () => Buffer.from('\x1b[201~') }, ['--prompt-file', 'x'], /control\/escape/],
  ['oversize prompt', { read: () => Buffer.from('x'.repeat(12001)) }, ['--prompt-file', 'x'], /12000/],
  ['unreadable prompt', { read: () => { throw new Error('ENOENT prompt'); } }, ['--prompt-file', 'x'], /ENOENT/],
]) {
  test(`preflight refuses ${label}, with no mutation`, () => {
    const f = fixture(overrides);
    assert.throws(() => f.run(extra), message);
    assert.deepEqual(mutation(f), []);
  });
}

test('minimum 121x12 preflight geometry accepted', () => {
  const f = fixture({ before: { ...before, panes: [{ pane_id: parent.pane_id, rect: rect(0, 121, 12) }] } });
  assert.equal(f.run(['--dry-run']).dry_run, true);
});

for (const code of ['timeout', 'agent_not_ready', 'agent_start_transport_failed', 'agent_pane_busy', 'agent_kind_not_found']) {
  test(`startup ${code} retains pane and never prompts, closes or retries`, () => {
    const f = fixture({ response: verb => verb === 'agent start' ? fail(code) : null });
    assert.throws(() => f.run(['--prompt-file', 'x']), error => {
      assert.equal(error.pane_id, child.pane_id);
      assert.equal(error.cleanup, 'retained');
      assert.equal(error.cliExitCode, 1);
      return true;
    });
    assert.equal(verbs(f).filter(v => v === 'agent start').length, 1);
    assert.ok(!verbs(f).includes('pane close') && !verbs(f).includes('agent prompt'));
  });
}

for (const started of [ { ...child, agent: 'fx', name: 'reviewer', agent_status: 'idle' },
  { ...child, agent: 'pi', name: 'reviewer', agent_status: 'blocked' },
  { ...child, agent: 'pi', name: 'reviewer', agent_status: 'unknown' },
  { ...child, agent: 'pi', name: 'reviewer', agent_status: 'idle', interactive_ready: false },
  { ...child, agent: 'pi', name: 'wrong', agent_status: 'idle' },
  { ...child, agent: 'pi', name: 'reviewer', agent_status: 'idle', terminal_id: 'different' },
]) {
  test(`reject fake readiness ${JSON.stringify(started)}`, () => {
    const f = fixture({ started });
    assert.throws(() => f.run(['--prompt-file', 'x']), /does not prove/);
    assert.ok(!verbs(f).includes('agent prompt') && !verbs(f).includes('pane close'));
  });
}

for (const [label, response] of [
  ['JSON lost at split', verb => verb === 'pane split' ? { status: 0, stdout: '{', stderr: '' } : null],
  ['split transport failure', verb => verb === 'pane split' ? fail('transport') : null],
  ['startup executable failure', verb => verb === 'agent start' ? { status: null, error: { code: 'ENOENT' }, stderr: '' } : null],
  ['JSON lost at start', verb => verb === 'agent start' ? { status: 0, stdout: '{', stderr: '' } : null],
  ['JSON lost at prompt', verb => verb === 'agent prompt' ? { status: 0, stdout: '{', stderr: '' } : null],
  ['prompt blocked', verb => verb === 'agent prompt' ? fail('agent_blocked') : null],
  ['prompt transport failure', verb => verb === 'agent prompt' ? fail('transport') : null],
]) {
  test(`${label}: ambiguous mutation retained, no retry/close`, () => {
    const f = fixture({ response });
    assert.throws(() => f.run(['--prompt-file', 'x']));
    assert.ok(!verbs(f).includes('pane close'));
    assert.ok(verbs(f).filter(v => v === 'agent prompt').length <= 1);
  });
}

for (const [label, overrides] of [
  ['wrong cwd', { child: { ...child, cwd: 'C:\\wrong' } }],
  ['parent cwd changed', { laterParent: { ...parent, cwd: 'C:\\changed' } }],
  ['wrong geometry', { after: { ...after, panes: [{ pane_id: parent.pane_id, rect: rect(0, 40) }, { pane_id: child.pane_id, rect: rect(41, 40) }] } }],
  ['focus changed elsewhere', { after: { ...after, focused_pane_id: 'wA7:pAnother' } }],
]) {
  test(`${label}: only positively-owned unfocused shell cleaned before startup`, () => {
    const f = fixture(overrides);
    assert.throws(() => f.run(), error => { assert.equal(error.cleanup, 'closed_created_shell'); return true; });
    assert.deepEqual(f.calls.at(-1).argv, ['pane', 'close', child.pane_id]);
    assert.ok(!verbs(f).includes('agent start'));
  });
}

for (const [label, overrides] of [
  ['focused child', { child: { ...child, focused: true } }],
  ['occupied child', { liveChild: { ...child, agent: 'codex' } }],
  ['moved child', { child: { ...child, tab_id: 'wA7:tElsewhere' } }],
  ['foreground job', { child: { ...child, cwd: 'C:\\wrong' }, processInfo: { pane_id: child.pane_id, shell_pid: 4927, foreground_processes: [{ pid: 991, name: 'node.exe' }] } }],
  ['missing process info', { child: { ...child, cwd: 'C:\\wrong' }, processInfo: {} }],
]) {
  test(`${label}: cannot prove cleanup safe, retain pane`, () => {
    const f = fixture(overrides);
    assert.throws(() => f.run());
    assert.ok(!verbs(f).includes('pane close') && !verbs(f).includes('agent start'));
  });
}

test('reused parent pane ID in split response must never be started or closed', () => {
  const f = fixture({ child: parent });
  assert.throws(() => f.run(), /verifiable new pane/);
  assert.ok(!verbs(f).includes('pane close') && !verbs(f).includes('agent start'));
});

test('cleanup failure reported as retained, never repeated', () => {
  const f = fixture({ child: { ...child, cwd: 'C:\\wrong' }, response: verb => verb === 'pane close' ? fail('transport') : null });
  assert.throws(() => f.run(), error => { assert.equal(error.cleanup, 'retained_unverified_or_cleanup_failed'); return true; });
  assert.equal(verbs(f).filter(v => v === 'pane close').length, 1);
});

test('CLI error and incompatible server detected before any mutation', () => {
  const f = fixture({ response: verb => verb === 'pane get' ? fail('pane_not_found') : null });
  assert.throws(() => f.run(), /pane_not_found/);
  assert.deepEqual(mutation(f), []);
  const g = fixture({ response: verb => verb === 'status' ? { status: 0, stdout: 'server: stopped', stderr: '' } : null });
  assert.throws(() => g.run(), /server must be running/);
  assert.deepEqual(mutation(g), []);
});

test('argument parser has no polling/service/remote/native-args surface', () => {
  assert.throws(() => parseArgs([...args, '--session', 'elsewhere']), /Unknown argument/);
  assert.throws(() => parseArgs([...args, '--wait']), /Unknown argument/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { managerBookmark, parseArgs, privateState } from '../tools/manager-bookmark.mjs';

const absolute = name => path.resolve(os.tmpdir(), name);
const endpoint = absolute('bookmark-synthetic.sock');
const binary = absolute(process.platform === 'win32' ? 'synthetic-herdr.exe' : 'synthetic-herdr');
const stateFile = absolute('synthetic-bookmark.json');
const pane = { pane_id: 'w1:p1', terminal_id: 'terminal_1', workspace_id: 'w1', tab_id: 'w1:t1', focused: false, revision: 1 };
const record = { version: 1, diagnostic_only: true, endpoint, server_identity: null, boot_identity: null,
  ...Object.fromEntries(['pane_id', 'terminal_id', 'workspace_id', 'tab_id'].map(key => [key, pane[key]])) };
function args(command = 'pin', extra = []) {
  return [command, '--herdr', binary, '--endpoint', endpoint,
    ...(command === 'pin' ? ['--pane', pane.pane_id] : ['--state', stateFile]), ...extra];
}
function fixture({ saved = record, target = pane, status = {}, transform = value => value } = {}) {
  const calls = [], writes = [];
  return { calls, writes, dependencies: {
    env: { HERDR_ENV: '1', HERDR_PANE_ID: 'wrong', herdr_socket_path: 'wrong', HERDR_CLIENT_SOCKET_PATH: 'wrong', HERDR_SESSION: 'wrong' },
    state: () => ({ read: () => saved, create: value => writes.push(value) }),
    spawn: (command, argv, options) => {
      calls.push(argv);
      assert.equal(command, binary);
      assert.equal(options.shell, false);
      assert.equal(options.env.HERDR_SOCKET_PATH, endpoint);
      assert.deepEqual(Object.keys(options.env).filter(key => /^herdr_/i.test(key)), ['HERDR_SOCKET_PATH']);
      let output;
      if (argv[0] === '--version') output = 'herdr 0.9.5';
      else if (argv.join(' ') === 'status server --json') output = JSON.stringify({ status: 'running', running: true, version: '0.9.5', compatible: true, endpoint_compatible: true, socket: endpoint, ...status });
      else {
        assert.deepEqual(argv, ['pane', 'get', pane.pane_id]);
        output = JSON.stringify({ id: 'cli:pane:get', result: { type: 'pane_info', pane: target } });
      }
      return transform({ status: 0, stdout: output }, argv);
    },
  } };
}

test('explicit pin only observes chosen pane; no default writes or focus', () => {
  const f = fixture();
  const result = managerBookmark(args(), f.dependencies);
  assert.deepEqual(result.bookmark, record);
  assert.equal(result.state_written, false);
  assert.equal(result.focus_sent, false);
  assert.equal(result.identity_verified, false);
  assert.equal(result.return_status, 'BLOCKED');
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.calls, [['--version'], ['status', 'server', '--json'], ['pane', 'get', pane.pane_id]]);
});

test('state writing requires explicit pin --state; saves IDs only', () => {
  const f = fixture({ target: { ...pane, cwd: 'secret', label: 'manager', agent: 'codex', title: 'secret' } });
  assert.equal(managerBookmark(args('pin', ['--state', stateFile]), f.dependencies).state_written, true);
  assert.deepEqual(f.writes, [record]);
});

for (const command of ['inspect', 'return']) {
  test(`${command} never focuses, even with matching IDs and apparent healthy target`, () => {
    const f = fixture();
    const result = managerBookmark(args(command), f.dependencies);
    assert.equal(result.observed_ids_match, true);
    assert.equal(result.identity_verified, false);
    assert.equal(result.return_status, 'BLOCKED');
    assert.equal(result.focus_sent, false);
    assert.deepEqual(f.writes, []);
  });
}

test('endpoint collision rejected before native queries', () => {
  const f = fixture({ saved: { ...record, endpoint: absolute('other.sock') } });
  assert.throws(() => managerBookmark(args('return'), f.dependencies), /Endpoint differs/);
  assert.deepEqual(f.calls, []);
});

for (const key of ['pane_id', 'terminal_id', 'workspace_id', 'tab_id']) {
  test(`replacement/move changes ${key}; zero focus`, () => {
    const f = fixture({ target: { ...pane, [key]: 'replacement' } });
    assert.throws(() => managerBookmark(args('return'), f.dependencies), /changed|replaced/);
    assert.equal(f.calls.length, 3);
  });
}

test('restart or endpoint replacement reusing every ID remains blocked', () => {
  for (const boot_id of ['old-boot', 'new-boot']) {
    const f = fixture({ status: { boot_id, server_id: 'claimed' }, target: { ...pane, boot_id } });
    const result = managerBookmark(args('return'), f.dependencies);
    assert.equal(result.bookmark.boot_identity, null);
    assert.equal(result.identity_verified, false);
    assert.equal(result.focus_sent, false);
  }
});

test('stale/forged/malformed state cannot enable focus', () => {
  for (const saved of [null, {}, [], { ...record, version: 2 }, { ...record, diagnostic_only: false },
    { ...record, boot_identity: 'invented' }, { ...record, server_identity: 'invented' },
    { ...record, pane_id: '--current' }, { ...record, focus_allowed: true }]) {
    const f = fixture({ saved });
    assert.throws(() => managerBookmark(args('return'), f.dependencies));
    assert.ok(f.calls.every(argv => !argv.includes('focus')));
  }
});

test('closed/unavailable/wrong endpoint and malformed server responses fail closed', () => {
  for (const status of [{ running: false }, { status: 'not_running' }, { version: '0.9.6' },
    { compatible: null }, { endpoint_compatible: false }, { socket: absolute('other.sock') }]) {
    const f = fixture({ status });
    assert.throws(() => managerBookmark(args('return'), f.dependencies), /Server unavailable/);
    assert.equal(f.calls.length, 2);
  }
});

test('missing or malformed pane fields fail closed', () => {
  for (const target of [null, {}, { ...pane, terminal_id: null }, { ...pane, revision: -1 },
    { ...pane, focused: undefined }, { ...pane, restore_error: 'closed' }]) {
    const f = fixture({ target });
    assert.throws(() => managerBookmark(args('pin', ['--state', stateFile]), f.dependencies), /No valid observed target/);
    assert.deepEqual(f.writes, []);
  }
});

test('native errors, malformed envelopes and timeouts never write or focus', () => {
  for (const response of [{ error: { code: 'ETIMEDOUT' }, status: null }, { status: 1 }, { status: 0, signal: 'SIGTERM' },
    { status: 0, stdout: 'not-json' }, { status: 0, stdout: 'null' }, { status: 0, stdout: '[]' },
    { status: 0, stdout: '{"error":null}' }, { status: 0, stdout: '{"id":"wrong","result":{"type":"pane_info"}}' }]) {
    const f = fixture({ transform: (value, argv) => argv[0] === 'pane' ? response : value });
    assert.throws(() => managerBookmark(args('pin', ['--state', stateFile]), f.dependencies));
    assert.deepEqual(f.writes, []);
  }
});

test('unknown CLI version refused', () => {
  const f = fixture({ transform: (value, argv) => argv[0] === '--version' ? { status: 0, stdout: 'herdr 0.9.6' } : value });
  assert.throws(() => managerBookmark(args(), f.dependencies), /Only inspected/);
  assert.equal(f.calls.length, 1);
});

test('help and invalid options do not invoke native calls', () => {
  const f = fixture();
  assert.match(managerBookmark(['--help'], f.dependencies).help, /BLOCKED/);
  for (const argv of [[], ['pin'], args('pin', ['--pane', 'other']), args('pin', ['--force']),
    args('return', ['--pane', 'w1:p1']), ['pin', '--herdr', binary, '--endpoint', endpoint],
    ['pin', '--herdr', binary, '--endpoint', 'relative', '--pane', 'w1:p1']]) {
    assert.throws(() => managerBookmark(argv, f.dependencies));
  }
  assert.deepEqual(f.calls, []);
  assert.throws(() => parseArgs(['pin', '--herdr', binary, '--endpoint', endpoint, '--pane', 'manager name']), /explicit pane ID/);
});

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-bookmark-test-'));
  if (process.platform === 'win32') {
    const result = spawnSync(path.win32.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:BOOKMARK_TEST_DIRECTORY -AclObject $acl"],
      { env: { ...process.env, BOOKMARK_TEST_DIRECTORY: dir }, encoding: 'utf8', shell: false, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  } else fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('private native state roundtrip, exclusive create, no overwrite', t => {
  const dir = directory(t), file = path.join(dir, 'bookmark.json');
  const store = privateState(file);
  store.create(record);
  assert.deepEqual(store.read(), record);
  const original = fs.readFileSync(file);
  assert.throws(() => store.create({ replacement: true }), /EEXIST/);
  assert.deepEqual(fs.readFileSync(file), original);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('unsafe parent permissions fail before creating state', t => {
  const dir = directory(t), file = path.join(dir, 'bookmark.json');
  if (process.platform === 'win32') {
    // Windows test environment denies constructing a permissive ACL fixture.
    assert.throws(() => privateState(file, { spawn: () => ({ status: 1, stdout: '' }) }).create(record), /private ACL/);
  } else {
    fs.chmodSync(dir, 0o755);
    assert.throws(() => privateState(file).create(record), /private permissions/);
  }
  assert.equal(fs.existsSync(file), false);
});

test('hardlinks, directory targets, oversized and invalid UTF-8 state rejected', t => {
  const dir = directory(t), file = path.join(dir, 'bookmark.json');
  privateState(file).create(record);
  fs.linkSync(file, path.join(dir, 'alias.json'));
  assert.throws(() => privateState(file).read(), /one link/);
  fs.unlinkSync(path.join(dir, 'alias.json'));
  fs.writeFileSync(file, Buffer.alloc(16385));
  assert.throws(() => privateState(file).read(), /small regular/);
  fs.writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => privateState(file).read(), /encoded data/);
  assert.throws(() => privateState(dir).create(record));
});

test('symlink/junction ancestor rejected before create or read', t => {
  const dir = directory(t), real = path.join(dir, 'real'), link = path.join(dir, 'link');
  fs.mkdirSync(real, { mode: 0o700 });
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  const store = privateState(path.join(link, 'bookmark.json'));
  assert.throws(() => store.create(record), /symlinks\/junctions/);
  assert.throws(() => store.read(), /symlinks\/junctions/);
  assert.equal(fs.existsSync(path.join(real, 'bookmark.json')), false);
});

test('existing symlink target is never overwritten', t => {
  const dir = directory(t), real = path.join(dir, 'real'), link = path.join(dir, 'link');
  fs.mkdirSync(real, { mode: 0o700 });
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => privateState(link).create(record), /EEXIST/);
  assert.throws(() => privateState(link).read(), /symlinks\/junctions/);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});

test('state file replacement between lstat and open is rejected', t => {
  const dir = directory(t), file = path.join(dir, 'bookmark.json');
  privateState(file).create(record);
  const io = { ...fs, fstatSync(fd, options) {
    assert.equal(options.bigint, true);
    const stat = fs.fstatSync(fd, options);
    return { ...stat, ino: stat.ino + 1n, isFile: () => true };
  } };
  assert.throws(() => privateState(file, { io }).read(), /changed during open/);
});

test('failed write closes descriptor, retains exclusive file, never retries', t => {
  const dir = directory(t), file = path.join(dir, 'bookmark.json');
  let closed = 0;
  const io = { ...fs, writeFileSync() { throw new Error('synthetic disk failure'); },
    closeSync(fd) { closed++; return fs.closeSync(fd); } };
  assert.throws(() => privateState(file, { io }).create(record), /synthetic disk failure/);
  assert.equal(closed, 1);
  assert.equal(fs.statSync(file).size, 0);
  assert.throws(() => privateState(file).create(record), /EEXIST/);
});

test('Windows ACL check fails closed on timeout, malformed output or missing trusted shell path', { skip: process.platform !== 'win32' }, t => {
  const dir = directory(t), file = path.join(dir, 'bookmark.json');
  for (const result of [{ status: 0, stdout: 'not-private' }, { status: null, error: { code: 'ETIMEDOUT' } },
    { status: 0, stdout: 'private', signal: 'SIGTERM' }]) {
    assert.throws(() => privateState(file, { spawn: () => result }).create(record), /private ACL/);
    assert.equal(fs.existsSync(file), false);
  }
  assert.throws(() => privateState(file, { env: {} }).create(record), /trusted Windows PowerShell/);
});

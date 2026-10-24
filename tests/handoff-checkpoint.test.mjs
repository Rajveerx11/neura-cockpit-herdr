import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handoffCheckpoint } from '../tools/handoff-checkpoint.mjs';

const cli = fileURLToPath(new URL('../tools/handoff-checkpoint.mjs', import.meta.url));
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', shell: false, windowsHide: true, ...options });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

function protect(directory) {
  if (process.platform !== 'win32') { chmodSync(directory, 0o700); return; }
  command(powershell, ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $env:TEST_PRIVATE_DIRECTORY -AclObject $acl
  `], { env: { ...process.env, TEST_PRIVATE_DIRECTORY: directory } });
}

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'handoff-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'project space 世界');
  const privateDir = path.join(directory, 'private');
  mkdirSync(project);
  mkdirSync(privateDir, { mode: 0o700 });
  protect(privateDir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
  const git = (...args) => command('git', ['-c', 'core.hooksPath=', ...args], { cwd: project, env });
  git('init', '--quiet', '--initial-branch=checkpoint-test');
  writeFileSync(path.join(project, 'tracked space 世界.txt'), 'original secret body\n');
  git('add', '--all');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'synthetic');
  const output = path.join(privateDir, 'checkpoint.md');
  const args = ['--project', project, '--workspace', 'w-selected', '--pane', 'p-selected', '--private-output', output, '--next-step', 'Review selected work'];
  return { directory, project, privateDir, output, args, git };
}

function nativeArgs(f) {
  return [...f.args, '--herdr', process.execPath, '--endpoint-socket', path.join(f.directory, 'explicit.sock')];
}

function mockNative(f, change = x => x) {
  const calls = [];
  function spawn(binary, args, options) {
    if (binary !== process.execPath) return spawnSync(binary, args, options);
    calls.push({ args, options });
    const reply = args[0] === '--version' ? 'herdr 0.9.5\n' : JSON.stringify({ result: args[0] === 'workspace'
      ? { workspace: { workspace_id: 'w-selected', label: 'SECRET_NATIVE_LABEL' } }
      : { pane: { pane_id: args[2], workspace_id: 'w-selected', cwd: f.project, title: 'SECRET_TRANSCRIPT', tokens: { secret: 'SECRET_AUTH' }, agent_session: { prompt: 'SECRET_PROMPT' }, agent_status: 'done' } } });
    return change({ status: 0, stdout: Buffer.from(reply) }, args);
  }
  return { spawn, calls };
}

test('manual snapshot: actual HEAD, branch and dirty/untracked names only; private exclusive output', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.project, 'tracked space 世界.txt'), 'SECRET_DIFF_BODY\n');
  writeFileSync(path.join(f.project, 'untracked 世界 file.txt'), 'SECRET_UNTRACKED_BODY');
  const result = handoffCheckpoint(f.args, { now: () => new Date('2026-10-24T00:00:00Z') });
  const text = readFileSync(f.output, 'utf8');
  assert.equal(result.paths, 2);
  assert.equal(result.nativeVerified, false);
  assert.match(text, /2026-10-24T00:00:00.000Z/);
  assert.ok(text.includes(f.git('rev-parse', 'HEAD').trim()));
  assert.match(text, /checkpoint-test/);
  assert.match(text, /tracked space 世界.txt/);
  assert.match(text, /untracked 世界 file.txt/);
  assert.match(text, /unavailable: no explicit endpoint/);
  assert.doesNotMatch(text, /SECRET_|original secret body/);
  if (process.platform !== 'win32') assert.equal(lstatSync(f.output).mode & 0o777, 0o600);
  else {
    const principals = command(powershell, ['-NoProfile', '-NonInteractive', '-Command', `
      $acl = Get-Acl -LiteralPath $env:TEST_PRIVATE_FILE
      $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid) { throw 'unexpected file access' }
      }
      'private'
    `], { env: { ...process.env, TEST_PRIVATE_FILE: f.output } });
    assert.match(principals, /private/);
  }
  assert.throws(() => handoffCheckpoint(f.args), /already exists/);
  assert.equal(readFileSync(f.output, 'utf8'), text);
});

test('detached HEAD and clean repository are represented honestly', t => {
  const f = fixture(t);
  f.git('checkout', '--detach', '--quiet');
  handoffCheckpoint(f.args);
  const text = readFileSync(f.output, 'utf8');
  assert.match(text, /detached HEAD/);
  assert.match(text, /none observed/);
});

test('renames report both path names without diff content', t => {
  const f = fixture(t);
  f.git('mv', 'tracked space 世界.txt', 'renamed 世界.txt');
  assert.equal(handoffCheckpoint(f.args).paths, 2);
  const text = readFileSync(f.output, 'utf8');
  assert.match(text, /tracked space 世界.txt/);
  assert.match(text, /renamed 世界.txt/);
  assert.doesNotMatch(text, /original secret body/);
});

test('control characters and Markdown structure are rendered as inert JSON data', t => {
  const f = fixture(t);
  const filename = 'odd\n# title\t\x1b[31m 世界\u202e.txt';
  const spawn = (binary, args, options) => args.includes('--porcelain=v1')
    ? { status: 0, stdout: Buffer.from(` M tracked space 世界.txt\0?? ${filename}\0`) }
    : spawnSync(binary, args, options);
  f.args[f.args.length - 1] = '\n# injected\n```\n<script>bad</script>\x1b[2J\u009b\u202e';
  handoffCheckpoint(f.args, { spawn });
  const text = readFileSync(f.output, 'utf8');
  assert.ok(text.includes('odd\\n# title\\t\\u001b[31m 世界\\u202e.txt'));
  assert.doesNotMatch(text, /[\x1b\u009b\u202e]/);
  assert.doesNotMatch(text, /^# injected|^```|^<script>/m);
});

test('native Linux filenames containing controls survive actual Git -z parsing', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  writeFileSync(path.join(f.project, 'untracked\n\t\x1b 世界'), 'secret');
  handoffCheckpoint(f.args);
  assert.match(readFileSync(f.output, 'utf8'), /untracked\\n\\t\\u001b 世界/);
});

test('only selected native reads, explicit endpoint, matching project; native extra fields discarded', t => {
  const f = fixture(t);
  const mock = mockNative(f);
  const result = handoffCheckpoint([...nativeArgs(f), '--pane', 'p-second'], { spawn: mock.spawn });
  assert.equal(result.nativeVerified, true);
  assert.deepEqual(mock.calls.map(call => call.args), [['--version'], ['workspace', 'get', 'w-selected'], ['pane', 'get', 'p-selected'], ['pane', 'get', 'p-second']]);
  for (const { options } of mock.calls) {
    assert.equal(options.env.HERDR_SOCKET_PATH, path.join(f.directory, 'explicit.sock'));
    assert.equal(options.shell, false);
    assert.deepEqual(Object.keys(options.env).filter(key => key.startsWith('HERDR_')), ['HERDR_SOCKET_PATH']);
  }
  const text = readFileSync(f.output, 'utf8');
  assert.match(text, /Authoritative selected IDs/);
  assert.doesNotMatch(text, /SECRET_|agent_status|"done"|explicit.sock/);
});

test('native failures, mismatches, and incompatible paths fail closed without leaking error text', t => {
  const f = fixture(t);
  const cases = [
    () => ({ status: 1, stderr: 'SECRET_ERROR' }),
    () => ({ status: 0, stdout: Buffer.from('not JSON SECRET_RESPONSE') }),
    (result, args) => args[0] === '--version' ? { ...result, stdout: Buffer.from('herdr 99.0.0') } : result,
    (result, args) => args[0] === 'workspace' ? { ...result, stdout: Buffer.from('{"result":{"workspace":{"workspace_id":"other"}}}') } : result,
    (result, args) => args[0] === 'pane' ? { ...result, stdout: Buffer.from(JSON.stringify({ result: { pane: { pane_id: args[2], workspace_id: 'other', cwd: f.project } } })) } : result,
    (result, args) => args[0] === 'pane' ? { ...result, stdout: Buffer.from(JSON.stringify({ result: { pane: { pane_id: args[2], workspace_id: 'w-selected', cwd: process.platform === 'win32' ? '/home/remote' : 'C:\\remote' } } })) } : result,
  ];
  cases.forEach((change, index) => {
    const args = nativeArgs(f);
    args[args.indexOf('--private-output') + 1] = path.join(f.privateDir, `unavailable-${index}.md`);
    const result = handoffCheckpoint(args, { spawn: mockNative(f, change).spawn });
    assert.equal(result.nativeVerified, false);
    const text = readFileSync(result.output, 'utf8');
    assert.match(text, /unavailable: endpoint query/);
    assert.doesNotMatch(text, /Authoritative selected IDs|SECRET_|C:\\\\remote|\/home\/remote/);
  });
});

test('Git failures and malformed path inventories never create output', t => {
  const f = fixture(t);
  for (const reply of [{ status: 1, stderr: 'SECRET_ERROR' }, { status: 0, stdout: Buffer.from('?? unterminated') }, { status: 0, stdout: Buffer.from([0xff, 0]) }]) {
    const spawn = (binary, args, options) => args.includes('--porcelain=v1') ? reply : spawnSync(binary, args, options);
    assert.throws(() => handoffCheckpoint(f.args, { spawn }));
    assert.equal(existsSync(f.output), false);
  }
});

test('Git requests are read-only, bounded, isolated from inherited repository routing', t => {
  const f = fixture(t);
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(f.directory, 'wrong-repository');
  t.after(() => { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous; });
  const calls = [];
  const spawn = (binary, args, options) => {
    if (binary === 'git') calls.push({ args, options });
    return spawnSync(binary, args, options);
  };
  handoffCheckpoint(f.args, { spawn });
  assert.equal(calls.length, 6);
  for (const { args, options } of calls) {
    assert.ok(['rev-parse', 'symbolic-ref', 'status'].includes(args[5]));
    assert.ok(args.includes('--no-optional-locks'));
    assert.ok(args.includes('core.fsmonitor=false'));
    assert.equal(options.env.GIT_DIR, undefined);
    assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 10000);
    assert.equal(options.cwd, f.project);
  }
});

test('HEAD movement is explicitly stale', t => {
  const f = fixture(t);
  let reads = 0;
  const spawn = (binary, args, options) => args.includes('--verify') && ++reads === 2
    ? { status: 0, stdout: Buffer.from(`${'a'.repeat(40)}\n`) } : spawnSync(binary, args, options);
  assert.equal(handoffCheckpoint(f.args, { spawn }).stale, true);
  assert.match(readFileSync(f.output, 'utf8'), /stale: HEAD or branch changed/);
});

test('refuses repository, public, missing-parent, relative, non-Markdown and other-repository output', t => {
  const f = fixture(t);
  const publicDir = path.join(f.directory, 'public');
  const other = path.join(f.directory, 'other-repo');
  const bare = path.join(f.directory, 'bare-repo');
  mkdirSync(publicDir); mkdirSync(other); mkdirSync(path.join(other, '.git'));
  mkdirSync(bare); mkdirSync(path.join(bare, 'objects')); mkdirSync(path.join(bare, 'refs')); writeFileSync(path.join(bare, 'HEAD'), 'ref: refs/heads/main');
  for (const output of [path.join(f.project, 'no.md'), path.join(publicDir, 'no.md'), path.join(other, 'no.md'), path.join(bare, 'no.md'), path.join(f.directory, 'missing', 'no.md'), 'relative.md', path.join(f.privateDir, 'no.txt')]) {
    const args = [...f.args];
    args[args.indexOf('--private-output') + 1] = output;
    assert.throws(() => handoffCheckpoint(args));
    assert.equal(existsSync(output), false);
  }
});

test('refuses shared output directory permissions', t => {
  const f = fixture(t);
  if (process.platform === 'win32') {
    command(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [f.privateDir, '/grant', '*S-1-1-0:(R)']);
  } else chmodSync(f.privateDir, 0o755);
  assert.throws(() => handoffCheckpoint(f.args), /private|permissions/);
  assert.equal(existsSync(f.output), false);
});

test('refuses linked/junction parent and linked existing output', t => {
  const f = fixture(t);
  const alias = path.join(f.directory, 'alias');
  symlinkSync(f.privateDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const args = [...f.args];
  args[args.indexOf('--private-output') + 1] = path.join(alias, 'no.md');
  assert.throws(() => handoffCheckpoint(args), /Linked|redirected/);
  symlinkSync(f.privateDir, f.output, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => handoffCheckpoint(f.args), /already exists/);
  assert.deepEqual(readdirSync(f.privateDir), ['checkpoint.md']);
});

test('file created by another writer after preflight remains untouched', t => {
  const f = fixture(t);
  let raced = false;
  const spawn = (binary, args, options) => {
    const result = spawnSync(binary, args, options);
    if (args.includes('--porcelain=v1') && !raced) { writeFileSync(f.output, 'OTHER_WRITER'); raced = true; }
    return result;
  };
  assert.throws(() => handoffCheckpoint(f.args, { spawn }), /EEXIST/);
  assert.equal(readFileSync(f.output, 'utf8'), 'OTHER_WRITER');
});

test('unexpected parent replacement between reads and write is refused', t => {
  const f = fixture(t);
  const moved = path.join(f.directory, 'original-private');
  const spawn = (binary, args, options) => {
    const result = spawnSync(binary, args, options);
    if (args.includes('--porcelain=v1')) {
      renameSync(f.privateDir, moved);
      mkdirSync(f.privateDir, { mode: 0o700 });
    }
    return result;
  };
  assert.throws(() => handoffCheckpoint(f.args, { spawn }), /Output parent changed/);
  assert.deepEqual(readdirSync(moved), []);
  assert.deepEqual(readdirSync(f.privateDir), []);
});

for (const field of ['dev', 'ino']) {
  for (const stage of ['before open', 'after open']) {
    test(`directory ${field} precision detects replacement ${stage}`, t => {
      const f = fixture(t);
      const originalStat = fs.lstatSync;
      const originalOpen = fs.openSync;
      const first = 2n ** 53n;
      const second = first + 1n;
      assert.equal(Number(first), Number(second), 'Regression requires a Number precision collision.');
      let replaced = false;
      const statMock = t.mock.method(fs, 'lstatSync', (file, options) => {
        const stat = originalStat(file, options);
        if (file === f.privateDir) {
          const id = replaced ? second : first;
          stat[field] = options?.bigint ? id : Number(id);
        }
        return stat;
      });
      const openMock = t.mock.method(fs, 'openSync', (...args) => {
        const descriptor = originalOpen(...args);
        if (args[0] === f.output && stage === 'after open') replaced = true;
        return descriptor;
      });
      syncBuiltinESMExports();
      try {
        const spawn = (binary, args, options) => {
          const result = spawnSync(binary, args, options);
          if (args.includes('--porcelain=v1') && stage === 'before open') replaced = true;
          return result;
        };
        assert.throws(() => handoffCheckpoint(f.args, { spawn }), /Output parent changed/);
        if (stage === 'before open') assert.equal(existsSync(f.output), false);
        else assert.equal(readFileSync(f.output, 'utf8'), '');
      } finally {
        statMock.mock.restore();
        openMock.mock.restore();
        syncBuiltinESMExports();
      }
    });
  }
}

test('bigint descriptor link count still refuses multiply linked output', t => {
  const f = fixture(t);
  const originalStat = fs.fstatSync;
  const statMock = t.mock.method(fs, 'fstatSync', (descriptor, options) => {
    assert.equal(options?.bigint, true);
    const stat = originalStat(descriptor, options);
    stat.nlink = 2n;
    return stat;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => handoffCheckpoint(f.args), /Unsafe output file/);
    assert.equal(readFileSync(f.output, 'utf8'), '');
  } finally {
    statMock.mock.restore();
    syncBuiltinESMExports();
  }
});

test('refuses device, UNC, WSL-drive, and traversal output paths', t => {
  const f = fixture(t);
  const paths = process.platform === 'win32'
    ? ['C:\\private\\NUL.md', '\\\\server\\share\\new.md', 'C:\\private\\new.md:stream', 'C:\\private\\..\\new.md']
    : ['/mnt/c/private/new.md', '//server/share/new.md', '/private/../new.md', 'C:\\private\\new.md'];
  for (const output of paths) {
    const args = [...f.args];
    args[args.indexOf('--private-output') + 1] = output;
    assert.throws(() => handoffCheckpoint(args));
  }
});

test('requires explicit selections, disallows duplicate panes and incomplete endpoint options', () => {
  for (const args of [[], ['--help', 'extra'], ['--unknown', 'value'], ['--project', 'relative']]) {
    assert.throws(() => handoffCheckpoint(args));
  }
  const minimal = ['--project', '/explicit', '--workspace', 'w', '--pane', 'p', '--private-output', '/private/new.md', '--next-step', 'Review'];
  for (const extra of [['--pane', 'p'], ['--herdr', '/herdr'], ['--workspace', 'other'], ['--pane', '--all']]) {
    assert.throws(() => handoffCheckpoint([...minimal, ...extra]));
  }
});

test('CLI help is side-effect free; errors never echo untrusted arguments', () => {
  assert.match(command(process.execPath, [cli, '--help']), /Manual snapshot only/);
  const result = spawnSync(process.execPath, [cli, '--SECRET_\x1b[2J', 'value'], { encoding: 'utf8', shell: false });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /SECRET_|\x1b/);
});

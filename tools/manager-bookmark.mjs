#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BLOCKED = 'BLOCKED: Herdr 0.9.5 public CLI/API does not establish server/boot identity or a displayed-client, identity-conditional focus target.';
export const HELP = `Usage: node manager-bookmark.mjs pin --herdr ABSOLUTE_BINARY --endpoint LOCAL_SOCKET --pane ID [--state ABSOLUTE_FILE]
       node manager-bookmark.mjs inspect|return --herdr ABSOLUTE_BINARY --endpoint LOCAL_SOCKET --state ABSOLUTE_FILE
Pin records diagnostic IDs only. Without --state, pin writes nothing.
State requires an existing private directory; creation is exclusive, never overwrite.
Return is BLOCKED, including when all observed IDs match. No focus/input is sent.
Endpoint selects the CLI transport, not the displayed UI client. Local sockets only.
No manager inference, default state path, bindings, polling, config edits or remote access.
`;
const IDS = ['pane_id', 'terminal_id', 'workspace_id', 'tab_id'];
function check(ok, message) { if (!ok) throw new Error(message); }
function text(value) { return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value); }
function localPath(value) {
  check(text(value) && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/.test(value), 'Use an absolute local path.');
  check(process.platform !== 'win32' || (/^[a-z]:[\\/]/i.test(value) && !value.slice(2).includes(':')), 'Use a local drive path without alternate streams.');
  return path.normalize(value);
}
function endpoint(value) {
  // Windows local named pipes are transport addresses, never state-file paths.
  if (process.platform === 'win32' && /^\\\\\.\\pipe\\[a-zA-Z0-9_.-]+$/.test(value)) return value;
  return localPath(value);
}
function id(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(value); }

export function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  const [command, ...flags] = argv;
  check(['pin', 'inspect', 'return'].includes(command), 'Choose pin, inspect or return; use --help.');
  const options = { command };
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    check(['--herdr', '--endpoint', '--pane', '--state'].includes(flag), `Unknown argument: ${flag}`);
    check(!Object.hasOwn(options, flag), `Duplicate argument: ${flag}`);
    check(text(flags[i + 1]) && !flags[i + 1].startsWith('--'), `Missing value: ${flag}`);
    options[flag] = flags[i + 1];
  }
  options['--herdr'] = localPath(options['--herdr']);
  options['--endpoint'] = endpoint(options['--endpoint']);
  if (options['--state']) options['--state'] = localPath(options['--state']);
  if (command === 'pin') check(id(options['--pane']), 'Pin requires an explicit pane ID.');
  else check(options['--state'] && !options['--pane'], 'Inspect/return require --state and reject --pane.');
  return options;
}

// Read ACLs only. A private parent makes inherited ACLs private at file creation.
const ACL_CHECK = `$ErrorActionPreference = 'Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl = Get-Acl -LiteralPath $env:MANAGER_BOOKMARK_ACL_PATH
if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { exit 1 }
$descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
if ($null -eq $descriptor.DiscretionaryAcl) { exit 1 }
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')
foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { exit 1 }
}
Write-Output 'private'
`;

export function privateState(file, { io = fs, platform = process.platform, uid = process.getuid?.(), spawn = spawnSync, env = process.env } = {}) {
  file = localPath(file);
  const parent = path.dirname(file);
  function noLinks(target) {
    for (let current = target; ; current = path.dirname(current)) {
      const stat = io.lstatSync(current);
      check(!stat.isSymbolicLink(), 'State path must not traverse symlinks/junctions.');
      if (current !== file) check(stat.isDirectory(), 'State parent must be a directory.');
      if (current === path.dirname(current)) break;
    }
  }
  function privateAccess(target, stat) {
    if (platform === 'win32') {
      check(env.SystemRoot && /^[a-z]:\\Windows$/i.test(env.SystemRoot), 'Cannot locate trusted Windows PowerShell for ACL verification.');
      const result = spawn(path.win32.join(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ACL_CHECK],
        { shell: false, encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
          env: { ...env, MANAGER_BOOKMARK_ACL_PATH: target } });
      check(!result.error && !result.signal && result.status === 0 && result.stdout.trim() === 'private', 'State requires a user-owned private ACL (user, SYSTEM, Administrators only).');
    } else {
      check(Number.isInteger(uid) && stat.uid === BigInt(uid) && (stat.mode & 0o077n) === 0n, 'State requires user ownership and private permissions (directory 0700/file 0600).');
    }
  }
  function parentCheck() {
    noLinks(parent);
    privateAccess(parent, io.lstatSync(parent, { bigint: true }));
  }
  return {
    create(record) {
      parentCheck();
      const fd = io.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        const stat = io.fstatSync(fd, { bigint: true });
        check(stat.isFile() && stat.nlink === 1n, 'State must be a regular unlinked-to-others file.');
        privateAccess(file, stat);
        io.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        io.fsyncSync(fd);
      } finally { io.closeSync(fd); }
      // On failure retain the exclusive file; never unlink a potentially replaced path.
    },
    read() {
      parentCheck();
      noLinks(file);
      const before = io.lstatSync(file, { bigint: true });
      check(before.isFile() && before.nlink === 1n && before.size <= 16384n, 'State must be a small regular file with one link.');
      privateAccess(file, before);
      const fd = io.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        // NTFS file IDs can exceed Number's exact integer range.
        const after = io.fstatSync(fd, { bigint: true });
        check(after.isFile() && after.dev === before.dev && after.ino === before.ino && after.nlink === 1n && after.size <= 16384n, 'State changed during open.');
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(io.readFileSync(fd)));
      } finally { io.closeSync(fd); }
    },
  };
}

function validateRecord(record) {
  check(record && record.version === 1 && record.diagnostic_only === true && record.server_identity === null
    && record.boot_identity === null && text(record.endpoint) && IDS.every(key => id(record[key]))
    && Object.keys(record).sort().join(',') === ['version', 'diagnostic_only', 'server_identity', 'boot_identity', 'endpoint', ...IDS].sort().join(','), 'Malformed/untrusted diagnostic bookmark; repin explicitly.');
}

// Dependency injection is test-only; no runtime mock or focus implementation exists.
export function managerBookmark(argv, { spawn = spawnSync, env = process.env, state = privateState } = {}) {
  const options = parseArgs(argv);
  if (options.help) return { help: HELP };
  let saved;
  if (options.command !== 'pin') {
    saved = state(options['--state']).read();
    validateRecord(saved);
    check(saved.endpoint === options['--endpoint'], 'Endpoint differs from pin; refusing to query or focus.');
  }
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) if (/^HERDR_/i.test(key)) delete childEnv[key];
  childEnv.HERDR_SOCKET_PATH = options['--endpoint'];
  function call(args, json = true) {
    const result = spawn(options['--herdr'], args, { env: childEnv, shell: false, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    check(!result.error && !result.signal && result.status === 0, `Native diagnostic failed: ${args.join(' ')}; no focus sent.`);
    if (!json) return result.stdout.trim();
    let response;
    try { response = JSON.parse(result.stdout); } catch { throw new Error('Malformed native JSON; no focus sent.'); }
    check(response && typeof response === 'object' && !Array.isArray(response) && !Object.hasOwn(response, 'error'), 'Invalid native response; no focus sent.');
    return response;
  }
  check(call(['--version'], false) === 'herdr 0.9.5', 'Only inspected Herdr 0.9.5 contract is supported.');
  const status = call(['status', 'server', '--json']);
  check(status.status === 'running' && status.running === true && status.version === '0.9.5'
    && status.compatible === true && status.endpoint_compatible === true && status.socket === options['--endpoint'], 'Server unavailable, incompatible or endpoint differs.');
  const paneId = saved?.pane_id ?? options['--pane'];
  const response = call(['pane', 'get', paneId]);
  const pane = response.result?.pane;
  check(response.id === 'cli:pane:get' && response.result?.type === 'pane_info' && pane
    && IDS.every(key => id(pane[key])) && pane.pane_id === paneId && !pane.restore_error
    && typeof pane.focused === 'boolean' && Number.isSafeInteger(pane.revision) && pane.revision >= 0, 'No valid observed target; pane missing, replaced or malformed.');
  if (saved) check(IDS.every(key => saved[key] === pane[key]), 'Pinned pane/terminal/context changed; repin explicitly.');
  const record = { version: 1, diagnostic_only: true, endpoint: options['--endpoint'], server_identity: null, boot_identity: null,
    ...Object.fromEntries(IDS.map(key => [key, pane[key]])) };
  if (options.command === 'pin' && options['--state']) state(options['--state']).create(record);
  return { command: options.command, bookmark: record, state_written: options.command === 'pin' && !!options['--state'],
    observed_ids_match: saved ? true : null, identity_verified: false, focus_sent: false, return_status: 'BLOCKED', reason: BLOCKED };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = managerBookmark(process.argv.slice(2));
    console.log(result.help ?? JSON.stringify(result, null, 2));
    if (result.command === 'return') process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, focus_sent: false }));
    process.exitCode = 1;
  }
}

#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, statfsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELP = `Usage: node handoff-checkpoint.mjs --project DIRECTORY --workspace ID --pane ID [--pane ID ...] --private-output NEW.md --next-step TEXT [--next-step TEXT ...]
Optional verification: --herdr ABSOLUTE_EXECUTABLE --endpoint-socket ABSOLUTE_LOCAL_SOCKET
All filesystem paths must be explicit, absolute, local, without links.
Output parent must already be private. --private-output asserts it is not published or synced.
Windows: fixed NTFS drive, private owner ACL. Linux/WSL: native filesystem, owner-only parent.
No endpoint means unavailable native verification; supplied IDs remain user selections.
Manual snapshot only. No transcripts, diffs, automatic discovery, mutations, or resume.
`;

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function localPath(value) {
  check(typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f-\x9f]/.test(value), 'Invalid local path.');
  check(process.platform === 'win32'
    ? /^[a-z]:[\\/]/i.test(value) && !/[:*?<>|\"]/.test(value.slice(2)) && !value.split(/[\\/]/).some(part => /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))
    : value.startsWith('/') && !value.startsWith('//') && !value.includes(':') && !/^\/mnt\/[a-z](?:\/|$)/i.test(value),
  'Use native absolute local paths; no UNC, device, URL, or WSL drive paths.');
  check(!value.split(/[\\/]/).some(part => part === '..' || part === '.'), 'Path traversal is not accepted.');
  return path.normalize(value);
}

function ancestors(directory) {
  const result = [];
  for (let current = directory; ; current = path.dirname(current)) {
    result.push(current);
    if (current === path.dirname(current)) return result.reverse();
  }
}

function samePath(a, b) {
  return path.relative(a, b) === '';
}

function inside(directory, file) {
  const relative = path.relative(directory, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function directoryIdentity(directory) {
  return ancestors(directory).map(item => {
    const stat = lstatSync(item, { bigint: true });
    check(stat.isDirectory() && !stat.isSymbolicLink() && samePath(realpathSync(item), item), 'Linked or redirected directory refused.');
    return `${stat.dev}:${stat.ino}`;
  }).join('/');
}

// Fixed script; paths travel as environment data, never PowerShell source.
const WINDOWS_PRIVATE = `
$ErrorActionPreference = 'Stop'
try {
  Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
  $target = $env:CHECKPOINT_DIRECTORY
  $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($target))
  if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'storage' }
  $current = Get-Item -LiteralPath $target -Force
  while ($null -ne $current) {
    if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse' }
    $current = $current.Parent
  }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = Get-Acl -LiteralPath $target
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'owner' }
  $allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { throw 'shared' }
  }
  # Child files must inherit private access; an empty/unprotected inheritance policy is refused.
  if (-not $acl.AreAccessRulesProtected) { throw 'inheritance' }
  $inherit = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
    $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -eq $sid -and
    ($_.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit) -ne 0 -and
    ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl
  })
  if ($inherit.Count -eq 0) { throw 'inheritance' }
  [Console]::Out.Write('private')
} catch { exit 1 }
`;

function privateDirectory(directory, spawn) {
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PRIVATE], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
      env: { ...process.env, CHECKPOINT_DIRECTORY: directory },
    });
    check(!result.error && !result.signal && result.status === 0 && result.stdout === 'private', 'Output needs a private, protected owner ACL on fixed NTFS, without reparse ancestors.');
  } else {
    check(process.platform === 'linux', 'Private output is supported only on Windows NTFS or native Linux filesystems.');
    const stat = lstatSync(directory);
    check(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'Output parent must be owned by this user with no group/other permissions.');
    // DrvFS, network and unknown filesystems cannot establish native permission guarantees.
    check([0xef53, 0x58465342, 0x9123683e, 0x01021994].includes(statfsSync(directory).type), 'Output requires ext4, XFS, Btrfs or tmpfs; mounted Windows/network storage refused.');
  }
}

function outputTarget(output, project, spawn) {
  check(/\.md$/i.test(output), 'Output must be a new Markdown (.md) file.');
  const parent = path.dirname(output);
  const identity = directoryIdentity(parent);
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  check(!inside(project, output) && !inside(source, output), 'Output must be outside repositories.');
  for (const directory of ancestors(parent)) {
    const bare = ['HEAD', 'objects', 'refs'].every(name => existsSync(path.join(directory, name)));
    check(!existsSync(path.join(directory, '.git')) && !bare, 'Output must be outside repositories.');
    check(!/^(?:public|www|wwwroot|htdocs|public_html|onedrive(?: - .*)?|dropbox|google drive)$/i.test(path.basename(directory)), 'Public or synced output directory refused.');
  }
  try { lstatSync(output); throw new Error('Output already exists; refusing replacement.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  privateDirectory(parent, spawn);
  return { parent, identity };
}

// Indented JSON keeps newlines, Markdown, terminal controls and bidi text inert.
function data(value) {
  return `    ${JSON.stringify(value).replace(/[\x7f-\x9f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
}

function parseArgs(argv) {
  const options = { '--pane': [], '--next-step': [] };
  const flags = ['--project', '--workspace', '--pane', '--private-output', '--next-step', '--herdr', '--endpoint-socket'];
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    check(flags.includes(flag) && typeof argv[i + 1] === 'string' && argv[i + 1].length > 0, 'Unknown argument or missing value; use --help.');
    if (Array.isArray(options[flag])) options[flag].push(argv[i + 1]);
    else { check(!Object.hasOwn(options, flag), 'Duplicate argument.'); options[flag] = argv[i + 1]; }
  }
  for (const flag of flags.slice(0, 5)) check(options[flag]?.length, `Missing required ${flag}.`);
  check([options['--workspace'], ...options['--pane']].every(id => /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(id)), 'Invalid selected ID.');
  check(options['--pane'].length <= 32 && new Set(options['--pane']).size === options['--pane'].length, 'Select at most 32 distinct panes.');
  check(options['--next-step'].length <= 32 && options['--next-step'].join('').length <= 16000, 'Next steps exceed size limit.');
  check(Boolean(options['--herdr']) === Boolean(options['--endpoint-socket']), 'Verification needs both --herdr and --endpoint-socket.');
  return options;
}

export function handoffCheckpoint(argv, { spawn = spawnSync, now = () => new Date() } = {}) {
  if (argv.length === 1 && argv[0] === '--help') return { help: HELP };
  const options = parseArgs(argv);
  const project = localPath(options['--project']);
  directoryIdentity(project);
  const output = localPath(options['--private-output']);
  const target = outputTarget(output, project, spawn);
  const started = now().toISOString();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|HERDR_)/i.test(key)));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });

  function execute(command, args, commandEnv = env) {
    return spawn(command, args, { cwd: project, env: commandEnv, shell: false, windowsHide: true, encoding: 'buffer', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  }
  function decode(result) {
    check(!result.error && !result.signal && result.status === 0, 'Read command failed; no checkpoint created.');
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ''));
  }
  function git(...args) {
    return execute('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args]);
  }
  const root = decode(git('rev-parse', '--show-toplevel')).replace(/\r?\n$/, '');
  check(samePath(localPath(root), project), '--project must explicitly name the repository root.');
  function head() {
    const value = decode(git('rev-parse', '--verify', 'HEAD')).trim();
    check(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value), 'Invalid repository HEAD.');
    return value;
  }
  function branch() {
    const result = git('symbolic-ref', '--quiet', '--short', 'HEAD');
    if (!result.error && !result.signal && result.status === 1) return '(detached HEAD)';
    const value = decode(result).replace(/\r?\n$/, '');
    check(value.length > 0, 'Invalid repository branch.');
    return value;
  }
  const commit = head();
  const branchName = branch();
  const status = decode(git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all', '--no-renames'));
  check(status === '' || status.endsWith('\0'), 'Invalid Git path inventory.');
  const names = status === '' ? [] : status.slice(0, -1).split('\0').map(record => {
    check(/^[ MADUT?!]{2} /.test(record) && record.length > 3, 'Invalid Git path inventory.');
    return record.slice(3);
  });
  const stale = head() !== commit || branch() !== branchName;
  let native = 'unavailable: no explicit endpoint; selections below are unverified';
  let verified = [];
  if (options['--herdr']) {
    const binary = localPath(options['--herdr']);
    check(!inside(project, binary) && lstatSync(binary).isFile() && !lstatSync(binary).isSymbolicLink(), 'Select a trusted Herdr executable outside the project.');
    const socket = options['--endpoint-socket'];
    const namedPipe = process.platform === 'win32' && /^\\\\\.\\pipe\\[a-zA-Z0-9_.-]+$/.test(socket);
    if (!namedPipe) localPath(socket);
    const nativeEnv = { ...env, HERDR_SOCKET_PATH: socket };
    try {
      check(decode(execute(binary, ['--version'], nativeEnv)).trim() === 'herdr 0.9.5', 'Unsupported native contract.');
      function query(kind, id) {
        const response = JSON.parse(decode(execute(binary, [kind, 'get', id], nativeEnv)));
        check(response && !response.error && response.result?.[kind], 'Invalid native response.');
        return response.result[kind];
      }
      check(query('workspace', options['--workspace']).workspace_id === options['--workspace'], 'Workspace mismatch.');
      verified = options['--pane'].map(id => {
        const pane = query('pane', id);
        check(pane.pane_id === id && pane.workspace_id === options['--workspace'], 'Pane identity mismatch.');
        // No Windows/WSL translation or remote path inference; differing syntax is unverified.
        check(samePath(localPath(pane.foreground_cwd ?? pane.cwd), project), 'Selected pane project unavailable or different.');
        return { workspace_id: pane.workspace_id, pane_id: pane.pane_id };
      });
      native = 'snapshot: selected IDs and project cwd verified only at the caller-selected endpoint';
    } catch {
      verified = [];
      native = 'unavailable: endpoint query, contract, identity, or native project path could not be verified';
    }
  }
  const finished = now().toISOString();
  const markdown = '# Private handoff checkpoint\n\n'
    + 'Manual, non-atomic snapshot; potentially stale immediately. No task completion or resume is established.\n\n'
    + '## Observation window (UTC)\n\n' + data(started) + data(finished)
    + '\n## Selected local repository\n\n' + data(project)
    + '\n## Git observation\n\n' + data(stale ? 'stale: HEAD or branch changed during collection' : 'snapshot: HEAD and branch stable across collection; files can change independently')
    + '\nHEAD:\n\n' + data(commit) + '\nBranch:\n\n' + data(branchName)
    + '\nDirty/untracked path names (ignored files and submodule internals excluded):\n\n'
    + (names.length ? names.map(data).join('') : data('(none observed)'))
    + '\n## Native verification\n\n' + data(native)
    + (verified.length ? '\nAuthoritative selected IDs at observation time:\n\n' + verified.map(data).join('') : '')
    + '\nUser-selected workspace and panes (selection alone is not verification):\n\n'
    + data({ workspace: options['--workspace'], panes: options['--pane'] })
    + '\n## User-supplied next steps (unverified text)\n\n' + options['--next-step'].map(data).join('');

  check(directoryIdentity(target.parent) === target.identity, 'Output parent changed; refusing write.');
  privateDirectory(target.parent, spawn);
  const descriptor = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    check(directoryIdentity(target.parent) === target.identity, 'Output parent changed; empty output retained.');
    const file = fstatSync(descriptor, { bigint: true });
    check(file.isFile() && file.nlink === 1n, 'Unsafe output file; empty output retained.');
    privateDirectory(target.parent, spawn);
    writeFileSync(descriptor, markdown, 'utf8');
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  return { output, paths: names.length, nativeVerified: verified.length > 0, stale };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = handoffCheckpoint(process.argv.slice(2));
    process.stdout.write(result.help ?? 'Private checkpoint created. Snapshot only; resume unverified.\n');
  } catch {
    // Native errors may contain paths, prompts or credentials; never echo their payloads.
    process.stderr.write('handoff-checkpoint: refused or failed. Check explicit selections, private output permissions, and local Git availability. An incomplete new file may remain; existing files are never replaced.\n');
    process.exitCode = 1;
  }
}

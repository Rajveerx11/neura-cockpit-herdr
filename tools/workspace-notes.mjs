#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELP = `Usage: node workspace-notes.mjs --map FILE --project DIRECTORY --note FILE --leaf EXECUTABLE
All paths must be explicit, absolute local filesystem paths.
The UTF-8 JSON map contains {"version":1,"projects":[{"project":"...","notes":["..."]}]}.
Create or edit the map yourself to associate/reassociate existing Markdown files.
Only the selected project's registered note is rendered, using Leaf --inline=plain.
--leaf must name your trusted installed leaf/leaf.exe, outside the selected project.
No cwd inference, vault search, Herdr queries, note writes, editor, or background process.
`;

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function localPath(value) {
  check(typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f-\x9f]/.test(value), 'Paths must be nonempty and contain no controls.');
  const absolute = process.platform === 'win32'
    ? /^[a-z]:[\\/]/i.test(value) && !value.slice(2).includes(':')
    : value.startsWith('/') && !value.includes(':');
  check(absolute && !/^(?:\\\\|\/\/)/.test(value), 'Use absolute local paths, not relative paths, URLs, UNC paths, or device paths.');
  return path.normalize(value);
}

function identity(value) {
  // Explicit registrations use exact normalized spelling, not Unicode case folding.
  return localPath(value);
}

function existing(value, directory, label) {
  const resolved = localPath(realpathSync(localPath(value)));
  const stat = statSync(resolved);
  check(directory ? stat.isDirectory() : stat.isFile(), `${label} must be an existing ${directory ? 'directory' : 'file'}.`);
  return resolved;
}

export function workspaceNotes(argv, { spawn = spawnSync, read = readFileSync } = {}) {
  if (argv.length === 1 && argv[0] === '--help') return { help: HELP };
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    check(['--map', '--project', '--note', '--leaf'].includes(flag), `Unknown argument: ${flag}`);
    check(!Object.hasOwn(options, flag), `Duplicate argument: ${flag}`);
    check(argv[i + 1] && !argv[i + 1].startsWith('--'), `Missing value: ${flag}`);
    options[flag] = localPath(argv[i + 1]);
  }
  for (const flag of ['--map', '--project', '--note', '--leaf']) check(options[flag], `Missing required ${flag}.`);

  const mapFile = existing(options['--map'], false, 'Map');
  check(statSync(mapFile).size <= 1024 * 1024, 'Map exceeds 1 MiB.');
  let map;
  try {
    map = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read(mapFile)));
  } catch {
    throw new Error('Map must be valid UTF-8 JSON.');
  }
  check(map?.version === 1 && Array.isArray(map.projects), 'Map requires version 1 and a projects array.');
  const projects = new Set();
  for (const entry of map.projects) {
    check(entry && Array.isArray(entry.notes) && entry.notes.length > 0, 'Each project needs a project path and nonempty notes array.');
    const key = identity(entry.project);
    check(!projects.has(key), 'Duplicate project association; edit the map to remove ambiguity.');
    projects.add(key);
    const notes = entry.notes.map(identity);
    check(new Set(notes).size === notes.length, 'Duplicate note association; edit the map to remove ambiguity.');
  }
  const entry = map.projects.find(item => identity(item.project) === identity(options['--project']));
  check(entry, 'Selected project is not registered in this map.');
  check(entry.notes.some(note => identity(note) === identity(options['--note'])), 'Selected note is not registered for this project.');
  const project = existing(options['--project'], true, 'Project');
  const note = existing(options['--note'], false, 'Note');
  check(/\.md$/i.test(note), 'Selected note must be a Markdown (.md) file.');
  const leaf = existing(options['--leaf'], false, 'Leaf');
  check(path.basename(leaf).toLowerCase() === (process.platform === 'win32' ? 'leaf.exe' : 'leaf'), 'Choose the trusted installed Leaf executable.');
  const relative = path.relative(project, leaf);
  check(relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative), 'Leaf must be installed outside the selected project.');

  const result = spawn(leaf, ['--inline=plain', note], { shell: false, stdio: 'inherit' });
  check(!result.error && !result.signal && result.status === 0, `Leaf failed (${result.error?.code ?? result.signal ?? `exit ${result.status}`}).`);
  return { project, note, opened: true, mode: 'inline' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = workspaceNotes(process.argv.slice(2));
    if (result.help) process.stdout.write(result.help);
  } catch (error) {
    process.stderr.write(`workspace-notes: ${error.message}\n`);
    process.exitCode = 1;
  }
}

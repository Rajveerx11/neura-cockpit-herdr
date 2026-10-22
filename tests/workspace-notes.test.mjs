import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workspaceNotes } from '../tools/workspace-notes.mjs';

const script = fileURLToPath(new URL('../tools/workspace-notes.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'workspace-notes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project A');
  const other = path.join(root, 'project B');
  const note = path.join(root, 'selected Ω $ & note.md');
  const second = path.join(root, 'other note.md');
  const mapFile = path.join(root, 'chosen-map.json');
  const leaf = path.join(root, process.platform === 'win32' ? 'leaf.exe' : 'leaf');
  mkdirSync(project);
  mkdirSync(other);
  writeFileSync(note, '# Harmless fixture\n\tIndented Ω\n\n');
  writeFileSync(second, '# Other fixture\n');
  writeFileSync(leaf, 'not an executable: native calls must be mocked');
  const map = { version: 1, projects: [{ project, notes: [note] }, { project: other, notes: [second] }] };
  const save = () => writeFileSync(mapFile, JSON.stringify(map));
  save();
  const args = ['--map', mapFile, '--project', project, '--note', note, '--leaf', leaf];
  const calls = [];
  const reads = [];
  const deps = {
    read(file) { reads.push(file); return readFileSync(file); },
    spawn(command, argv, options) { calls.push({ command, argv, options }); return { status: 0 }; },
  };
  return { root, project, other, note, second, mapFile, leaf, map, save, args, calls, reads, deps,
    run: () => workspaceNotes(args, deps) };
}

test('exact project/note association; only chosen map is read, note contents unchanged', t => {
  const f = fixture(t);
  const before = readFileSync(f.note);
  const result = f.run();
  assert.equal(result.opened, true);
  assert.equal(result.mode, 'inline');
  assert.deepEqual(f.reads, [f.mapFile]);
  assert.deepEqual(f.calls, [{ command: f.leaf, argv: ['--inline=plain', f.note], options: { shell: false, stdio: 'inherit' } }]);
  assert.deepEqual(readFileSync(f.note), before);
});

test('another project cannot open the selected project\'s note', t => {
  const f = fixture(t);
  f.args[3] = f.other;
  assert.throws(f.run, /not registered for this project/);
  assert.deepEqual(f.calls, []);
});

test('Unicode case folding cannot select an unregistered project or note', t => {
  const f = fixture(t);
  const registered = path.join(f.root, '\u0130.md');
  const unregistered = path.join(f.root, 'i\u0307.md');
  writeFileSync(registered, '# Registered fixture');
  writeFileSync(unregistered, '# Unregistered fixture');
  assert.notDeepEqual(readFileSync(registered), readFileSync(unregistered));
  f.map.projects[0].notes = [registered];
  f.save();
  f.args[5] = unregistered;
  assert.throws(f.run, /not registered for this project/);
  assert.deepEqual(f.calls, []);
  f.args[5] = registered;
  assert.equal(f.run().note, registered);

  const registeredProject = path.join(f.root, '\u0130');
  const unregisteredProject = path.join(f.root, 'i\u0307');
  mkdirSync(registeredProject);
  mkdirSync(unregisteredProject);
  f.map.projects[0].project = registeredProject;
  f.save();
  f.args[3] = unregisteredProject;
  assert.throws(f.run, /project is not registered/);
});

test('manual reassociation is effective on next invocation without caching or note copying', t => {
  const f = fixture(t);
  f.map.projects[0].notes = [f.second];
  f.save();
  assert.throws(f.run, /not registered for this project/);
  f.args[5] = f.second;
  assert.equal(f.run().note, f.second);
  assert.deepEqual(f.calls[0].argv, ['--inline=plain', f.second]);
  assert.equal(readFileSync(f.note, 'utf8'), '# Harmless fixture\n\tIndented Ω\n\n');
});

test('unregistered project has no implicit cwd/Herdr/vault fallback', t => {
  const f = fixture(t);
  f.map.projects = [];
  f.save();
  assert.throws(f.run, /project is not registered/);
  assert.deepEqual(f.calls, []);
});

for (const missing of ['mapFile', 'note', 'project', 'leaf']) {
  test(`missing ${missing} fails before native call`, t => {
    const f = fixture(t);
    rmSync(f[missing], { recursive: true, force: true });
    assert.throws(f.run, /ENOENT/);
    assert.deepEqual(f.calls, []);
  });
}

test('moved note is not searched for; explicit mapping update required', t => {
  const f = fixture(t);
  const moved = path.join(f.root, 'moved.md');
  renameSync(f.note, moved);
  assert.throws(f.run, /ENOENT/);
  f.args[5] = moved;
  assert.throws(f.run, /not registered/);
  f.map.projects[0].notes = [moved];
  f.save();
  assert.equal(f.run().note, moved);
});

test('read-only note is viewable; permissions and contents are not changed', t => {
  const f = fixture(t);
  chmodSync(f.note, 0o444);
  const mode = statSync(f.note).mode;
  t.after(() => { if (existsSync(f.note)) chmodSync(f.note, 0o644); });
  assert.equal(f.run().opened, true);
  assert.equal(statSync(f.note).mode, mode);
  assert.deepEqual(f.reads, [f.mapFile]);
  assert.equal(readFileSync(f.note, 'utf8'), '# Harmless fixture\n\tIndented Ω\n\n');
});

for (const value of ['relative.json', 'https://example.invalid/map.json', 'ssh://host/map.json', '//host/share/map.json', '\\\\host\\share\\map.json', '\\\\?\\C:\\map.json', 'bad\u001bpath']) {
  test(`nonlocal/relative/control map input rejected: ${JSON.stringify(value)}`, t => {
    const f = fixture(t);
    f.args[1] = value;
    assert.throws(f.run, /absolute local|controls/);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.calls, []);
  });
}

for (const field of ['project', 'note']) {
  test(`remote ${field} in mapping rejected without fetching it`, t => {
    const f = fixture(t);
    if (field === 'project') f.map.projects[1].project = 'ssh://host/project';
    else f.map.projects[1].notes = ['https://example.invalid/note.md'];
    f.save();
    assert.throws(f.run, /absolute local/);
    assert.deepEqual(f.reads, [f.mapFile]);
    assert.deepEqual(f.calls, []);
  });
}

for (const corrupt of [Buffer.from([0xc3, 0x28]), Buffer.from('{bad json'), Buffer.from('{"version":2,"projects":[]}')]) {
  test(`bad UTF-8/JSON/schema map is refused: ${corrupt.toString('hex')}`, t => {
    const f = fixture(t);
    writeFileSync(f.mapFile, corrupt);
    assert.throws(f.run, /UTF-8 JSON|version 1/);
    assert.deepEqual(f.calls, []);
  });
}

test('oversized map rejected without reading contents', t => {
  const f = fixture(t);
  writeFileSync(f.mapFile, Buffer.alloc(1024 * 1024 + 1, 32));
  assert.throws(f.run, /exceeds 1 MiB/);
  assert.deepEqual(f.reads, []);
});

for (const duplicate of ['project', 'note']) {
  test(`ambiguous duplicate ${duplicate} rejected`, t => {
    const f = fixture(t);
    if (duplicate === 'project') f.map.projects.push(f.map.projects[0]);
    else f.map.projects[0].notes.push(f.note);
    f.save();
    assert.throws(f.run, /Duplicate/);
    assert.deepEqual(f.calls, []);
  });
}

test('notes must be regular Markdown files, not directories', t => {
  const f = fixture(t);
  f.map.projects[0].notes = [f.other];
  f.args[5] = f.other;
  f.save();
  assert.throws(f.run, /existing file/);
  const text = path.join(f.root, 'not-markdown.txt');
  writeFileSync(text, 'fixture');
  f.map.projects[0].notes = [text];
  f.args[5] = text;
  f.save();
  assert.throws(f.run, /Markdown/);
  assert.deepEqual(f.calls, []);
});

test('Leaf must be explicit, named Leaf, and installed outside project', t => {
  const f = fixture(t);
  f.args[7] = 'leaf';
  assert.throws(f.run, /absolute local/);
  const repoLeaf = path.join(f.project, path.basename(f.leaf));
  writeFileSync(repoLeaf, 'not executed');
  f.args[7] = repoLeaf;
  assert.throws(f.run, /outside the selected project/);
  f.args[7] = f.note;
  assert.throws(f.run, /trusted installed Leaf/);
  assert.deepEqual(f.calls, []);
});

for (const failure of [{ status: 2 }, { status: null, signal: 'SIGTERM' }, { status: null, error: { code: 'ENOENT' } }]) {
  test(`native failure reported, not retried: ${JSON.stringify(failure)}`, t => {
    const f = fixture(t);
    let calls = 0;
    f.deps.spawn = () => { calls++; return failure; };
    assert.throws(f.run, /Leaf failed/);
    assert.equal(calls, 1);
  });
}

test('missing/duplicate/unknown CLI arguments fail before file or process access', () => {
  const deps = { read: () => assert.fail('unexpected read'), spawn: () => assert.fail('unexpected spawn') };
  assert.throws(() => workspaceNotes([], deps), /Missing required/);
  assert.throws(() => workspaceNotes(['--map'], deps), /Missing value/);
  assert.throws(() => workspaceNotes(['--editor', 'anything'], deps), /Unknown argument/);
  const absolute = path.resolve('fixture.json');
  assert.throws(() => workspaceNotes(['--map', absolute, '--map', absolute], deps), /Duplicate argument/);
});

test('actual CLI help and errors are harmless; full CLI success uses a mocked native Leaf', t => {
  const f = fixture(t);
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--inline=plain/);
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing required --map/);
  const capture = path.join(f.root, 'native-call.json');
  const preload = path.join(f.root, 'mock-native.mjs');
  writeFileSync(preload, `import child from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
child.spawnSync = (command, argv, options) => {
  writeFileSync(${JSON.stringify(capture)}, JSON.stringify({command, argv, options}));
  return {status: 0};
};
syncBuiltinESMExports();\n`);
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script, ...f.args], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.deepEqual(JSON.parse(readFileSync(capture, 'utf8')), {
    command: f.leaf, argv: ['--inline=plain', f.note], options: { shell: false, stdio: 'inherit' },
  });
  f.args[5] = f.second;
  const rejected = spawnSync(process.execPath, [script, ...f.args], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /not registered for this project/);
});

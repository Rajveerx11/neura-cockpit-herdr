import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const fragment = read('../config.focus-keys.toml');
const base = read('../config.windows.toml');
const compact = read('../config.compact-rows.toml');
const outer = read('../noctty/config.ghostty');
const settings = fragment.split(/\r?\n/).map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));
const layout = /^\[ui\.sidebar\.agents\]\r?\n[\s\S]*?(?=^\[ui\.sidebar\.spaces\])/m;
const additions = settings.slice(1).join('\n') + '\n';

// Only the repository's single-line string/array key syntax, not a private TOML merger.
function bindings(source) {
  let section = '';
  const result = [];
  for (const line of source.split(/\r?\n/)) {
    if (/^\[/.test(line)) { section = line.trim(); continue; }
    const match = line.match(/^([a-z_]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!match || (section !== '[keys]' &&
      !(section === '[[keys.command]]' && match[1] === 'key'))) continue;
    const value = JSON.parse(match[2]);
    assert.ok(typeof value === 'string' ||
      (Array.isArray(value) && value.every(key => typeof key === 'string')),
    'Public key fixture must use strings or string arrays');
    for (const key of [value].flat()) result.push([match[1], key.toLowerCase()]);
  }
  return result;
}

function collisions(source) {
  return bindings(source).filter(([, key]) => key === 'f6' || key === 'f7');
}

function stage(source) {
  assert.equal([...source.matchAll(/^\[keys\]\r?$/gm)].length, 1);
  assert.ok(!bindings(source).some(([action]) => action === 'zoom' || action === 'last_pane'),
    'Public fixture now sets a focus action: review its aliases before merging');
  assert.deepEqual(collisions(source), [], 'Direct focus keys already bound');
  return source.replace(/^\[keys\]\r?\n/m, header => header + additions);
}

assert.ok(layout.test(base), 'Expected the public detailed agent layout');
const fixtures = [
  ['detailed', base],
  ['compact', base.replace(layout, () => `${compact.trimEnd()}\n\n`)],
];

test('fragment allowlists only native zoom and last_pane, retaining prefix zoom', () => {
  assert.deepEqual(settings, ['[keys]', 'zoom = ["prefix+z", "f6"]', 'last_pane = "f7"']);
  assert.deepEqual(bindings(fragment), [['zoom', 'prefix+z'], ['zoom', 'f6'], ['last_pane', 'f7']]);
});

test('direct keys do not collide with repository actions, commands or outer-terminal bindings', () => {
  assert.deepEqual(collisions(base), []);
  const outerKeys = [...outer.matchAll(/^keybind\s*=\s*([^=]+)=/gm)].map(match => match[1].toLowerCase());
  assert.ok(!outerKeys.includes('f6') && !outerKeys.includes('f7'));
  for (const key of ['f1', 'f2', 'f4', 'f10', 'alt+up', 'alt+down']) {
    assert.ok(bindings(base).some(([, binding]) => binding === key), `Existing ${key} must remain`);
  }
  for (const key of ['ctrl+v', 'alt+v']) assert.ok(outerKeys.includes(key));
});

test('collision checks catch built-in, custom command, array and prefix reservations', () => {
  for (const source of [
    '[keys]\nhelp = "f6"\n',
    '[keys]\nhelp = ["prefix+?", "f7"]\n',
    '[keys]\nprefix = "f6"\n',
    '[keys]\n[[keys.command]]\nkey = "f7"\n',
    '[keys]\n[[keys.command]]\nkey = ["prefix+d", "f6"]\n',
  ]) {
    assert.equal(collisions(source).length, 1);
    assert.throws(() => stage(source), /Direct focus keys already bound/);
  }
});

for (const [name, source] of fixtures) {
  test(`${name}: stage and rollback preserve every unrelated byte and binding`, () => {
    const staged = stage(source);
    assert.notEqual(staged, source);
    assert.equal(staged.replace(additions, ''), source);
    assert.equal(staged.match(layout)[0], source.match(layout)[0]);
    assert.deepEqual(bindings(staged).filter(([action]) => !['zoom', 'last_pane'].includes(action)), bindings(source));
    assert.equal([...staged.matchAll(/^zoom = /gm)].length, 1);
    assert.equal([...staged.matchAll(/^last_pane = /gm)].length, 1);
    assert.deepEqual(collisions(staged), [['zoom', 'f6'], ['last_pane', 'f7']]);
  });
}

test('optional image binding is preserved when present, but is not required', () => {
  const withoutImage = base.replace(/^remote_image_paste = .*\r?\n/gm, '');
  const withImage = withoutImage.replace(/^\[keys\]\r?\n/m,
    header => header + 'remote_image_paste = "ctrl+alt+i"\n');
  for (const source of [withoutImage, withImage]) {
    const staged = stage(source);
    const imageBindings = config => bindings(config).filter(([action]) => action === 'remote_image_paste');
    assert.deepEqual(imageBindings(staged), imageBindings(source));
    assert.equal(staged.replace(additions, ''), source);
  }
});

test('staging refuses existing focus settings instead of overwriting private aliases', () => {
  for (const assignment of ['zoom = "prefix+z"', 'last_pane = "ctrl+alt+p"']) {
    assert.throws(() => stage(`[keys]\n${assignment}\n`), /review its aliases/);
  }
});

test('Herdr 0.9.5 defaults and isolated merged profiles accept focus keys', {
  skip: process.env.HERDR_FOCUS_KEYS_NATIVE_CHECK !== '1',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'herdr-focus-keys-test-'));
  const path = join(directory, 'config.toml');
  try {
    writeFileSync(path, fragment, { flag: 'wx' });
    const options = { encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, HERDR_CONFIG_PATH: path } };
    const version = spawnSync('herdr', ['--version'], options);
    assert.equal(version.status, 0, 'Native version check must succeed');
    assert.equal(version.stdout.trim(), 'herdr 0.9.5');
    const defaults = spawnSync('herdr', ['--default-config'], options);
    assert.equal(defaults.status, 0, 'Native defaults must be available');
    assert.match(defaults.stdout, /^# zoom = "prefix\+z"/m);
    assert.match(defaults.stdout, /^# last_pane = ""/m);
    assert.doesNotMatch(defaults.stdout, /"f[67]"/i, 'Recheck native default-key collisions');
    for (const [name, config] of [['fragment', fragment],
      ...fixtures.map(([name, source]) => [name, stage(source)])]) {
      writeFileSync(path, config);
      const result = spawnSync('herdr', ['config', 'check'], options);
      assert.equal(result.status, 0, `${name}: isolated native config validation must pass`);
    }
  } finally {
    // Remove only this test's file and empty directory, never a live config or profile.
    unlinkSync(path);
    rmdirSync(directory);
  }
});

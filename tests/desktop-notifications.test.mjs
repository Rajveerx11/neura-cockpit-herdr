import test from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const fragment = read('../config.desktop-notifications.toml');
const settings = fragment.split(/\r?\n/).map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));
const base = read('../config.windows.toml');
const compact = read('../config.compact-rows.toml');
const layout = /^\[ui\.sidebar\.agents\]\r?\n[\s\S]*?(?=^\[ui\.sidebar\.spaces\])/m;
const edits = [
  { table: 'ui.toast', key: 'delivery', value: '"system"' },
  { table: 'ui.sound', key: 'enabled', value: 'false' },
];

// Test-only model of the documented two manual edits on conventional PUBLIC
// fixtures. This is deliberately not a general/private TOML merger or installer.
function fixtureEdit(source, values) {
  for (const { table, key, value } of values) {
    const escaped = table.replaceAll('.', '\\.');
    const header = new RegExp(`^\\[${escaped}\\]\\r?$`, 'gm');
    assert.equal([...source.matchAll(header)].length, 1, `Expected one [${table}] fixture table`);
    const section = new RegExp(`^\\[${escaped}\\]\\r?\\n[\\s\\S]*?(?=^\\[|(?![\\s\\S]))`, 'm');
    const text = source.match(section)?.[0];
    assert.ok(text, `Missing fixture table [${table}]`);
    const assignment = new RegExp(`^${key} = ([^\\r\\n]+)(\\r?)$`, 'gm');
    const matches = [...text.matchAll(assignment)];
    assert.equal(matches.length, 1, `Expected one ${table}.${key} fixture assignment`);
    const updated = text.replace(assignment, (_line, _old, cr) => `${key} = ${value}${cr}`);
    source = source.replace(text, () => updated);
  }
  return source;
}

function originals(source) {
  return edits.map(({ table, key }) => {
    const section = new RegExp(`^\\[${table.replaceAll('.', '\\.')}\\]\\r?\\n[\\s\\S]*?(?=^\\[|(?![\\s\\S]))`, 'm');
    const text = source.match(section)?.[0];
    assert.ok(text);
    const match = text.match(new RegExp(`^${key} = ([^\\r\\n]+)\\r?$`, 'm'));
    assert.ok(match);
    return { table, key, value: match[1] };
  });
}

assert.ok(layout.test(base), 'Expected public agent sidebar layout');
const custom = base.replace('delivery = "herdr"', 'delivery = "terminal"')
  .replace('delay_seconds = 2', 'delay_seconds = 7')
  .replace('[ui.toast.clipboard]\nenabled = true\nposition = "bottom-center"',
    '[ui.toast.clipboard]\nenabled = false\nposition = "top-left"')
  .replace('[ui.sound]\nenabled = false', '[ui.sound]\nenabled = true')
  + '\n[ui.sound.agents]\ncodex = "on"\n';
const fixtures = [
  ['detailed', base],
  ['compact', base.replace(layout, () => `${compact.trimEnd()}\n\n`)],
  ['custom delay/clipboard/sound', custom],
];

test('fragment allowlists only native system delivery and sound off', () => {
  assert.deepEqual(settings, ['[ui.toast]', 'delivery = "system"', '[ui.sound]', 'enabled = false']);
});

for (const [name, source] of fixtures) {
  test(`${name}: only intended assignments change and rollback is byte-exact`, () => {
    const staged = fixtureEdit(source, edits);
    assert.notEqual(staged, source);
    assert.deepEqual(originals(staged), edits);
    assert.equal(fixtureEdit(staged, originals(source)), source);
    // Mask only the two intended values; every other public byte must survive.
    const mask = edits.map(edit => ({ ...edit, value: 'UNCHANGED-MASK' }));
    assert.equal(fixtureEdit(staged, mask), fixtureEdit(source, mask));
    assert.equal(staged.match(layout)[0], source.match(layout)[0]);
    assert.equal([...staged.matchAll(/^delay_seconds = /gm)].length, 1);
    assert.equal(staged.match(/^delay_seconds = .+$/m)[0], source.match(/^delay_seconds = .+$/m)[0]);
    assert.equal(staged.match(/^\[ui\.toast\.clipboard\]\r?\n[\s\S]*?(?=^\[)/m)[0],
      source.match(/^\[ui\.toast\.clipboard\]\r?\n[\s\S]*?(?=^\[)/m)[0]);
  });
}

test('custom fixture actually exercises nondefault values and retained sound overrides', () => {
  assert.match(custom, /^delay_seconds = 7$/m);
  assert.match(custom, /\[ui\.toast\.clipboard\]\nenabled = false\nposition = "top-left"/);
  assert.match(custom, /\[ui\.sound\]\nenabled = true/);
  const staged = fixtureEdit(custom, edits);
  assert.match(staged, /\[ui\.sound\]\nenabled = false/);
  assert.match(staged, /\[ui\.sound\.agents\]\ncodex = "on"/);
});

test('fixture staging preserves CRLF and is idempotent', () => {
  const source = base.replace(/\r?\n/g, '\r\n');
  const staged = fixtureEdit(source, edits);
  assert.equal(fixtureEdit(staged, edits), staged);
  assert.equal(staged.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(fixtureEdit(staged, originals(source)), source);
});

test('fixture staging refuses missing or duplicate tables/assignments', () => {
  for (const source of [
    base.replace('[ui.toast]', '[ui.toast.other]'),
    base + '\n[ui.toast]\ndelivery = "herdr"\n',
    base.replace('delivery = "herdr"', 'delivery = "herdr"\ndelivery = "system"'),
    base.replace('delivery = "herdr"', ''),
    base.replace('[ui.sound]', '[ui.sound.other]'),
    base.replace('[ui.sound]\nenabled = false', '[ui.sound]\nenabled = false\nenabled = true'),
  ]) assert.throws(() => fixtureEdit(source, edits));
});

function assertOwnedIdentity(current, original, kind) {
  assert.ok(!current.isSymbolicLink(), 'Refuse linked temporary artifact; retained');
  assert.ok(kind === 'directory' ? current.isDirectory() : current.isFile(), 'Refuse unexpected temporary artifact type; retained');
  for (const field of ['dev', 'ino', 'birthtimeNs']) {
    assert.equal(current[field], original[field], 'Temporary identity changed; retained');
  }
}

test('temporary cleanup refuses links, wrong types and changed ownership identities', () => {
  const original = { dev: 1n, ino: 2n, birthtimeNs: 3n,
    isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
  assert.doesNotThrow(() => assertOwnedIdentity(original, original, 'file'));
  for (const changed of [
    { isSymbolicLink: () => true }, { isFile: () => false },
    { dev: 9n }, { ino: 9n }, { birthtimeNs: 9n },
  ]) assert.throws(() => assertOwnedIdentity({ ...original, ...changed }, original, 'file'));
  assert.throws(() => assertOwnedIdentity(original, original, 'directory'));
});

test('native Windows Herdr 0.9.5 validates isolated fragment, merges and rollbacks', {
  skip: process.env.HERDR_DESKTOP_NOTIFICATIONS_NATIVE_CHECK !== '1',
}, t => {
  // WSL's Windows bridge does not translate HERDR_CONFIG_PATH. Require native
  // Windows Node so the child sees an authoritative Windows temporary path.
  assert.equal(process.platform, 'win32', 'Run native checks from Windows PowerShell with node.exe, not WSL Node');
  const directory = mkdtempSync(join(tmpdir(), 'herdr-desktop-notifications-test-'));
  const path = join(directory, 'config.toml');
  const directoryOwner = lstatSync(directory, { bigint: true });
  let fileOwner;
  let expectedText;
  function verifyOwnedFixture() {
    assertOwnedIdentity(lstatSync(directory, { bigint: true }), directoryOwner, 'directory');
    assert.deepEqual(readdirSync(directory), fileOwner ? ['config.toml'] : [], 'Unexpected temporary contents; retained');
    if (fileOwner) {
      assertOwnedIdentity(lstatSync(path, { bigint: true }), fileOwner, 'file');
      assert.equal(readFileSync(path, 'utf8'), expectedText, 'Temporary config changed outside this test; retained');
    }
  }
  function writeFixture(text) {
    verifyOwnedFixture();
    writeFileSync(path, text, { flag: fileOwner ? 'w' : 'wx' });
    fileOwner ??= lstatSync(path, { bigint: true });
    expectedText = text;
  }
  const binary = process.env.HERDR_BIN_PATH || 'herdr.exe';
  const env = { ...process.env, HERDR_CONFIG_PATH: path };
  delete env.HERDR_SOCKET_PATH;
  delete env.HERDR_CLIENT_SOCKET_PATH;
  const options = { encoding: 'utf8', shell: false, windowsHide: true,
    cwd: directory, env, timeout: 15_000, maxBuffer: 1024 * 1024 };
  try {
    writeFixture(fragment);
    const version = spawnSync(binary, ['--version'], options);
    assert.equal(version.status, 0, 'Native herdr --version must succeed');
    assert.equal(version.stdout.trim(), 'herdr 0.9.5', 'Review another version before adopting this fragment');
    // An invalid sentinel must be rejected. Otherwise a dropped environment
    // override could falsely validate the live/default configuration instead.
    writeFixture('[ui.toast]\ndelivery = "invalid-desktop-notifications-test"\n');
    const sentinel = spawnSync(binary, ['config', 'check'], options);
    assert.equal(sentinel.status, 1, 'Invalid isolated sentinel must fail; config path override must be honored');
    assert.match(sentinel.stdout, /config: issues found/);
    t.diagnostic('isolated invalid sentinel rejected (expected exit 1)');
    const profiles = [['fragment', fragment]];
    for (const [name, source] of fixtures) {
      const staged = fixtureEdit(source, edits);
      profiles.push([`${name} merged`, staged], [`${name} rollback`, fixtureEdit(staged, originals(source))]);
    }
    for (const [name, config] of profiles) {
      writeFixture(config);
      const result = spawnSync(binary, ['config', 'check'], options);
      assert.equal(result.status, 0, `${name}: native config check must pass`);
      assert.equal(result.stdout.trim(), 'config: ok', `${name}: no diagnostics expected`);
      assert.equal(result.stderr.trim(), '', `${name}: no stderr diagnostics expected`);
      t.diagnostic(`${name}: config: ok (exit 0)`);
    }
  } finally {
    // Native children have returned. No retries, recursive deletion, or globs:
    // refuse links/replacements/foreign edits/extra contents before removing only
    // our exact file, then our empty directory. In-use deletion errors retain it.
    verifyOwnedFixture();
    if (fileOwner) unlinkSync(path);
    rmdirSync(directory);
    t.diagnostic(`Removed owned fixture %TEMP%\\${basename(directory)}\\config.toml and its empty directory; identity/link/content checks passed`);
  }
});

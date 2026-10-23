import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const fragment = read('../config.attention.toml');
const settings = fragment.split(/\r?\n/).map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));
const base = read('../config.windows.toml');
const compact = read('../config.compact-rows.toml');
const layout = /^\[ui\.sidebar\.agents\]\r?\n[\s\S]*?(?=^\[ui\.sidebar\.spaces\])/m;

test('fragment contains only the supported native priority setting', () => {
  assert.deepEqual(settings, ['[ui]', 'agent_panel_sort = "priority"']);
});

// Model the documented manual edit on public fixtures, not arbitrary private TOML.
function stage(source) {
  const ui = source.match(/^\[ui\]\r?\n[\s\S]*?(?=^\[)/m)?.[0];
  assert.ok(ui, 'Public fixture must have a conventional [ui] table');
  const old = /^agent_panel_sort = "spaces"\r?$/gm;
  assert.equal([...ui.matchAll(old)].length, 1);
  return source.replace(ui, () => ui.replace('agent_panel_sort = "spaces"', settings[1]));
}

assert.ok(layout.test(base), 'Expected the existing public agent layout');
const fixtures = [
  ['detailed', base],
  ['compact', base.replace(layout, () => `${compact.trimEnd()}\n\n`)],
];

for (const [name, source] of fixtures) {
  test(`${name} staging preserves unrelated config and reverses exactly`, () => {
    const staged = stage(source);
    assert.notEqual(staged, source);
    assert.equal(staged.replace('agent_panel_sort = "priority"', 'agent_panel_sort = "spaces"'), source);
    assert.equal(staged.match(layout)[0], source.match(layout)[0]);
    assert.equal([...staged.matchAll(/^agent_panel_sort = /gm)].length, 1);
    assert.match(staged, /^goto = \["prefix\+g", "ctrl\+k"\]$/m);
  });
}

test('Herdr 0.9.5 accepts isolated fragment and staged profiles', {
  skip: process.env.HERDR_ATTENTION_NATIVE_CHECK !== '1',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'herdr-attention-test-'));
  const path = join(directory, 'config.toml');
  try {
    writeFileSync(path, fragment, { flag: 'wx' });
    const options = { encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, HERDR_CONFIG_PATH: path } };
    const version = spawnSync('herdr', ['--version'], options);
    assert.equal(version.status, 0, 'herdr --version must succeed');
    assert.equal(version.stdout.trim(), 'herdr 0.9.5');
    for (const [name, config] of [['fragment', fragment],
      ...fixtures.map(([name, source]) => [name, stage(source)])]) {
      writeFileSync(path, config);
      const result = spawnSync('herdr', ['config', 'check'], options);
      assert.equal(result.status, 0, `${name}: native config check must pass without diagnostics`);
    }
  } finally {
    // Only this test's single file and empty directory are removed.
    unlinkSync(path);
    rmdirSync(directory);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS, ICON_KEY, artwork, metadataArgs, refresh } from '../plugins/neura-branding/branding.mjs';

test('Codex uses a terminal mark, not a Claude-like flower', () => {
  assert.equal(artwork({ agent: 'codex' })[ICON_KEY], '>_');
  assert.equal(artwork({ agent: 'claude' })[ICON_KEY], '✳');
  assert.equal(artwork({ agent: 'claude-code' })[ICON_KEY], '✳');
  assert.equal(new Set(Object.values(ICONS)).size, Object.keys(ICONS).length);
});

test('icon correction remains metadata-only and supports rollback', () => {
  const args = metadataArgs({ pane_id: 'test:p1', agent: 'codex' }, false, 1n);
  assert.deepEqual(args.slice(0, 2), ['pane', 'report-metadata']);
  assert.ok(args.includes(`${ICON_KEY}=>_`));
  for (const forbidden of ['--state', '--state-label', '--title', '--agent-session-id']) {
    assert.ok(!args.includes(forbidden));
  }
  assert.equal(artwork({ agent: 'codex' }, true)[ICON_KEY], null);
});

test('refresh replaces an already-published flower without changing native state', async () => {
  const pane = { pane_id: 'test:p1', agent: 'codex', agent_status: 'blocked', tokens: { [ICON_KEY]: '❋' } };
  const result = await refresh(async (args) => {
    if (args[1] === 'list') return { panes: [pane] };
    if (args[1] === 'get') return { pane };
    assert.equal(args[1], 'report-metadata');
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--token') {
        const [key, ...value] = args[++i].split('=');
        pane.tokens[key] = value.join('=');
      } else if (args[i] === '--clear-token') {
        delete pane.tokens[args[++i]];
      }
    }
  }, { clock: () => 1n });
  assert.deepEqual(result, { updated: 1, skipped: 0, failed: 0 });
  assert.equal(pane.tokens[ICON_KEY], '>_');
  assert.equal(pane.agent_status, 'blocked');
});

for (const [filename, expectedRows] of [['config.windows.toml', 7], ['config.compact-rows.toml', 1]]) {
  test(`${filename}: each harness identity is rendered once, using its native name`, () => {
    const config = readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
    const section = config.split('[ui.sidebar.agents]')[1]?.split('[ui.sidebar.spaces]')[0];
    assert.ok(section, 'agent layout must exist');
    assert.ok(!section.includes('$herdr_brand_icon'), 'do not repeat a logo beside the name');
    assert.ok(!section.includes('hide'), 'known and custom native names must remain visible');
    const identityRows = section.split('\n').filter(line => line.trimStart().startsWith('["state_icon",'));
    assert.equal(identityRows.length, expectedRows, 'cover default and all per-harness layouts');
    for (const row of identityRows) {
      const tokens = [...row.matchAll(/"?token"?\s*=\s*"([^"]+)"/g)].map(match => match[1]);
      assert.equal(tokens.filter(token => token === 'agent').length, 1);
      assert.ok(tokens.includes('state_text'), 'native lifecycle text must remain');
      assert.match(row, /\{\s*"?token"?\s*=\s*"agent",\s*"?fg"?\s*=\s*"#ffffff",\s*"?bold"?\s*=\s*true\s*\}/,
        'the native label must be unconditional, including unknown harnesses and named workers');
      for (const state of ['blocked', 'working', 'done', 'idle']) assert.ok(row.includes(`"${state}"`));
    }
    assert.match(section, /"workspace"/);
    assert.match(section, /"machine"/);
  });
}

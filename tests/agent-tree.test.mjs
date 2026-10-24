import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const patch = readFileSync(new URL('../patches/agent-tree-v0.9.5.patch', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/native-agent-tree.md', import.meta.url), 'utf8');
const root = fileURLToPath(new URL('../', import.meta.url));

test('tree patch is a valid additive diff limited to client shell ownership', () => {
  const parsed = spawnSync('git', ['apply', '--numstat', '-'], {
    cwd: root, input: patch, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(parsed.status, 0, parsed.stderr);
  const paths = parsed.stdout.trim().split(/\r?\n/).map(line => line.split('\t')[2]);
  const expected = [
    'src/client/shell.rs',
    ...['actions', 'agent_sidebar', 'agent_tree', 'composition', 'endpoint_agents',
      'endpoint_navigation', 'endpoint_sidebar', 'endpoints', 'mouse', 'render',
      'sidebar', 'state'].map(name => `src/client/shell/${name}.rs`),
    ...['agent_tree', 'agents_worktrees_notifications', 'endpoints', 'mod']
      .map(name => `src/client/shell/tests/${name}.rs`),
  ];
  assert.deepEqual(paths.sort(), expected.sort());
  assert.equal((patch.match(/^new file mode 100644$/gm) || []).length, 2);
  assert.doesNotMatch(patch, /^(?:deleted file mode|rename from|GIT binary patch|old mode)/m);
});

test('standalone publication includes native regressions without unpublished patch payloads', () => {
  for (const name of [
    'tree_disconnected_cached_agent_survives_absent_optional_pane_metadata',
    'tree_missing_parent_metadata_is_unavailable_not_empty_success',
    'tree_membership_keeps_optional_metadata_and_rejects_conflicts',
    'tree_remote_goto_defers_hidden_ancestor_reveal_until_activation',
    'agent_tree_render_scale_profile',
  ]) assert.ok(patch.includes(`fn ${name}()`), `missing native regression: ${name}`);
  assert.doesNotMatch(patch, /local_image_process_info|reporter-lifecycle|clipboard_image_target/);
  assert.ok(docs.includes('2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01'));
  assert.ok(docs.includes('not prerequisites'));
  assert.ok(docs.includes('not a separately compiled stock-only executable'));
});

test('public patch and instructions contain no author-machine paths or private artifacts', () => {
  for (const text of [patch, docs]) {
    assert.doesNotMatch(text, /[A-Z]:[\\/]Users[\\/]|herdr-workflow-batch-|\.tree-baseline|dev@example\.(?!invalid)/i);
    assert.doesNotMatch(text, /(?:BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,})/);
  }
});

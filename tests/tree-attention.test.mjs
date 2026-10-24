import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const patch = readFileSync(new URL('../patches/agent-tree-attention-v0.9.5.patch', import.meta.url), 'utf8');
const basePatch = readFileSync(new URL('../patches/agent-tree-v0.9.5.patch', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/tree-attention-counts.md', import.meta.url), 'utf8');
const files = ['src/client/shell/agent_tree.rs', 'src/client/shell/tests/agent_tree.rs'];

function git(cwd, args, input = patch) {
  return spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', ...args], {
    cwd, input, encoding: 'utf8', windowsHide: true,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  });
}

function fixtureRepo(t) {
  const tempRoot = path.resolve(tmpdir());
  const fixture = mkdtempSync(path.join(tempRoot, 'tree-attention-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(fixture)), tempRoot);
    assert.ok(path.basename(fixture).startsWith('tree-attention-'));
    rmSync(fixture, { recursive: true, force: true });
  });
  const initialized = git(fixture, ['init', '--quiet', '--template='], '');
  assert.equal(initialized.status, 0, initialized.stderr);
  return fixture;
}

test('attention patch is incremental and touches only the tree module and its tests', t => {
  const parsed = git(fixtureRepo(t), ['apply', '--numstat', '-']);
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(parsed.stdout.trim().split(/\r?\n/).map(line => line.split('\t')[2]), files);
  assert.doesNotMatch(patch, /^(?:new file mode|deleted file mode|rename from|GIT binary patch|old mode)/m);
  const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  assert.doesNotMatch(added, /std::(?:fs|process|net)|Command::|TcpStream|unsafe\s*\{/);
  assert.ok(docs.includes('AFTER `patches/agent-tree-v0.9.5.patch`'));
  assert.ok(docs.includes('not installed or activated'));
});

test('attention patch applies after the published tree and reverses exactly', t => {
  const fixture = fixtureRepo(t);
  const originals = new Map();
  for (const file of files) {
    const section = basePatch.split(`diff --git a/${file} b/${file}\n`)[1].split('\ndiff --git ')[0];
    assert.ok(section.includes('new file mode 100644'));
    const original = section.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.slice(1)).join('\n') + '\n';
    originals.set(file, original);
    mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    writeFileSync(path.join(fixture, file), original);
  }
  for (const args of [['apply', '--check', '-'], ['apply', '-']]) {
    const result = git(fixture, args);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.notEqual(git(fixture, ['apply', '--check', '-']).status, 0, 'applying twice must fail closed');
  const module = readFileSync(path.join(fixture, files[0]), 'utf8');
  const tests = readFileSync(path.join(fixture, files[1]), 'utf8');
  assert.ok(module.includes('format!("{label} | {summary}")'));
  assert.ok(module.includes('(done, "native done")'));
  for (const name of [
    'tree_attention_counts_whole_nested_subtrees_and_native_states',
    'tree_attention_missing_and_conflicting_membership_fail_closed',
    'tree_attention_endpoint_boot_and_hidden_updates_are_isolated',
    'tree_attention_narrow_headers_remain_single_line_and_action_free',
    'tree_attention_38_columns_preserve_workspace_and_tab_identity_before_counts',
  ]) assert.ok(tests.includes(`fn ${name}()`), name);
  for (const args of [['apply', '--reverse', '--check', '-'], ['apply', '--reverse', '-']]) {
    const result = git(fixture, args);
    assert.equal(result.status, 0, result.stderr);
  }
  for (const file of files) assert.equal(readFileSync(path.join(fixture, file), 'utf8'), originals.get(file));
});

test('attention publication excludes private paths and credentials', () => {
  for (const text of [patch, docs]) {
    assert.doesNotMatch(text, /[A-Z]:[\\/]Users[\\/]|\.tree-baseline|dev@example\.(?!invalid)/i);
    assert.doesNotMatch(text, /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,}/);
  }
});

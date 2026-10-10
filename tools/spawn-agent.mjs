#!/usr/bin/env node
// Item20: visible GLOBAL spawning, not an intrinsic fx subagent/config hook.
// Contract: Herdr 0.9.3 installed CLI/skill and agent-automation documentation.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = 'pi claude codex gemini cursor devin agy cline omp mastracode opencode copilot kimi kiro droid amp grok hermes kilo qodercli qwen letta maki muse'.split(' ');
export const HELP = `Usage: node spawn-agent.mjs --kind pi --name reviewer [--prompt-file FILE] [--cwd PATH] [--dry-run]
Global WSL command: herdr-spawn (same arguments).
Requires HERDR_ENV=1, HERDR_BIN_PATH and all three injected parent IDs.
Uses the parent's authoritative Windows API cwd, never process.cwd()/PWD.
--cwd is an assertion of that same cwd (absolute Windows or WSL path), not an override.
Right only, --no-focus, same workspace/tab; minimum 60 columns and 12 rows per pane.
Refuses zoomed, narrow, missing/changed context and unsupported kinds (including fx).
--dry-run does read-only preflight; no pane, agent or prompt is created.
--prompt-file reads UTF-8 locally; agent prompt handles bracketed paste + Enter.
Prompt submission is acknowledged, NOT verified turn activity/completion.
Startup uses Herdr's default 30s readiness wait. No polling service/dependency.
Ambiguous startup/prompt errors retain the pane. Inspect it before any retry.
No policy/config/instructions are changed; the parent owns prompts and approvals.
fx intrinsic subagents remain in-process and cannot be rerouted by this helper.
Supported kinds: ${KINDS.join(', ')}
`;

function requireThat(ok, message) {
  if (!ok) throw new Error(message);
}

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    requireThat(['--kind', '--name', '--prompt-file', '--cwd', '--dry-run', '--help'].includes(flag), `Unknown argument: ${flag}`);
    requireThat(!(flag in options), `Duplicate argument: ${flag}`);
    if (['--dry-run', '--help'].includes(flag)) options[flag] = true;
    else {
      requireThat(argv[i + 1] && !argv[i + 1].startsWith('--'), `Missing value: ${flag}`);
      options[flag] = argv[++i];
    }
  }
  if (options['--help']) return options;
  requireThat(KINDS.includes(options['--kind']), `Unsupported kind: ${options['--kind'] ?? '(missing)'}. Herdr 0.9.3 agent start does not support fx; no raw pane-run fallback or fake readiness. Use --help for supported kinds.`);
  requireThat(/^[a-z][a-z0-9_-]{0,31}$/.test(options['--name'] ?? ''), 'Name must match [a-z][a-z0-9_-]{0,31}.');
  return options;
}

function windowsAbsolute(value) {
  return typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value)
    && (/^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\/?.]+\\[^\\/]+(?:\\|$)/.test(value));
}
function sameCwd(a, b) {
  const normalize = x => path.win32.normalize(x).replace(/[\\/]+$/, '').toLowerCase();
  return windowsAbsolute(a) && windowsAbsolute(b) && normalize(a) === normalize(b);
}
function cwdOf(pane) {
  // foreground_cwd, when supplied, is the live process cwd; cwd is API fallback.
  const cwd = pane?.foreground_cwd ?? pane?.cwd;
  requireThat(windowsAbsolute(cwd), 'Parent API has no authoritative absolute Windows cwd; refusing WSL/PWD fallback.');
  return cwd;
}
function inContext(pane, parent) {
  return pane?.workspace_id === parent.workspace_id && pane?.tab_id === parent.tab_id;
}
function rectOf(layout, id, parent) {
  requireThat(inContext(layout, parent) && layout.zoomed === false && Array.isArray(layout.panes), 'Layout context changed, missing or zoomed; refusing invisible/uncertain split.');
  const rect = layout.panes.find(p => p.pane_id === id)?.rect;
  requireThat(rect && ['x', 'y', 'width', 'height'].every(k => Number.isInteger(rect[k]) && rect[k] >= 0), 'Missing/invalid pane geometry.');
  return rect;
}

// Inject spawn/read only for tests; no runtime mock mode or environment redirect.
export function spawnAgent(argv, { env = process.env, platform = process.platform,
  spawn = spawnSync, read = readFileSync, home = homedir() } = {}) {
  const options = parseArgs(argv);
  if (options['--help']) return { help: HELP };
  requireThat(env.HERDR_ENV === '1', 'Not inside Herdr (HERDR_ENV must be 1).');
  for (const key of ['HERDR_WORKSPACE_ID', 'HERDR_TAB_ID', 'HERDR_PANE_ID']) {
    requireThat(typeof env[key] === 'string' && /^[a-zA-Z0-9:_-]+$/.test(env[key]), `Missing/invalid injected ${key}; never using UI focus as parent.`);
  }
  requireThat(windowsAbsolute(env.HERDR_BIN_PATH) && /\.exe$/i.test(env.HERDR_BIN_PATH), 'HERDR_BIN_PATH must identify the injected Windows Herdr binary.');
  const binary = platform === 'win32' ? env.HERDR_BIN_PATH : path.posix.join(home, '.local/bin/herdr');
  function execute(command, args) {
    const result = spawn(command, args, { env, encoding: 'utf8', shell: false, maxBuffer: 1024 * 1024 });
    if (result.error || result.signal || result.status !== 0) {
      let serverError;
      try { serverError = JSON.parse(result.stderr)?.error; } catch { /* non-JSON transport/syntax failure */ }
      const error = new Error(`${args.slice(0, 2).join(' ')} failed: ${serverError?.code ?? result.error?.code ?? result.signal ?? `exit ${result.status}`}${serverError?.message ? ` (${serverError.message})` : ''}`);
      error.cliExitCode = result.status;
      throw error;
    }
    return result.stdout;
  }
  function cli(...args) {
    const text = execute(binary, args);
    let response;
    try { response = JSON.parse(text); } catch { throw new Error(`${args.slice(0, 2).join(' ')} returned invalid JSON; outcome may be ambiguous.`); }
    requireThat(!response.error && response.result, `${args.slice(0, 2).join(' ')} returned no successful result.`);
    return response.result;
  }

  // Fail closed on an unverified CLI/server contract, rather than silently upgrading.
  requireThat(execute(binary, ['--version']).trim() === 'herdr 0.9.3', 'Only Herdr 0.9.3 is verified; inspect updated CLI/skill before adapting this helper.');
  const status = execute(binary, ['status']);
  requireThat((status.match(/version: 0\.9\.3\b/g) ?? []).length === 2
    && /endpoint_compatible: yes\b/.test(status) && /private_protocol_compatible: yes\b/.test(status), 'Herdr server must be running, compatible and version 0.9.3.');
  const parent = cli('pane', 'get', env.HERDR_PANE_ID).pane;
  requireThat(parent?.pane_id === env.HERDR_PANE_ID && parent.workspace_id === env.HERDR_WORKSPACE_ID
    && parent.tab_id === env.HERDR_TAB_ID, 'Injected parent context differs from API (possibly moved); refresh parent IDs before spawning.');
  const cwd = cwdOf(parent);
  if (options['--cwd']) {
    let asserted = options['--cwd'];
    if (!windowsAbsolute(asserted)) {
      requireThat(platform !== 'win32' && path.posix.isAbsolute(asserted) && !/[\x00-\x1f\x7f]/.test(asserted), '--cwd must be an absolute Windows or WSL path.');
      asserted = execute('wslpath', ['-w', asserted]).trim();
    }
    requireThat(sameCwd(asserted, cwd), '--cwd differs from the parent API cwd; this helper never changes cwd.');
  }
  let prompt;
  if (options['--prompt-file']) {
    const data = read(options['--prompt-file']);
    prompt = new TextDecoder('utf-8', { fatal: true }).decode(data);
    requireThat(prompt.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(prompt), 'Prompt must be nonempty UTF-8 without terminal control/escape bytes.');
    requireThat(prompt.length <= 12000, 'Prompt exceeds conservative 12000 UTF-16-unit Windows command-line limit; shorten the prompt.');
  }
  const before = cli('pane', 'layout', '--pane', parent.pane_id).layout;
  const rect = rectOf(before, parent.pane_id, parent);
  requireThat(rect.width >= 121 && rect.height >= 12, `Right split too narrow/short (${rect.width}x${rect.height}); need at least 121x12 for two >=60-column panes. Widen it; no down fallback.`);
  const agents = cli('agent', 'list').agents;
  requireThat(Array.isArray(agents), 'Invalid live agent list.');
  requireThat(!agents.some(a => a.name === options['--name']), 'Agent name already in use; choose a unique name.');
  const splitArgs = ['pane', 'split', '--pane', parent.pane_id, '--direction', 'right', '--cwd', cwd, '--no-focus'];
  const plan = { parent_pane_id: parent.pane_id, workspace_id: parent.workspace_id,
    tab_id: parent.tab_id, cwd, kind: options['--kind'], name: options['--name'], direction: 'right',
    focus: false, prompt_requested: prompt !== undefined, split_args: splitArgs };
  if (options['--dry-run']) return { ...plan, dry_run: true, ready: false, prompt_submitted: false };

  let created;
  let startDispatched = false;
  try {
    const pane = cli(...splitArgs).pane;
    // Never act on predicted/reused IDs or a malformed creation response.
    requireThat(pane?.pane_id && pane.terminal_id && !before.panes.some(p => p.pane_id === pane.pane_id)
      && pane.terminal_id !== parent.terminal_id, 'Split returned no verifiable new pane; inspect layout, do not retry blindly.');
    created = pane;
    requireThat(inContext(pane, parent) && pane.focused === false && sameCwd(pane.cwd, cwd), 'Created pane context/focus/cwd differs from requested parent.');
    const after = cli('pane', 'layout', '--pane', parent.pane_id).layout;
    const left = rectOf(after, parent.pane_id, parent);
    const right = rectOf(after, pane.pane_id, parent);
    requireThat(left.width >= 60 && right.width >= 60 && left.height >= 12 && right.height >= 12
      && right.x >= left.x + left.width && right.x <= left.x + left.width + 1
      && right.y === left.y && right.height === left.height
      && after.focused_pane_id === before.focused_pane_id, 'Post-split geometry/focus changed; refusing agent startup.');
    const liveParent = cli('pane', 'get', parent.pane_id).pane;
    requireThat(inContext(liveParent, parent) && liveParent.terminal_id === parent.terminal_id && sameCwd(cwdOf(liveParent), cwd), 'Parent moved or cwd changed before startup.');
    const live = cli('pane', 'get', pane.pane_id).pane;
    requireThat(inContext(live, parent) && live.terminal_id === pane.terminal_id && sameCwd(live.cwd, cwd)
      && live.focused === false && !live.agent, 'New pane changed/occupied before startup.');
    // From here all failures retain the pane, including timeouts, blocked and transport loss.
    startDispatched = true;
    const agent = cli('agent', 'start', options['--name'], '--kind', options['--kind'], '--pane', pane.pane_id).agent;
    requireThat(agent?.pane_id === pane.pane_id && agent.terminal_id === pane.terminal_id
      && inContext(agent, parent) && agent.name === options['--name'] && agent.agent === options['--kind']
      && ['idle', 'done'].includes(agent.agent_status) && agent.interactive_ready !== false
      && agent.launch_pending !== true && sameCwd(cwdOf(agent), cwd), 'Startup response does not prove the expected agent is ready in the created pane.');
    // Use the validated unique name, not an arbitrary replacement occupant of the pane.
    if (prompt !== undefined) cli('agent', 'prompt', options['--name'], prompt);
    return { ...plan, pane_id: pane.pane_id, ready: true, prompt_submitted: prompt !== undefined,
      turn_activity_verified: false };
  } catch (error) {
    error.pane_id = created?.pane_id ?? null;
    error.cleanup = created ? 'retained' : 'no_verified_created_pane';
    if (created && !startDispatched) {
      // Only our still-unfocused shell, same terminal/context, with no agent/foreground job.
      try {
        const live = cli('pane', 'get', created.pane_id).pane;
        const info = cli('pane', 'process-info', '--pane', created.pane_id).process_info;
        const processes = info?.foreground_processes;
        requireThat(inContext(live, parent) && live.terminal_id === created.terminal_id && !live.agent && live.focused === false
          && info.pane_id === created.pane_id && Number.isInteger(info.shell_pid) && info.shell_pid > 0
          && Array.isArray(processes) && processes.length === 1 && processes[0].pid === info.shell_pid
          && /^(powershell|pwsh|cmd)(\.exe)?$/i.test(processes[0].name), 'Cannot prove created pane is an untouched shell.');
        cli('pane', 'close', created.pane_id);
        error.cleanup = 'closed_created_shell';
      } catch { error.cleanup = 'retained_unverified_or_cleanup_failed'; }
    }
    if (created) error.message += `; created pane ${created.pane_id}: ${error.cleanup}. Inspect before retrying; no prompt retry or approval handling.`;
    else error.message += '; split outcome unverified: inspect parent layout before retrying. No pane was closed.';
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = spawnAgent(process.argv.slice(2));
    console.log(result.help ?? JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, pane_id: error.pane_id ?? null,
      cleanup: error.cleanup ?? 'no_mutation', cli_exit_code: error.cliExitCode ?? null }));
    process.exitCode = 1;
  }
}

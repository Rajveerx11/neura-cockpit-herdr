import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const SOURCE = 'neura.branding';
export const NEURA_LABEL = 'Neura';
export const LEGACY_CAPTION = 'herdr_brand_caption';
export const LEGACY_MARKER = 'herdr_brand_harness';
export const ROW_KEYS = Array.from({ length: 6 }, (_, i) => `herdr_brand_row${i + 1}`);
export const ICON_KEY = 'herdr_brand_icon';
// Compact text-mode marks; fx and Codex use distinct two-cell wordmarks.
export const ICONS = { pi: 'π', claude: '✳', codex: '>_', gemini: '✦', hermes: '☤', opencode: '▣', fx: 'ƒx', deepseek: '≈', neura: 'N' };
const exec = promisify(execFile);
const badges = JSON.parse(fs.readFileSync(new URL('./badges.json', import.meta.url), 'utf8'));
const aliases = { 'claude-code': 'claude', 'gemini-cli': 'gemini', 'deepseek-tui': 'deepseek' };

export function badgeKey(agent, displayAgent) {
  const key = aliases[agent] ?? agent;
  if (key === 'pi' && displayAgent === NEURA_LABEL) return 'neura';
  return Object.hasOwn(badges, key) ? key : undefined;
}

export function artwork(pane, clear = false) {
  const key = clear ? undefined : badgeKey(pane.agent, pane.display_agent);
  // Clear previously published multi-line art on every refresh/migration.
  const values = Object.fromEntries([ICON_KEY, ...ROW_KEYS, LEGACY_CAPTION, LEGACY_MARKER].map((key) => [key, null]));
  if (key) values[ICON_KEY] = ICONS[key];
  return values;
}

export function metadataArgs(pane, clear = false, seq = process.hrtime.bigint()) {
  const args = ['pane', 'report-metadata', pane.pane_id, '--source', SOURCE, '--seq', String(seq), '--clear-display-agent'];
  if (!clear && badgeKey(pane.agent, pane.display_agent)) args.push('--agent', pane.agent);
  for (const [token, value] of Object.entries(artwork(pane, clear))) {
    args.push(...(value === null ? ['--clear-token', token] : ['--token', `${token}=${value}`]));
  }
  // No lifecycle, title, state-label or session writes. The cleared display belongs only to SOURCE.
  return args;
}

export function eventPane(eventText) {
  if (!eventText) return undefined;
  const event = JSON.parse(eventText);
  return event.data?.pane_id ?? event.data?.pane?.pane_id;
}

export function cliResult(stdout, silent = false) {
  if (silent && !stdout.trim()) return undefined; // report-metadata: exit 0, empty stdout.
  const response = JSON.parse(stdout);
  if (!response || response.error || !Object.hasOwn(response, 'result')) throw new Error('Invalid Herdr CLI response.');
  return response.result; // Reads/actions use {id,result}, not {ok:true}.
}

export function runner(env, execute = exec) {
  const bin = env.HERDR_BIN_PATH;
  if (env.HERDR_ENV !== '1' || !bin || !path.isAbsolute(bin) || !fs.existsSync(bin)) {
    throw new Error('Herdr branding requires HERDR_ENV=1 and an absolute existing HERDR_BIN_PATH.');
  }
  return async (args) => {
    const { stdout } = await execute(bin, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return cliResult(stdout, args[0] === 'pane' && args[1] === 'report-metadata');
  };
}

function matches(tokens = {}, values) {
  return Object.entries(values).every(([key, value]) => value === null ? !tokens[key] : tokens[key] === value);
}

export async function refresh(run, { eventText, clear = false, clock = () => process.hrtime.bigint() } = {}) {
  const target = eventPane(eventText);
  const panes = target ? [{ pane_id: target }] : (await run(['pane', 'list'])).panes;
  const result = { updated: 0, skipped: 0, failed: 0 };
  for (const entry of panes) {
    try {
      // ponytail: native sequence checks plus bounded read-back, not a new lock/daemon.
      // Capture sequence BEFORE reads so an old snapshot can't overwrite a newer report.
      for (let attempt = 0; attempt < 3; attempt++) {
        const seq = clock();
        const pane = (await run(['pane', 'get', entry.pane_id])).pane;
        const key = badgeKey(pane.agent, pane.display_agent);
        if (!clear && !key && ![ICON_KEY, ...ROW_KEYS, LEGACY_CAPTION, LEGACY_MARKER].some((key) => pane.tokens?.[key])) {
          result.skipped++;
          break;
        }
        await run(metadataArgs(pane, clear, seq));
        // The write CLI is silent even when a sequence is stale. Verify actual tokens,
        // replanning against fresh native presentation instead of assuming acceptance.
        const current = (await run(['pane', 'get', entry.pane_id])).pane;
        if (matches(current.tokens, artwork(current, clear))) {
          result.updated++;
          break;
        }
        if (attempt === 2) throw new Error('Branding changed during bounded reconciliation.');
      }
    } catch {
      // A vanished/busy pane must not stop refresh/rollback of the remaining panes.
      result.failed++;
    }
  }
  return result;
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  try {
    const result = await refresh(runner(process.env), { eventText: process.env.HERDR_PLUGIN_EVENT_JSON, clear: process.argv.includes('--clear') });
    if (result.failed) throw new Error('Partial branding refresh.');
  } catch {
    // Never echo CLI responses, pane IDs, labels or session fields into plugin logs.
    console.error('Herdr branding update incomplete; no runtime response was logged.');
    process.exitCode = 1;
  }
}

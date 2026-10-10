import assert from "node:assert/strict";
import test from "node:test";
import { clearStalePanes, credentialRevision, credentialsFor, normalizeClaude, normalizeCodex, normalizeCursor, providerForPane, renderUsage, runUsageReport, trustedHerdrBinary, usageMetadataArgs } from "./usage-report.mjs";

test("usage cache invalidates on credential-file changes without storing token data", () => {
  const first = credentialRevision("synthetic.json", () => ({ mtimeMs: 1, ctimeMs: 2, size: 3, ino: 4 }));
  assert.equal(first, "1:2:3:4");
  assert.notEqual(first, credentialRevision("synthetic.json", () => ({ mtimeMs: 2, ctimeMs: 3, size: 3, ino: 4 })));
  assert.equal(credentialRevision("missing.json", () => { throw new Error("missing"); }), undefined);
});

test("usage retries failed stale-pane clears without touching active panes", () => {
  const cleared = [];
  const failed = clearStalePanes(["active", "former"], ["active"], (id) => { cleared.push(id); return false; });
  assert.deepEqual(cleared, ["former"]);
  assert.deepEqual(failed, ["former"]);
  assert.deepEqual(clearStalePanes(failed, [], () => true), []);
});

test("automatic Herdr commands refuse ambient or missing executables", () => {
  assert.equal(trustedHerdrBinary({}, () => true), undefined);
  assert.equal(trustedHerdrBinary({ HERDR_BIN_PATH: "herdr" }, () => true), undefined);
  assert.equal(trustedHerdrBinary({ HERDR_BIN_PATH: process.execPath }, () => false), undefined);
  assert.equal(trustedHerdrBinary({ HERDR_BIN_PATH: process.execPath }, () => true), process.execPath);
});

test("credential readers accept only current access tokens and reject API-key/refresh-token-only input", () => {
  const candidate = () => [process.execPath];
  assert.deepEqual(credentialsFor("claude", {}, () => ({ claudeAiOauth: { accessToken: "current", refreshToken: "never-used" } }), candidate), { token: "current", plan: undefined });
  assert.equal(credentialsFor("codex", {}, () => ({ OPENAI_API_KEY: "not-an-account-window" }), candidate), undefined);
  assert.equal(credentialsFor("cursor", {}, () => ({ refreshToken: "never-used" }), candidate), undefined);
});

test("Claude normalization renders remaining usage without retaining token data", () => {
  const usage = normalizeClaude({
    five_hour: { utilization: 19.6, resets_at: "2026-09-15T20:00:00Z" },
    seven_day: { utilization: 75.4, resets_at: "2026-09-20T20:00:00Z" },
  }, "max");
  assert.equal(usage.plan, "max");
  assert.deepEqual(usage.windows.map((entry) => entry.remaining), [80, 25]);
  assert.equal(renderUsage(usage), "5h 80% · Wk 25%");
});

test("Codex accepts either reset representation and labels API windows", () => {
  const usage = normalizeCodex({ rate_limit: {
    primary_window: { used_percent: 1, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
    secondary_window: { used_percent: 100, limit_window_seconds: 604_800, reset_after_seconds: 60 },
  } }, undefined, 1_700_000_000_000);
  assert.deepEqual(usage.windows.map((entry) => [entry.label, entry.remaining]), [["5h", 99], ["Wk", 0]]);
  assert.equal(usage.windows[0].reset, 1_800_000_000);
  assert.equal(usage.windows[1].reset, 1_700_000_060);
});

test("Cursor supports current API spelling and treats absent quota as unavailable", () => {
  const usage = normalizeCursor({
    individualUsage: { plan: { totalPercentUsed: "39.5" } },
    billingCycleEnd: "2026-10-01T00:00:00Z",
  });
  assert.equal(renderUsage(usage), "Plan 61%");
  assert.ok(Number.isInteger(usage.windows[0].reset));
  assert.equal(renderUsage(normalizeCursor({})), "usage unavailable");
  assert.equal(renderUsage(normalizeCursor({ individualUsage: { plan: { totalPercentUsed: null } } })), "usage unavailable");
});

test("Codex never invents percentages or window durations", () => {
  for (const used_percent of [undefined, null, "20", NaN, Infinity, -1, 101]) {
    assert.equal(renderUsage(normalizeCodex({ rate_limit: { primary_window: { used_percent } } })), "usage unavailable");
  }
  assert.equal(renderUsage(normalizeCodex({})), "usage unavailable");
  assert.equal(renderUsage(normalizeCodex({ rate_limit: { primary_window: { used_percent: 0 } } })), "Primary 100%");
  assert.equal(renderUsage(normalizeCodex({ rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 1800 } } })), "0.5h 0%");
});

test("current agent-list metadata selects only actual supported providers", () => {
  assert.equal(providerForPane({ agent: "codex" }), "codex");
  assert.equal(providerForPane({ agent: "pi", tokens: { usage_provider: "codex" } }), "codex");
  assert.equal(providerForPane({ agent: "pi", tokens: { usage_provider: "claude" } }), "claude");
  assert.equal(providerForPane({ agent: "pi", tokens: { usage_provider: "cursor" } }), "cursor");
  assert.equal(providerForPane({ agent: "pi" }), undefined);
  assert.equal(providerForPane({ agent: "pi", tokens: { usage_provider: "openai" } }), undefined);
  assert.equal(providerForPane({ agent: "fx", tokens: { usage_provider: "codex" } }), undefined);
});

test("usage metadata uses documented token TTL and explicit clearing without semantic overrides", () => {
  assert.deepEqual(usageMetadataArgs("w1:p1", "5h 80%", 20_000), [
    "pane", "report-metadata", "w1:p1", "--source", "neura.usage",
    "--token", "usage=5h 80%", "--ttl-ms", "20000",
  ]);
  assert.deepEqual(usageMetadataArgs("w1:p1", undefined), [
    "pane", "report-metadata", "w1:p1", "--source", "neura.usage", "--clear-token", "usage",
  ]);
});

function scenario(overrides = {}) {
  const cache = { providers: {}, panes: [] };
  const reports = [];
  const calls = [];
  let now = 1_700_000_000_000;
  const options = {
    listPanes: () => [{ pane_id: "w1:p1", agent: "codex" }],
    readCache: () => cache,
    writeCache: (saved) => { assert.equal(saved, cache); calls.push("save"); },
    credentials: () => ({ token: "synthetic-access" }),
    revisionFor: () => "revision-1",
    fetch: async (provider) => { calls.push(provider); return normalizeCodex({ rate_limit: {
      primary_window: { used_percent: 20, limit_window_seconds: 18_000 },
      secondary_window: { used_percent: 75, limit_window_seconds: 604_800 },
    } }); },
    report: (...args) => { reports.push(args); return true; },
    clock: () => now,
    forceRefresh: false,
    ...overrides,
  };
  return { cache, reports, calls, options, advance: (ms) => { now += ms; } };
}

test("Codex reports real limits once per provider and never stores account credentials", async () => {
  const s = scenario({ listPanes: () => [
    { pane_id: "w1:p1", agent: "codex" },
    { pane_id: "w1:p2", agent: "pi", tokens: { usage_provider: "codex" } },
  ] });
  await runUsageReport(s.options);
  assert.deepEqual(s.calls, ["codex", "save"]);
  assert.deepEqual(s.reports, [
    ["w1:p1", "5h 80% · Wk 25%", 120_000], ["w1:p2", "5h 80% · Wk 25%", 120_000],
  ]);
  assert.doesNotMatch(JSON.stringify(s.cache), /synthetic-access|accountId|access_token/);
});

test("cache hits keep the original expiry; exact TTL, account revision and force trigger refresh", async () => {
  const s = scenario();
  await runUsageReport(s.options);
  s.advance(30_000);
  await runUsageReport(s.options);
  assert.deepEqual(s.reports.at(-1), ["w1:p1", "5h 80% · Wk 25%", 90_000]);
  assert.equal(s.calls.filter((c) => c === "codex").length, 1);
  s.advance(90_000);
  await runUsageReport(s.options);
  await runUsageReport({ ...s.options, revisionFor: () => "revision-2" });
  await runUsageReport({ ...s.options, revisionFor: () => "revision-2", forceRefresh: true });
  assert.equal(s.calls.filter((c) => c === "codex").length, 4);
});

test("missing/API-key credentials and failed fetches explicitly replace stale Codex limits", async () => {
  for (const overrides of [
    { credentials: () => undefined },
    { fetch: async () => { throw new Error("synthetic failure"); } },
  ]) {
    const s = scenario(overrides);
    s.cache.providers.codex = { fetchedAt: 1_699_999_800_000, revision: "revision-1", token: "5h 99%" };
    await runUsageReport(s.options);
    assert.deepEqual(s.reports, [["w1:p1", "limits unavailable", 120_000]]);
    assert.equal(s.cache.providers.codex, undefined);
    if (overrides.credentials) assert.deepEqual(s.calls, ["save"]);
  }
});

test("successful Codex response without rate limits stays explicitly unavailable", async () => {
  const s = scenario({ fetch: async () => normalizeCodex({}) });
  await runUsageReport(s.options);
  assert.deepEqual(s.reports, [["w1:p1", "limits unavailable", 120_000]]);
});

test("no running Codex means no auth read, network fetch or stale fallback on unrelated panes", async () => {
  const s = scenario({
    listPanes: () => [{ pane_id: "w1:p1", agent: "fx" }, { pane_id: "w1:p2", agent: "pi" }],
    credentials: () => { assert.fail("must not read auth for inactive provider"); },
    fetch: async () => { assert.fail("must not fetch inactive provider"); },
  });
  s.cache.panes = ["w1:p1"];
  s.cache.providers.codex = { fetchedAt: 1_699_999_800_000, token: "5h 99%" };
  await runUsageReport(s.options);
  assert.deepEqual(s.reports, [["w1:p1", undefined]]);
  assert.deepEqual(s.cache.panes, []);
});

test("a cached quota expiring during another provider fetch is not republished", async () => {
  const s = scenario({ listPanes: () => [
    { pane_id: "w1:p1", agent: "codex" }, { pane_id: "w1:p2", agent: "claude" },
  ] });
  s.cache.providers.codex = { fetchedAt: 1_699_999_900_000, revision: "revision-1", token: "5h 99%" };
  s.options.fetch = async () => { s.advance(20_000); return normalizeClaude({ five_hour: { utilization: 50 } }); };
  await runUsageReport(s.options);
  assert.deepEqual(s.reports, [["w1:p1", "limits unavailable", 120_000], ["w1:p2", "5h 50%", 120_000]]);
});

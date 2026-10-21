import assert from "node:assert/strict";
import test from "node:test";
import { clearStalePanes, credentialRevision, credentialsFor, normalizeClaude, normalizeCodex, normalizeCursor, providerForPane, renderUsage, runUsageReport, trustedHerdrBinary, usageDisplay, usageMetadataArgs } from "./usage-report.mjs";

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
    ["w1:p1", "limits refreshing", 120_000], ["w1:p2", "limits refreshing", 120_000],
    ["w1:p1", "fresh · 5h 80% · Wk 25%", 120_000], ["w1:p2", "fresh · 5h 80% · Wk 25%", 120_000],
  ]);
  assert.doesNotMatch(JSON.stringify(s.cache), /synthetic-access|accountId|access_token/);
});

test("cache hits keep the original expiry; exact TTL, account revision and force trigger refresh", async () => {
  const s = scenario();
  await runUsageReport(s.options);
  s.advance(30_000);
  await runUsageReport(s.options);
  assert.deepEqual(s.reports.at(-1), ["w1:p1", "fresh 30s ago · 5h 80% · Wk 25%", 90_000]);
  assert.equal(s.reports.filter(([, display]) => display === "limits refreshing").length, 1);
  assert.equal(s.calls.filter((c) => c === "codex").length, 1);
  s.advance(90_000);
  await runUsageReport(s.options);
  await runUsageReport({ ...s.options, revisionFor: () => "revision-2" });
  await runUsageReport({ ...s.options, revisionFor: () => "revision-2", forceRefresh: true });
  assert.equal(s.calls.filter((c) => c === "codex").length, 4);
});

test("missing/API-key credentials discard quota and do not request a refresh", async () => {
  const s = scenario({ credentials: () => undefined });
  s.cache.providers.codex = { fetchedAt: 1_699_999_800_000, revision: "revision-1", token: "5h 99%" };
  await runUsageReport(s.options);
  assert.deepEqual(s.reports, [["w1:p1", "limits unavailable", 120_000]]);
  assert.equal(s.cache.providers.codex, undefined);
  assert.deepEqual(s.calls, ["save"]);
});

test("failed refresh retains only the last success age and never republishes stale quota", async () => {
  const s = scenario({ fetch: async () => { throw new Error("synthetic private error"); } });
  s.cache.providers.codex = { fetchedAt: 1_699_999_800_000, revision: "revision-1", token: "5h 99%" };
  await runUsageReport(s.options);
  assert.deepEqual(s.reports, [["w1:p1", "limits refreshing", 120_000], ["w1:p1", "limits stale · 3m ago", 120_000]]);
  assert.deepEqual(s.cache.providers.codex, { fetchedAt: 1_699_999_800_000, revision: "revision-1", stale: true });
  assert.doesNotMatch(JSON.stringify(s.cache), /99%|synthetic|private/);
  s.advance(60_000);
  await runUsageReport(s.options);
  assert.equal(s.reports.at(-1)[1], "limits stale · 4m ago");
  // A stale marker must not become a cache hit; a subsequent success replaces it.
  await runUsageReport({ ...s.options, fetch: async () => normalizeCodex({ rate_limit: { primary_window: { used_percent: 50 } } }) });
  assert.equal(s.reports.at(-1)[1], "fresh · Primary 50%");
  assert.equal(s.cache.providers.codex.stale, undefined);
});

test("successful Codex response without rate limits stays explicitly unavailable", async () => {
  const s = scenario({ fetch: async () => normalizeCodex({}) });
  await runUsageReport(s.options);
  assert.deepEqual(s.reports, [["w1:p1", "limits refreshing", 120_000], ["w1:p1", "limits unavailable", 120_000]]);
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
  assert.deepEqual(s.reports, [
    ["w1:p2", "limits refreshing", 120_000],
    ["w1:p1", "limits stale · 2m ago", 120_000], ["w1:p2", "fresh · 5h 50%", 120_000],
  ]);
});

test("freshness snapshots handle exact expiry, absent data and future timestamps", () => {
  const cached = { fetchedAt: 1000, token: "5h 0%" };
  assert.equal(usageDisplay(cached, 1000), "fresh · 5h 0%");
  assert.equal(usageDisplay(cached, 2000), "fresh 1s ago · 5h 0%");
  assert.equal(usageDisplay(cached, 120_999), "fresh 1m ago · 5h 0%");
  assert.equal(usageDisplay(cached, 121_000), "limits stale · 2m ago");
  for (const value of [undefined, {}, { fetchedAt: 1000 }, { fetchedAt: 1000, token: "usage unavailable" }]) {
    assert.equal(usageDisplay(value, 1000), "limits unavailable");
  }
  assert.equal(usageDisplay(cached, 999), "limits unavailable");
  assert.equal(usageDisplay({ fetchedAt: 1000, stale: true }, 31_000), "limits stale · 30s ago");
});

test("refreshing is published before waiting for the provider", async () => {
  const s = scenario();
  s.options.fetch = async () => {
    assert.deepEqual(s.reports, [["w1:p1", "limits refreshing", 120_000]]);
    return normalizeCodex({});
  };
  await runUsageReport(s.options);
  assert.equal(s.reports.at(-1)[1], "limits unavailable");
});

test("failed refresh across account revisions or future timestamps cannot retain another quota's age", async () => {
  for (const cached of [
    { fetchedAt: 1_699_999_800_000, revision: "other-account", token: "5h 99%" },
    { fetchedAt: 1_700_000_000_001, revision: "revision-1", token: "5h 99%" },
    { fetchedAt: 1_699_999_800_000, revision: "revision-1", token: "usage unavailable" },
  ]) {
    const s = scenario({ fetch: async () => { throw new Error("synthetic"); } });
    s.cache.providers.codex = cached;
    await runUsageReport(s.options);
    assert.equal(s.reports.at(-1)[1], "limits unavailable");
    assert.equal(s.cache.providers.codex, undefined);
  }
});

test("manual failure invalidates even still-fresh quota and unknown revision cannot retain it", async () => {
  for (const revision of ["revision-1", undefined]) {
    const s = scenario({ forceRefresh: true, revisionFor: () => revision, fetch: async () => { throw new Error("synthetic"); } });
    s.cache.providers.codex = { fetchedAt: 1_699_999_970_000, revision: "revision-1", token: "5h 99%" };
    await runUsageReport(s.options);
    assert.equal(s.reports.at(-1)[1], revision ? "limits stale · 30s ago" : "limits unavailable");
    assert.doesNotMatch(s.reports.at(-1)[1], /99%/);
  }
});

test("all supported providers get unavailable instead of a silent empty token", async () => {
  const s = scenario({
    listPanes: () => ["claude", "cursor", "codex"].map((agent) => ({ pane_id: `w1:${agent}`, agent })),
    credentials: () => undefined,
  });
  await runUsageReport(s.options);
  assert.deepEqual(s.reports, ["claude", "cursor", "codex"].map((provider) => [`w1:${provider}`, "limits unavailable", 120_000]));
});

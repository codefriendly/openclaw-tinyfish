import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import Ajv from "ajv";
import {
  Client,
  TinyFishError,
  cacheIdentity,
  publicUrlSyntax,
  type Dependencies,
  type Options,
} from "../src/client.js";
import { mapSearch, searchSchema } from "../src/mapping.js";
import {
  boundedJson,
  dependencies,
  highlightsSchema,
  register,
  transport,
  type PluginApi,
} from "../src/index.js";
const page = {
  url: "https://example.com/",
  final_url: "https://example.org/",
  text: "# Hello",
  title: "Example",
};
function fixture(data: unknown, options: Options = {}) {
  const calls: any[] = [];
  const deps: Dependencies = {
    transport: async (url, init, signal, limit) => {
      calls.push({ url, init, signal, limit });
      return { status: 200, headers: new Headers(), data };
    },
    publicUrl: async (u) => u,
    markdownToText: (s) => s.replace("# ", ""),
    wrap: (s) => "[untrusted]" + s + "[/untrusted]",
  };
  return {
    client: new Client({ apiKey: "fixture-key", ...options }, deps),
    calls,
    deps,
  };
}
test("search maps all supported fields and aliases without embedded fetch", () => {
  const m = mapSearch({
    query: "q",
    count: 2,
    country: "US",
    language: "en",
    include_domains: "b.org,a.org",
    exclude_domains: "c.org",
    freshness: "week",
    domain_type: "news",
    page: 2,
    purpose: "compare",
  });
  assert.deepEqual(m, {
    count: 2,
    request: {
      query: "q",
      purpose: "compare",
      location: "US",
      language: "en",
      include_domains: "a.org,b.org",
      exclude_domains: "c.org",
      domain_type: "news",
      recency_minutes: "10080",
      page: "2",
    },
  });
  assert.equal(
    mapSearch({ query: "q", date_after: "2024-02-29" }).request.after_date,
    "2024-02-29",
  );
  assert.equal(
    mapSearch({
      query: "q",
      domain_type: "research_paper",
      pub_year_min: 0,
      pub_year_max: 2026,
    }).request.pub_year_min,
    "0",
  );
});
for (const input of [
  { count: 0 },
  { page: 11 },
  { query: "" },
  { purpose: " " },
  { date_after: "2024-02-30" },
  { after_date: "2026-02-01", before_date: "2026-01-01" },
  { recency_minutes: 1, after_date: "2026-01-01" },
  { domain_type: "research_paper", freshness: "day" },
  { pub_year_min: 2020 },
  { domain_type: "research_paper", pub_year_min: 2025, pub_year_max: 2020 },
  { include_domains: "a.org", exclude_domains: "a.org" },
  { country: "US", location: "US" },
  { fetch: {} },
  { include_domains: "a.org/path" },
  { query: "hello\nworld" },
])
  test("reject filter conflict " + JSON.stringify(input), () =>
    assert.throws(() => mapSearch({ query: "q", ...input })),
  );
test("cache identity separates all filters, counts, credentials", () => {
  const base = cacheIdentity("a", mapSearch({ query: "q" }));
  for (const x of [
    { count: 2 },
    { page: 1 },
    { country: "DE" },
    { language: "de" },
    { purpose: "other" },
    { include_domains: "a.org" },
    { exclude_domains: "a.org" },
    { freshness: "day" },
    { date_before: "2026-01-01" },
    { domain_type: "news" },
    { domain_type: "research_paper", pub_year_max: 2020 },
  ])
    assert.notEqual(base, cacheIdentity("a", mapSearch({ query: "q", ...x })));
  assert.notEqual(base, cacheIdentity("b", mapSearch({ query: "q" })));
});
test("search endpoint, output count and cache separation", async () => {
  const f = fixture(
    {
      results: [
        {
          url: "https://example.com/",
          title: "Title",
          snippet: "Snippet",
          site_name: "Example",
          date: "2026-10-23",
          authors: ["not normalized"],
        },
      ],
    },
    { cacheTtlMs: 60000 },
  );
  const a: any = await f.client.search({ query: "q" });
  assert.equal(a.results[0].published, "2026-10-23");
  assert.deepEqual(a.results[0].authors, ["not normalized"]);
  assert.equal(((await f.client.search({ query: "q" })) as any).cached, true);
  assert.equal(f.calls.length, 1);
  await f.client.search({ query: "q", page: 1 });
  assert.equal(f.calls.length, 2);
  assert.equal(new URL(f.calls[0].url).hostname, "api.search.tinyfish.ai");
  assert.equal(f.calls[0].init.redirect, "error");
});
test("cache disabled does not reuse", async () => {
  const f = fixture({ results: [] });
  await f.client.search({ query: "q" });
  await f.client.search({ query: "q" });
  assert.equal(f.calls.length, 2);
});
test("fetch markdown/text, redirect metadata and no beta flag", async () => {
  const f = fixture({ results: [page], errors: [] });
  const r = await f.client.fetch({ url: page.url, extractMode: "text" });
  assert.equal(r.text, "Hello");
  assert.equal(r.finalUrl, page.final_url);
  const p = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(p.urls, [page.url]);
  assert.equal(p.format, "markdown");
  assert.equal(p.highlights, undefined);
  assert.equal(p.render, undefined);
});
test("fetch truncates output and preserves original size", async () => {
  const f = fixture({
    results: [{ ...page, text: "x".repeat(500) }],
    errors: [],
  });
  const r = await f.client.fetch({ url: page.url, maxChars: 100 });
  assert.equal(r.text.length, 100);
  assert.equal(r.rawLength, 500);
  assert.equal(r.truncated, true);
});
test("per URL error sanitized", async () => {
  const f = fixture({
    results: [],
    errors: [
      {
        url: page.url,
        error: "page_not_found",
        status: 404,
        message: "fixture-key",
      },
    ],
  });
  await assert.rejects(
    f.client.fetch({ url: page.url }),
    /page_not_found.*404/,
  );
});
test("invalid response fails closed", async () => {
  for (const data of [
    { results: null },
    { results: [{ url: page.url }] },
    { results: [], errors: [] },
  ]) {
    const f = fixture(data);
    await assert.rejects(f.client.fetch({ url: page.url }));
  }
});
test("missing and unresolved credentials never dispatch", async () => {
  for (const apiKey of [
    undefined,
    { source: "exec", provider: "x", id: "y" },
    "bad\rkey",
  ]) {
    const f = fixture({}, { apiKey });
    await assert.rejects(f.client.search({ query: "q" }));
    assert.equal(f.calls.length, 0);
  }
});
test("reflected provider and network errors never expose credential", async () => {
  const f = fixture({});
  f.deps.transport = async () => {
    throw new Error("fixture-key reflected");
  };
  await assert.rejects(
    f.client.search({ query: "q" }),
    (e) => !String(e).includes("fixture-key"),
  );
});
for (const status of [401, 402, 403, 429, 500, 503])
  test("HTTP safe error " + status, async () => {
    const f = fixture({});
    f.deps.transport = async () => ({
      status,
      headers: new Headers(),
      data: { message: "fixture-key" },
    });
    await assert.rejects(
      f.client.search({ query: "q" }),
      new RegExp(String(status)),
    );
  });
test("429 enforces cooldown and never retries", async () => {
  const f = fixture({});
  let calls = 0;
  f.deps.transport = async () => {
    calls++;
    return {
      status: 429,
      headers: new Headers({ "retry-after": "120" }),
      data: null,
    };
  };
  await assert.rejects(f.client.search({ query: "q" }));
  await assert.rejects(f.client.search({ query: "q2" }), /rate_limited/);
  assert.equal(calls, 1);
});
test("local search budget caps at 30 requests per key", async () => {
  const f = fixture({ results: [] });
  for (let i = 0; i < 30; i++) await f.client.search({ query: "q" + i });
  await assert.rejects(f.client.search({ query: "overflow" }), /rate_limited/);
  assert.equal(f.calls.length, 30);
});
test("cancellation before request and cached result", async () => {
  const f = fixture({ results: [] }, { cacheTtlMs: 1000 });
  await f.client.search({ query: "q" });
  const a = new AbortController();
  a.abort(new Error("private abort reason"));
  for (const query of ["q", "uncached"])
    await assert.rejects(
      f.client.search({ query }, a.signal),
      (e: unknown) =>
        e instanceof TinyFishError &&
        e.code === "cancelled" &&
        e.message === "TinyFish cancelled",
    );
  assert.equal(f.calls.length, 1);
});
test("timeout and in-flight cancellation", async () => {
  for (const cancelled of [false, true]) {
    const f = fixture({}, { timeoutMs: cancelled ? 1000 : 5 });
    f.deps.transport = async (_u, _i, s) => {
      await delay(1000, undefined, { signal: s });
      throw new Error("late");
    };
    const a = new AbortController();
    const keep = setTimeout(() => {}, 100);
    const pending = f.client.search({ query: "q" }, a.signal);
    if (cancelled) a.abort(new Error("private abort reason"));
    const code = cancelled ? "cancelled" : "timeout";
    await assert.rejects(
      pending,
      (e: unknown) =>
        e instanceof TinyFishError &&
        e.code === code &&
        e.message === "TinyFish " + code,
    );
    clearTimeout(keep);
  }
});
test("URL lexical safety and raw file routing", () => {
  for (const u of [
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "http://localhost/",
    "https://example.com/a.pdf",
    "https://example.com:444/",
    "https://x.internal/",
  ])
    assert.throws(() => publicUrlSyntax(u));
});
test("SDK URL guard blocks private targets without provider calls", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://[::1]/",
  ])
    await assert.rejects(
      dependencies.publicUrl(url, new AbortController().signal),
    );
});
test("unsafe redirect is rejected", async () => {
  const f = fixture({ results: [page], errors: [] });
  f.deps.publicUrl = async (u) => {
    if (u === page.final_url) throw new Error("blocked");
    return u;
  };
  await assert.rejects(f.client.fetch({ url: page.url }));
});
test("bounded JSON limits and malformed JSON", async () => {
  await assert.rejects(
    boundedJson(
      new Response("x".repeat(2000)),
      100,
      new AbortController().signal,
    ),
    /response_too_large/,
  );
  await assert.rejects(
    boundedJson(new Response("not json"), 100, new AbortController().signal),
  );
  assert.deepEqual(
    await boundedJson(new Response("{}"), 100, new AbortController().signal),
    {},
  );
});
test("fixed endpoint guard rejects credential egress overrides", async () => {
  await assert.rejects(
    transport("https://evil.example/", {}, new AbortController().signal, 100),
  );
});
test("highlights opt-in and account refusal are distinct", async () => {
  const f = fixture({});
  await assert.rejects(
    f.client.highlights({ urls: [page.url], question: "q" }),
    /highlights_disabled/,
  );
  const g = fixture({}, { enableHighlights: true });
  g.deps.transport = async () => ({
    status: 403,
    headers: new Headers(),
    data: null,
  });
  await assert.rejects(
    g.client.highlights({ urls: [page.url], question: "q" }),
    /highlights_not_enabled/,
  );
});
test("highlights distinguish passages, empty, absent, errors; hard budget", async () => {
  for (const [entry, state] of [
    [{ highlights: [{ text: "x".repeat(1000), rank: 1 }] }, "passages"],
    [{ highlights: [] }, "empty"],
    [{}, "absent"],
  ] as const) {
    const f = fixture(
      { results: [{ ...page, ...entry }], errors: [] },
      { enableHighlights: true },
    );
    const r = await f.client.highlights({
      urls: [page.url],
      question: "topic",
      maxCharacters: 300,
    });
    assert.equal(r.results[0].state, state);
    if (state === "passages") {
      assert.equal(r.results[0].truncated, true);
      assert.match(r.results[0].passages![0].text, /untrusted/);
    }
  }
  const f = fixture(
    { results: [], errors: [{ url: page.url, error: "timeout" }] },
    { enableHighlights: true },
  );
  assert.equal(
    (await f.client.highlights({ urls: [page.url], question: "q" })).results[0]
      .state,
    "error",
  );
});
test("highlights input bounds", async () => {
  const f = fixture({}, { enableHighlights: true });
  for (const args of [
    { urls: [], question: "q" },
    { urls: Array(4).fill(page.url), question: "q" },
    { urls: [page.url], question: " " },
    { urls: [page.url], question: "q", maxCharacters: 299 },
  ])
    await assert.rejects(f.client.highlights(args));
  assert.equal(f.calls.length, 0);
});
test("schemas and native registration", async () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
  );
  const ajv = new Ajv();
  const config = ajv.compile(manifest.configSchema);
  assert(
    config({
      apiKey: { source: "store", provider: "default", id: "TINYFISH_API_KEY" },
    }),
  );
  assert(
    !config({
      apiKey: {
        source: "unknown",
        provider: "default",
        id: "TINYFISH_API_KEY",
      },
    }),
  );
  assert(
    config({
      apiKey: { source: "env", provider: "default", id: "TINYFISH_API_KEY" },
    }),
  );
  assert(!config({ apiKey: 42 }));
  assert(!config({ baseUrl: "https://evil.example" }));
  assert(ajv.compile(searchSchema)({ query: "q" }));
  assert(!ajv.compile(searchSchema)({ query: "q", fetch: {} }));
  assert(!ajv.compile(highlightsSchema)({ urls: [], question: "q" }));
  let search: any, fetch: any;
  const tools: any[] = [];
  const f = fixture({ results: [] });
  const api: PluginApi = {
    pluginConfig: { apiKey: "fixture-key" },
    registerWebSearchProvider: (p) => (search = p),
    registerWebFetchProvider: (p) => (fetch = p),
    registerTool: (t) => tools.push(t),
  };
  register(api, f.deps);
  assert.equal(search.id, "tinyfish");
  assert.equal(fetch, undefined);
  assert.equal(tools.length, 1);
  assert.deepEqual(manifest.contracts.webSearchProviders, [search.id]);
  assert.equal((await search.createTool({}).execute({ query: "q" })).count, 0);
  api.pluginConfig!.enableHighlights = true;
  register(api, f.deps);
  assert.equal(
    tools[1]({ sandboxed: false }).find(
      (t: any) => t.name === "tinyfish_highlights",
    ).name,
    "tinyfish_highlights",
  );
  api.pluginConfig!.enableNativeFetch = true;
  register(api, f.deps);
  assert.equal(fetch.id, "tinyfish");
  assert(fetch.createTool({}).parameters);
});

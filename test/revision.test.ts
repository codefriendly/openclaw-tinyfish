import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { Client, type Dependencies } from "../src/client.js";
import { register, type PluginApi } from "../src/index.js";
import { fetchSchema } from "../src/schemas.js";
import { searchSchema, mapSearch } from "../src/mapping.js";
const urls = [
  "https://example.com/a",
  "https://example.com/b",
  "https://example.com/c",
];
function fixture(data: unknown) {
  const calls: any[] = [];
  const deps: Dependencies = {
    transport: async (...a) => {
      calls.push(a);
      return { status: 200, headers: new Headers(), data };
    },
    publicUrl: async (u) => {
      if (u.includes("127.0.0.1")) throw Error("private");
      return u;
    },
    markdownToText: (s) => s,
    wrap: (s) => "untrusted:" + s,
  };
  return { deps, calls, client: new Client({ apiKey: "fixture-key" }, deps) };
}
test("batch mixed results preserve order, sanitize errors, and share budget", async () => {
  const f = fixture({
    results: [
      { url: urls[2], text: "c".repeat(100) },
      { url: urls[0], text: "a".repeat(80) },
    ],
    errors: [{ url: urls[1], error: "timeout", message: "fixture-key" }],
  });
  const r = await f.client.fetchBatch({ urls, maxChars: 100 });
  assert.deepEqual(
    r.results.map((x) => x.state),
    ["success", "error", "success"],
  );
  assert.deepEqual(
    r.results.map((x) => x.index),
    [0, 1, 2],
  );
  assert.equal(r.results[0].text?.length, 80);
  assert.equal(r.results[2].text?.length, 20);
  assert.equal(r.outputChars, 100);
  assert.equal(r.results[2].truncated, true);
  assert(!JSON.stringify(r).includes("fixture-key"));
  assert.equal(f.calls.length, 1);
});
test("batch bounds strict options and conditional validators", async () => {
  const f = fixture({ results: [], errors: [] });
  for (const args of [
    { urls: [] },
    { urls: Array(11).fill(urls[0]) },
    { urls, maxChars: 99 },
    { urls, if_none_match: "x" },
    { urls, include_selectors: [] },
    { urls, links: "yes" },
    { urls, render: true },
    { urls, highlights: {} },
  ])
    await assert.rejects(f.client.fetchBatch(args));
  assert.equal(f.calls.length, 0);
  const validate = new Ajv().compile(fetchSchema);
  assert(validate({ urls }));
  assert(!validate({ urls: Array(11).fill(urls[0]) }));
});
test("unsafe input and redirects are per-url errors; safe remainder dispatches", async () => {
  const f = fixture({
    results: [
      { url: urls[0], text: "safe" },
      { url: urls[1], final_url: "http://127.0.0.1/", text: "private" },
    ],
    errors: [],
  });
  const r = await f.client.fetchBatch({
    urls: ["http://127.0.0.1/", ...urls.slice(0, 2)],
  });
  assert.deepEqual(
    r.results.map((x) => x.state),
    ["error", "success", "error"],
  );
  assert(!JSON.parse(f.calls[0][1].body).urls.includes("http://127.0.0.1/"));
});
test("fetch advanced options forwarded; JSON tree and metadata bounded", async () => {
  const f = fixture({
    results: [
      {
        url: urls[0],
        text: { body: "x".repeat(300) },
        author: "a".repeat(2000),
        page_metadata: { og: "x".repeat(5000) },
        not_modified: false,
      },
    ],
    errors: [],
  });
  const args = {
    urls: [urls[0]],
    format: "json",
    maxChars: 100,
    purpose: "read",
    links: true,
    image_links: true,
    iframe_links: true,
    page_metadata: true,
    ttl: 0,
    per_url_timeout_ms: 1000,
    include_etag_and_last_modified: true,
    if_none_match: "etag",
    if_modified_since: "date",
    include_selectors: ["main"],
    exclude_selectors: ["nav"],
  };
  const r = await f.client.fetchBatch(args);
  const payload = JSON.parse(f.calls[0][1].body);
  for (const [k, v] of Object.entries(args))
    if (!["maxChars"].includes(k)) assert.deepEqual(payload[k], v);
  assert.equal(r.results[0].text?.length, 100);
  assert.equal(r.results[0].author?.length, 512);
  assert.equal(r.results[0].page_metadata?.length, 2000);
});
test("complete search metadata is bounded, absent omitted, credential reflection removed", async () => {
  const f = fixture({
    results: [
      {
        url: urls[0],
        title: "fixture-key",
        snippet: "S",
        authors: Array(100).fill("a".repeat(300)),
        year: 2026,
        cited_by_count: 12,
        venue: "V",
        publisher: "P",
        pdf_url: "https://example.com/a.pdf",
        thumbnail_url: "https://example.com/a.png",
      },
    ],
    total_results: 100,
    page: 2,
  });
  const r: any = await f.client.search({
    query: "q",
    domain_type: "research_paper",
    pub_year_min: 2020,
    include_thumbnail: true,
  });
  const x = r.results[0];
  assert.equal(x.authors.length, 30);
  assert.equal(x.authors[0].length, 200);
  for (const k of [
    "year",
    "cited_by_count",
    "venue",
    "publisher",
    "pdf_url",
    "thumbnail_url",
  ])
    assert(x[k] !== undefined);
  assert.equal(r.total_results, 100);
  assert(!JSON.stringify(r).includes("fixture-key"));
  assert.equal(
    mapSearch({ query: "q", include_thumbnail: false }).request
      .include_thumbnail,
    "false",
  );
  assert(!new Ajv().compile(searchSchema)({ query: "q", page: 11 }));
});
test("credential redaction handles JSON escaping in values and metadata keys", async () => {
  for (const key of ["fixture-key", 'key"with-quote', "key\\with-slash"]) {
    const document = {
      [key]: ["before " + key + " after " + key, { count: 3, ready: true }],
      unchanged: 'Quote " and backslash \\',
    };
    const f = fixture({
      results: [
        {
          url: urls[0],
          title: key,
          snippet: "before " + key + " after " + key,
          authors: [key],
          text: document,
          page_metadata: document,
        },
      ],
      errors: [],
    });
    const client = new Client({ apiKey: key }, f.deps);
    const search = await client.search({ query: "q" });
    assert.equal(search.results[0].title, "[REDACTED]");
    assert.equal(
      search.results[0].snippet,
      "before [REDACTED] after [REDACTED]",
    );
    assert.deepEqual(search.results[0].authors, ["[REDACTED]"]);
    const fetched = await client.fetchBatch({
      urls: [urls[0]],
      format: "json",
    });
    assert.equal(fetched.results[0].state, "success");
    const expected = {
      "[REDACTED]": [
        "before [REDACTED] after [REDACTED]",
        { count: 3, ready: true },
      ],
      unchanged: 'Quote " and backslash \\',
    };
    assert.deepEqual(JSON.parse(String(fetched.results[0].text)), expected);
    assert.deepEqual(
      JSON.parse(String(fetched.results[0].page_metadata)),
      expected,
    );
  }
});
test("registration defaults, sandbox denial, wrapping all metadata, shared credential", async () => {
  const f = fixture({
    results: [
      { url: urls[0], title: "INJECT", snippet: "S", authors: ["META"] },
    ],
  });
  let search: any, fetch: any, factory: any;
  const cfg: any = { apiKey: "fixture-key" };
  const api: PluginApi = {
    pluginConfig: cfg,
    registerWebSearchProvider: (p) => (search = p),
    registerWebFetchProvider: (p) => (fetch = p),
    registerTool: (t) => (factory = t),
  };
  register(api, f.deps);
  assert(search);
  assert.equal(fetch, undefined);
  assert.deepEqual(search.onboardingScopes, ["text-inference"]);
  assert(search.createTool({}).parameters);
  assert.equal(factory({ sandboxed: true }), null);
  assert.equal(factory({}), null);
  const tools = factory({ sandboxed: false });
  assert.deepEqual(
    tools.map((x: any) => x.name),
    ["tinyfish_search", "tinyfish_fetch"],
  );
  const out = await tools[0].execute("id", { query: "q" });
  assert(out.content[0].text.includes("EXTERNAL_UNTRUSTED_CONTENT"));
  assert(out.details.text.includes("META"));
  assert.equal(out.details.results, undefined);
  const config: any = {};
  search.setConfiguredCredentialValue(config, "other");
  assert.equal(search.getConfiguredCredentialValue(config), "other");
  assert.equal(search.getCredentialValue({ apiKey: "wrong" }), undefined);
  cfg.enableNativeFetch = true;
  cfg.enableHighlights = true;
  register(api, f.deps);
  assert(fetch.createTool({}).parameters);
  assert(
    factory({ sandboxed: false }).some(
      (x: any) => x.name === "tinyfish_highlights",
    ),
  );
});
test("direct tools recheck authority and resolved credential rotation partitions cache", async () => {
  const f = fixture({ results: [] });
  let factory: any;
  register(
    {
      pluginConfig: { apiKey: "fixture-key" },
      registerWebSearchProvider() {},
      registerWebFetchProvider() {},
      registerTool: (t) => (factory = t),
    },
    f.deps,
  );
  let current = true;
  let key = "key-a";
  const tools = factory({
    sandboxed: false,
    assertInvocationCurrent() {
      if (!current) throw Error("stale");
    },
    getRuntimeConfig: () => ({
      plugins: {
        entries: { tinyfish: { config: { apiKey: key, cacheTtlMs: 1000 } } },
      },
    }),
  });
  await tools[0].execute("id", { query: "q" });
  await tools[0].execute("id", { query: "q" });
  key = "key-b";
  await tools[0].execute("id", { query: "q" });
  assert.equal(f.calls.length, 2);
  current = false;
  await assert.rejects(tools[0].execute("id", { query: "q" }), /stale/);
  assert.equal(f.calls.length, 2);
});

test("standalone batch complete serialized envelope cap retains ten outcomes", async () => {
  const targets = Array.from(
    { length: 10 },
    (_, i) => "https://example.com/" + i,
  );
  const f = fixture({
    results: targets.map((url) => ({
      url,
      text: '"\n'.repeat(10000),
      title: "meta".repeat(1000),
      author: "author".repeat(1000),
    })),
    errors: [],
  });
  let factory: any;
  register(
    {
      pluginConfig: { apiKey: "fixture-key" },
      registerWebSearchProvider() {},
      registerWebFetchProvider() {},
      registerTool: (t) => (factory = t),
    },
    f.deps,
  );
  const out = await factory({ sandboxed: false })[1].execute("id", {
    urls: targets,
    maxChars: 100000,
    maxOutputChars: 4000,
  });
  const text = out.content[0].text;
  const start = text.indexOf('{"provider"'),
    end = text.lastIndexOf("}");
  const envelope = JSON.parse(text.slice(start, end + 1));
  assert(JSON.stringify(envelope).length <= 4000);
  assert.equal(envelope.results.length, 10);
  assert(envelope.metadataTruncated);
  assert(envelope.results.every((r: any) => r.state === "success"));
});
test("batch cancellation never returns partial provider data", async () => {
  const f = fixture({ results: [], errors: [] });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.client.fetchBatch({ urls }, controller.signal));
  assert.equal(f.calls.length, 0);
});

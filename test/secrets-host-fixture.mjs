import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
const project = fileURLToPath(new URL("../", import.meta.url));
const temp = fs.mkdtempSync(path.join(project, ".host-secrets-"));
for (const key of Object.keys(process.env))
  if (key.startsWith("OPENCLAW_") || key === "TINYFISH_API_KEY")
    delete process.env[key];
Object.assign(process.env, {
  HOME: temp,
  OPENCLAW_STATE_DIR: path.join(temp, "state"),
  OPENCLAW_CONFIG_PATH: path.join(temp, "config.json"),
  OPENCLAW_BUNDLED_PLUGINS_DIR: path.join(temp, "bundled"),
});
fs.mkdirSync(process.env.OPENCLAW_BUNDLED_PLUGINS_DIR, { recursive: true });
const host = fs.realpathSync(path.join(project, "node_modules/openclaw"));
const load = (name) => import(pathToFileURL(path.join(host, "dist", name)));
let value = "synthetic-A",
  resolutions = 0,
  calls = 0;
// Replace exactly the installed host resolver boundary; never read a store.
registerHooks({
  load(url, context, next) {
    if (
      url === pathToFileURL(path.join(host, "dist/resolve-BfyOXTHL.mjs")).href
    )
      return {
        format: "module",
        shortCircuit: true,
        source:
          'export const r = globalThis.__tinyfishResolve; export const i = async(refs,opts)=>({resolved:await r(refs,opts),failures:[]}); export const n = async(ref,opts)=>(await r([ref],opts)).get([ref.source,ref.provider,ref.id].join(":")); export const t=n;',
      };
    return next(url, context);
  },
});
globalThis.__tinyfishResolve = async (refs) => {
  resolutions++;
  const out = new Map();
  for (const ref of refs) {
    assert.deepEqual(ref, {
      source: "store",
      provider: "default",
      id: "SYNTHETIC_TINYFISH",
    });
    if (!value) throw Error("synthetic revoked");
    out.set("store:default:SYNTHETIC_TINYFISH", value);
  }
  return out;
};
globalThis.fetch = Object.assign(
  async (input, init) => {
    calls++;
    assert.equal(new Headers(init.headers).get("x-api-key"), value);
    assert(
      ["api.search.tinyfish.ai", "api.fetch.tinyfish.ai"].includes(
        new URL(String(input)).hostname,
      ),
    );
    return new Response(JSON.stringify({ results: [], errors: [] }), {
      headers: { "content-type": "application/json" },
    });
  },
  { mock: {} },
);
// Hard egress denial beneath the recognized fetch mock too.
const net = await import("node:net");
net.default.Socket.prototype.connect = function () {
  throw Error("OFFLINE: socket denied");
};
const dns = await import("node:dns");
dns.default.lookup = (_h, opts, cb) => {
  const done = typeof opts === "function" ? opts : cb;
  queueMicrotask(() =>
    opts?.all
      ? done(null, [{ address: "93.184.216.34", family: 4 }])
      : done(null, "93.184.216.34", 4),
  );
};
dns.default.promises.lookup = async (_h, opts) =>
  opts?.all
    ? [{ address: "93.184.216.34", family: 4 }]
    : { address: "93.184.216.34", family: 4 };
const { syncBuiltinESMExports } = await import("node:module");
syncBuiltinESMExports();
try {
  const config = {
    plugins: {
      allow: ["tinyfish"],
      load: { paths: [project] },
      entries: {
        tinyfish: {
          enabled: true,
          config: {
            apiKey: {
              source: "store",
              provider: "default",
              id: "SYNTHETIC_TINYFISH",
            },
          },
        },
      },
    },
    tools: {
      web: {
        search: {
          enabled: true,
          provider: "tinyfish",
          openaiCodex: { enabled: false },
        },
      },
    },
    agents: { defaults: { workspace: temp } },
  };
  fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
  const { a: prepare } = await load("runtime-LEQK1wzy.mjs");
  const { c: metadata } = await load(
    "manifest-contract-eligibility-Y310XHNL.mjs",
  );
  const records = metadata({ config, env: process.env }).manifestRegistry;
  assert(
    records.plugins.some(
      (p) => p.id === "tinyfish" && p.configContracts?.secretInputs,
    ),
  );
  const snapshot = await prepare({
    config,
    includeAuthStoreRefs: false,
    env: process.env,
  });
  console.log(
    "snapshot evidence",
    JSON.stringify({
      resolutions,
      warnings: snapshot.warnings,
      owners: snapshot.secretOwners.map((x) => x.ownerId),
      metadata: snapshot.webTools,
      materialized:
        typeof snapshot.config.plugins.entries.tinyfish.config.apiKey ===
        "string",
    }),
  );
  assert.equal(snapshot.config.plugins.entries.tinyfish.config.apiKey, value);
  assert.equal(snapshot.webTools.search.selectedProvider, "tinyfish");
  const { c: run } = await load("runtime-FWv3S0OT.mjs");
  assert.equal(
    (
      await run({
        config: snapshot.config,
        preferInputConfig: true,
        args: { query: "fixture" },
      })
    ).provider,
    "tinyfish",
  );
  // Load our actual standalone factories through the installed host loader.
  const { i: loader } = await load("loader-runtime-load-Beko2JVf.mjs");
  const registry = loader({
    config: snapshot.config,
    activationSourceConfig: config,
    env: process.env,
    onlyPluginIds: ["tinyfish"],
    activate: false,
    cache: false,
  });
  let current = snapshot.config;
  const entry = registry.tools.find((t) => t.pluginId === "tinyfish");
  assert(entry);
  const tools = entry.factory({
    config,
    runtimeConfig: snapshot.config,
    getRuntimeConfig: () => current,
    sandboxed: false,
  });
  const search = tools.find((t) => t.name === "tinyfish_search");
  const fetchTool = tools.find((t) => t.name === "tinyfish_fetch");
  assert(search && fetchTool);
  const firstResult = await search.execute("a", { query: "fixture" });
  assert(!JSON.stringify(firstResult).includes(value));
  await fetchTool.execute("a", { urls: ["https://example.com/"] });
  value = "synthetic-B";
  const rotated = await prepare({
    config,
    includeAuthStoreRefs: false,
    env: process.env,
  });
  current = rotated.config;
  await search.execute("b", { query: "fixture" });
  await fetchTool.execute("b", { urls: ["https://example.com/"] });
  await run({
    config: current,
    preferInputConfig: true,
    args: { query: "fixture" },
  });
  // Shared manifest-owned key still materializes when native search is disabled.
  const standalone = structuredClone(config);
  standalone.tools.web.search.enabled = false;
  delete standalone.tools.web.search.provider;
  const standaloneSnapshot = await prepare({
    config: standalone,
    includeAuthStoreRefs: false,
    env: process.env,
  });
  assert.equal(
    standaloneSnapshot.config.plugins.entries.tinyfish.config.apiKey,
    value,
  );
  current = standaloneSnapshot.config;
  await search.execute("standalone", { query: "fixture" });
  await fetchTool.execute("standalone", { urls: ["https://example.com/"] });
  assert.equal(calls, 8);
  const before = calls;
  // Unknown/unresolved refs and revoked/missing snapshots cannot reuse old clients.
  for (const revoked of [
    config,
    {},
    { plugins: { entries: { tinyfish: { config: {} } } } },
    undefined,
  ]) {
    current = revoked;
    await assert.rejects(search.execute("revoked", { query: "fixture" }));
    await assert.rejects(
      fetchTool.execute("revoked", { urls: ["https://example.com/"] }),
    );
  }
  assert.equal(calls, before);
  for (const raw of [config, {}])
    await assert.rejects(
      run({ config: raw, preferInputConfig: true, args: { query: "fixture" } }),
    );
  assert.equal(calls, before);
  value = undefined;
  await assert.rejects(
    prepare({ config, includeAuthStoreRefs: false, env: process.env }),
  );
  assert.equal(calls, before);
  // Reproduce the reported diagnostic with an explicitly incomplete host inventory.
  // No plugin edit can fill a supplied immutable metadata snapshot from its register().
  const missing = {
    plugins: records.plugins.filter((p) => p.id !== "tinyfish"),
    diagnostics: [],
  };
  const excluded = await prepare({
    config,
    includeAuthStoreRefs: false,
    env: process.env,
    manifestRegistry: missing,
  });
  assert(
    excluded.warnings.some(
      (w) => w.code === "WEB_SEARCH_PROVIDER_INVALID_AUTODETECT",
    ),
  );
  assert.equal(
    typeof excluded.config.plugins.entries.tinyfish.config.apiKey,
    "object",
  );
  assert.equal(excluded.secretOwners.length, 0);
  console.log(
    "PASS installed host materialization/native/standalone/rotation/revocation/shared-key; incomplete inventory reproduces unresolved-ref diagnostic; zero sockets",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

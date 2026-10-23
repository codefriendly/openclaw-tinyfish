import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
const project = fileURLToPath(new URL("../", import.meta.url));
const temp = fs.mkdtempSync(path.join(project, ".host-fixture-"));
process.env.HOME = temp;
process.env.OPENCLAW_STATE_DIR = path.join(temp, "state");
process.env.OPENCLAW_CONFIG_PATH = path.join(temp, "config.json");
process.env.OPENCLAW_BUNDLED_PLUGINS_DIR = path.join(temp, "empty-bundled");
delete process.env.TINYFISH_API_KEY;
// Deny all actual socket connections even if a host layer ignores fetch.mock.
const net = await import("node:net");
net.default.Socket.prototype.connect = function () {
  throw Error("OFFLINE: socket denied");
};
fs.mkdirSync(process.env.OPENCLAW_BUNDLED_PLUGINS_DIR, { recursive: true });
const host = fs.realpathSync(path.join(project, "node_modules/openclaw"));
const load = async (name) =>
  import(pathToFileURL(path.join(host, "dist", name)));
let calls = 0;
globalThis.fetch = Object.assign(
  async (input, init) => {
    assert.equal(
      String(input),
      "https://api.search.tinyfish.ai/?query=fixture",
    );
    assert.equal(
      new Headers(init.headers).get("x-api-key"),
      "offline-fixture-not-a-real-key",
    );
    calls++;
    return new Response(JSON.stringify({ results: [] }), {
      headers: { "content-type": "application/json" },
    });
  },
  { mock: {} },
);

try {
  const config = {
    plugins: {
      allow: ["tinyfish"],
      load: { paths: [project] },
      entries: { tinyfish: { enabled: true, config: {} } },
    },
    tools: { web: { search: { enabled: true } } },
    agents: { defaults: { workspace: temp } },
  };
  fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
  const { i: options, a: setup } = await load("search-setup-BsW5NUHH.mjs");
  const providers = options(config);
  console.log(
    "discovered",
    providers.map((p) => p.id),
  );
  assert(providers.some((p) => p.id === "tinyfish"));
  assert.equal(config.tools.web.search.provider, undefined);
  let masked = false;
  const selected = await setup(
    config,
    {
      log() {},
      error() {},
      exit() {
        throw Error("exit");
      },
    },
    {
      note: async () => {},
      select: async ({ options }) => {
        assert(options.some((o) => o.value === "tinyfish"));
        return "tinyfish";
      },
      text: async (p) => {
        masked = p.sensitive === true;
        return "offline-fixture-not-a-real-key";
      },
      confirm: async () => true,
    },
  );
  assert(masked);
  assert.equal(selected.outcome, "completed");
  assert.equal(selected.config.tools.web.search.provider, "tinyfish");
  assert.equal(
    selected.config.plugins.entries.tinyfish.config.apiKey,
    "offline-fixture-not-a-real-key",
  );
  const { c: run } = await load("runtime-FWv3S0OT.mjs");
  // Replace only the external transport, not host discovery/selection/provider execution.
  const result = await run({
    config: selected.config,
    preferInputConfig: true,
    args: { query: "fixture" },
    signal: new AbortController().signal,
  });
  assert.equal(result.provider, "tinyfish");
  assert.equal(result.result.count, 0);
  assert.equal(calls, 1);
  console.log(
    "PASS installed-host setup discovery, masked shared credential, configured native runtime route; activate:false loader; mocked API only",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

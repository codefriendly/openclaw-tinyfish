import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { fetchSchema, nativeFetchSchema } from "./schemas.js";
import { createHash } from "node:crypto";
// These runtime entrypoints have no corresponding declarations in host 2026.10.5.
import {
  withStrictWebToolsEndpoint,
  markdownToText,
  wrapWebContent,
  // @ts-expect-error Host exports JavaScript without declaration files.
} from "openclaw/plugin-sdk/provider-web-fetch";
// @ts-expect-error Host exports JavaScript without declaration files.
import { createWebSearchProviderContractFields } from "openclaw/plugin-sdk/provider-web-search-config-contract";
import { resolvePinnedHostnameWithPolicy } from "openclaw/plugin-sdk/ssrf-runtime";
import {
  Client,
  TinyFishError,
  publicUrlSyntax,
  type Dependencies,
  type Options,
  type Transport,
} from "./client.js";
import { searchSchema, type Params } from "./mapping.js";
export async function boundedJson(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.body) throw new TinyFishError("empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new TinyFishError("response_too_large");
      chunks.push(value);
    }
    signal.throwIfAborted();
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export const transport: Transport = async (url, init, signal, limit) => {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    !["api.search.tinyfish.ai", "api.fetch.tinyfish.ai"].includes(u.hostname) ||
    u.pathname !== "/" ||
    u.port ||
    u.username ||
    u.password
  )
    throw new TinyFishError("invalid_endpoint");
  return withStrictWebToolsEndpoint(
    {
      url,
      init,
      signal,
      maxRedirects: 0,
      capture: { sensitiveRequestHeaderNames: ["X-API-Key"] },
    },
    async ({ response }: { response: Response }) => ({
      status: response.status,
      headers: response.headers,
      data:
        response.status === 200
          ? await boundedJson(response, limit, signal)
          : null,
    }),
  );
};
export const dependencies: Dependencies = {
  transport,
  markdownToText,
  wrap: (s) => wrapWebContent(s, "web_fetch"),
  publicUrl: async (url, signal) => {
    const u = new URL(publicUrlSyntax(url, true));
    await resolvePinnedHostnameWithPolicy(u.hostname, { signal });
    signal.throwIfAborted();
    return u.href;
  },
};
type SearchProvider = Parameters<
  OpenClawPluginApi["registerWebSearchProvider"]
>[0];
type FetchProvider = Parameters<
  OpenClawPluginApi["registerWebFetchProvider"]
>[0];
type Context = Parameters<SearchProvider["createTool"]>[0];
export type PluginApi = Pick<
  OpenClawPluginApi,
  | "registerWebSearchProvider"
  | "registerWebFetchProvider"
  | "registerTool"
  | "pluginConfig"
>;
// Host runtime subpaths lack declarations; derive registration and execution contracts from the full installed core API.
type NativeSchema = NonNullable<
  ReturnType<SearchProvider["createTool"]>
>["parameters"];
const schema = (value: object) => value as NativeSchema;
export const highlightsSchema = {
  type: "object",
  required: ["urls", "question"],
  additionalProperties: false,
  properties: {
    urls: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 2048 },
    },
    question: { type: "string", minLength: 1, maxLength: 2000 },
    maxCharacters: { type: "integer", minimum: 300, maximum: 12000 },
    maxSnippets: { type: "integer", minimum: 1, maximum: 10 },
  },
};
export function register(api: PluginApi, deps: Dependencies = dependencies) {
  const clients = new Map<string, Client>();
  function client(ctx: Context) {
    const cfg =
      ctx.config !== undefined
        ? (ctx.config.plugins?.entries?.tinyfish?.config ?? {})
        : (api.pluginConfig ?? {});
    const options: Options = {
      apiKey: cfg.apiKey,
      enableHighlights: cfg.enableHighlights === true,
      timeoutMs: cfg.timeoutMs as number | undefined,
      maxResponseBytes: cfg.maxResponseBytes as number | undefined,
      cacheTtlMs:
        ctx.searchConfig?.cacheTtlMinutes !== undefined
          ? Math.max(
              0,
              Math.min(
                900000,
                Number(ctx.searchConfig.cacheTtlMinutes) * 60000,
              ),
            )
          : (cfg.cacheTtlMs as number | undefined),
    };
    // All mapped request fields and credential identity partition the bounded local cache.
    const identity = createHash("sha256")
      .update(JSON.stringify(options))
      .digest("hex");
    let c = clients.get(identity);
    if (!c) {
      c = new Client(options, deps);
      if (clients.size >= 8) clients.delete(clients.keys().next().value!);
      clients.set(identity, c);
    }
    return c;
  }
  const common = {
    id: "tinyfish",
    label: "TinyFish",
    hint: "Direct TinyFish APIs; calls may incur provider charges",
    envVars: ["TINYFISH_API_KEY"],
    requiresCredential: true,
    autoDetectOrder: 1000,
    onboardingScopes: ["text-inference"] as const,
    configPath: [] as string[],
    credentialLabel: "TinyFish API key",
    placeholder: "API key (masked)",
    signupUrl: "https://agent.tinyfish.ai",
    docsUrl: "https://docs.tinyfish.ai",
    credentialPath: "plugins.entries.tinyfish.config.apiKey",
    getConfiguredCredentialValue: (cfg: Context["config"]) =>
      cfg?.plugins?.entries?.tinyfish?.config?.apiKey,
    setConfiguredCredentialValue: (
      cfg: NonNullable<Context["config"]>,
      value: unknown,
    ) => {
      cfg.plugins ??= {};
      cfg.plugins.entries ??= {};
      cfg.plugins.entries.tinyfish ??= {};
      cfg.plugins.entries.tinyfish.config ??= {};
      cfg.plugins.entries.tinyfish.config.apiKey = value;
    },
  };
  api.registerWebSearchProvider({
    ...common,
    ...createWebSearchProviderContractFields({
      credentialPath: common.credentialPath,
      searchCredential: { type: "none" },
    }),
    createTool: (ctx) => ({
      description:
        "Search web, news, or academic papers directly with TinyFish. Count limits returned results, not provider work.",
      parameters: schema(searchSchema),
      execute: (args, execution) => {
        execution?.assertCurrent?.();
        return client(ctx).search(args, execution?.signal);
      },
    }),
  });
  if (api.pluginConfig?.enableNativeFetch === true)
    api.registerWebFetchProvider({
      ...common,
      ...createWebSearchProviderContractFields({
        credentialPath: common.credentialPath,
        searchCredential: { type: "none" },
      }),
      createTool: (ctx) => ({
        description:
          "TinyFish readable webpage extraction; core wraps untrusted content.",
        parameters: schema(nativeFetchSchema),
        execute: (args, execution) =>
          client(ctx).fetch(args, execution?.signal),
      }),
    });

  function wrapped(
    value: unknown,
    source: "web_search" | "web_fetch",
    budget?: number,
  ) {
    if (budget !== undefined) {
      const envelope = value as {
        results: Params[];
        outputChars: number;
        metadataTruncated?: boolean;
      };
      if (JSON.stringify(envelope).length > budget) {
        envelope.metadataTruncated = true;
        for (const r of envelope.results) {
          for (const key of Object.keys(r))
            if (
              ![
                "index",
                "url",
                "state",
                "error",
                "status",
                "text",
                "truncated",
              ].includes(key)
            )
              delete r[key];
          if (typeof r.url === "string" && r.url.length > 128) delete r.url;
        }
        envelope.outputChars = 0;
        for (
          let i = envelope.results.length - 1;
          i >= 0 && JSON.stringify(envelope).length > budget - 16;
          i--
        ) {
          const r = envelope.results[i];
          if (typeof r.text !== "string") continue;
          r.truncated = true;
          const original = r.text;
          let low = 0,
            high = original.length;
          while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            r.text = original.slice(0, mid);
            if (JSON.stringify(envelope).length <= budget - 16) low = mid;
            else high = mid - 1;
          }
          r.text = original.slice(0, low);
        }
        envelope.outputChars = envelope.results.reduce(
          (n, r) => n + (typeof r.text === "string" ? r.text.length : 0),
          0,
        );
      }
    }
    // Wrap the entire serialized envelope: titles, URLs, authors, metadata and errors are all external content.
    const text = wrapWebContent(JSON.stringify(value), source);
    return {
      content: [{ type: "text" as const, text }],
      details: {
        externalContent: {
          untrusted: true,
          wrapped: true,
          provider: "tinyfish",
          source,
        },
        text,
      },
    };
  }
  api.registerTool(
    (ctx) => {
      // Ordinary plugin tools have no sandbox network bridge. Do not bypass core provenance restrictions.
      if (ctx.sandboxed !== false) return null;
      const run = async (
        kind: "search" | "fetch" | "highlights",
        args: Params,
        signal?: AbortSignal,
      ) => {
        ctx.assertInvocationCurrent?.();
        const runtimeConfig = ctx.getRuntimeConfig
          ? ctx.getRuntimeConfig()
          : (ctx.runtimeConfig ?? ctx.config);
        // An authoritative runtime getter returning no snapshot is revocation, not
        // permission to reuse registration-time credentials.
        if (ctx.getRuntimeConfig && !runtimeConfig)
          throw new TinyFishError("missing_api_key");
        const c = client({ config: runtimeConfig });
        const result =
          kind === "search"
            ? await c.search(args, signal)
            : kind === "fetch"
              ? await c.fetchBatch(args, signal)
              : await c.highlights(args, signal);
        ctx.assertInvocationCurrent?.();
        return wrapped(
          result,
          kind === "search" ? "web_search" : "web_fetch",
          kind === "fetch" ? Number(args.maxOutputChars ?? 120000) : undefined,
        );
      };
      const tools = [
        {
          name: "tinyfish_search",
          label: "TinyFish Search",
          description:
            "Advanced public web/news/academic search with bounded metadata. May incur charges.",
          parameters: schema(searchSchema),
          execute: (_id: string, args: Params, signal?: AbortSignal) =>
            run("search", args, signal),
        },
        {
          name: "tinyfish_fetch",
          label: "TinyFish Fetch",
          description:
            "Extract 1-10 public webpages with per-URL results and shared maxChars text budget; bounded metadata adds overhead.",
          parameters: schema(fetchSchema),
          execute: (_id: string, args: Params, signal?: AbortSignal) =>
            run("fetch", args, signal),
        },
      ];
      if (api.pluginConfig?.enableHighlights === true)
        tools.push({
          name: "tinyfish_highlights",
          label: "TinyFish Highlights",
          description:
            "Account-gated beta passages; enable only after separately authorized live verification.",
          parameters: schema(highlightsSchema),
          execute: (_id: string, args: Params, signal?: AbortSignal) =>
            run("highlights", args, signal),
        });
      return tools;
    },
    { names: ["tinyfish_search", "tinyfish_fetch", "tinyfish_highlights"] },
  );
}
export default {
  id: "tinyfish",
  name: "TinyFish",
  description: "Direct TinyFish Search and Fetch API providers",
  register,
};

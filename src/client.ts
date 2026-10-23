import { createHash } from "node:crypto";
import { fail, integer, mapSearch, string, type Params } from "./mapping.js";
import { fetchSchema } from "./schemas.js";
export type Transport = (
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  limit: number,
) => Promise<{ status: number; headers: Headers; data: unknown }>;
export type Dependencies = {
  transport: Transport;
  publicUrl: (url: string, signal: AbortSignal) => Promise<string>;
  markdownToText: (text: string) => string;
  wrap: (text: string) => string;
  now?: () => number;
};
export type Options = {
  apiKey?: unknown;
  enableHighlights?: boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
  cacheTtlMs?: number;
};
export class TinyFishError extends Error {
  constructor(
    public code: string,
    public status?: number,
  ) {
    super("TinyFish " + code + (status ? " (HTTP " + status + ")" : ""));
  }
}
function record(v: unknown): Params {
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail("Invalid TinyFish response");
  return v as Params;
}
function rows(v: unknown): Params[] {
  if (!Array.isArray(v) || v.length > 1000) fail("Invalid TinyFish results");
  return v.map(record);
}
export function publicUrlSyntax(v: unknown, allowRaw = false): string {
  const raw = string(v, "URL", 2048);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return fail("Invalid URL");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hash ||
    !["", "80", "443"].includes(u.port)
  )
    fail("Unsafe URL");
  if (!u.hostname.includes(".") && !u.hostname.includes(":"))
    fail("Unsafe hostname");
  if (/[.](?:local|localhost|internal|test|invalid)$/i.test(u.hostname))
    fail("Unsafe hostname");
  if (
    !allowRaw &&
    /[.](?:pdf|csv|json|xml|txt|zip|png|jpe?g|gif|webp|mp4)$/i.test(u.pathname)
  )
    fail("Raw files belong in direct HTTP, not webpage extraction");
  return u.href;
}
export function cacheIdentity(
  key: string,
  mapped: ReturnType<typeof mapSearch>,
): string {
  return createHash("sha256")
    .update(JSON.stringify([key, mapped]))
    .digest("hex");
}
export class Client {
  private cache = new Map<string, { at: number; value: unknown }>();
  private usage = new Map<
    string,
    { start: number; units: number; blockedUntil: number }
  >();
  constructor(
    private options: Options,
    private deps: Dependencies,
  ) {}
  private key() {
    const v = this.options.apiKey;
    if (typeof v !== "string" || !v.trim())
      throw new TinyFishError(v ? "unresolved_secret" : "missing_api_key");
    if (/[\x0d\x0a]/.test(v)) throw new TinyFishError("invalid_api_key");
    return v.trim();
  }
  private async scope<T>(
    signal: AbortSignal | undefined,
    run: (s: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(
      integer(this.options.timeoutMs ?? 30000, "timeoutMs", 1, 150000),
    );
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    combined.throwIfAborted();
    try {
      const value = await run(combined);
      combined.throwIfAborted();
      return value;
    } catch (e) {
      if (combined.aborted)
        throw new TinyFishError(signal?.aborted ? "cancelled" : "timeout");
      if (e instanceof TinyFishError) throw e;
      throw new TinyFishError("request_failed");
    }
  }
  private async request(
    kind: "search" | "fetch",
    payload: Record<string, string> | Params,
    key: string,
    signal: AbortSignal,
    units = 1,
  ) {
    const now = (this.deps.now ?? Date.now)();
    const bucket = createHash("sha256")
      .update(key + kind)
      .digest("hex");
    let u = this.usage.get(bucket);
    if (!u || now - u.start >= 60000) {
      u = { start: now, units: 0, blockedUntil: u?.blockedUntil ?? 0 };
      this.usage.set(bucket, u);
    }
    if (this.usage.size > 128)
      this.usage.delete(this.usage.keys().next().value!);
    if (
      now < u.blockedUntil ||
      u.units + units > (kind === "search" ? 30 : 150)
    )
      throw new TinyFishError("rate_limited", 429);
    u.units += units;
    const url =
      kind === "search"
        ? "https://api.search.tinyfish.ai/?" +
          new URLSearchParams(payload as Record<string, string>)
        : "https://api.fetch.tinyfish.ai/";
    const res = await this.deps.transport(
      url,
      {
        method: kind === "search" ? "GET" : "POST",
        redirect: "error",
        headers: {
          "X-API-Key": key,
          Accept: "application/json",
          ...(kind === "fetch" ? { "Content-Type": "application/json" } : {}),
        },
        ...(kind === "fetch" ? { body: JSON.stringify(payload) } : {}),
      },
      signal,
      integer(
        this.options.maxResponseBytes ?? 750000,
        "maxResponseBytes",
        1024,
        2000000,
      ),
    );
    signal.throwIfAborted();
    if (res.status !== 200) {
      if (res.status === 429) {
        const retry = res.headers.get("retry-after");
        const seconds = Number(retry);
        u.blockedUntil =
          now +
          Math.min(
            3600000,
            Math.max(
              60000,
              Number.isFinite(seconds)
                ? seconds * 1000
                : (Date.parse(retry ?? "") || now + 60000) - now,
            ),
          );
      }
      throw new TinyFishError(
        res.status === 403 && payload.highlights
          ? "highlights_not_enabled"
          : res.status === 402
            ? "allowance_or_credit_exhausted"
            : "http_error",
        res.status,
      );
    }
    // Provider-controlled successful fields must not reflect this credential either.
    const serialized = JSON.stringify(res.data).split(key).join("[REDACTED]");
    return record(JSON.parse(serialized));
  }
  async search(args: Params, signal?: AbortSignal) {
    const mapped = mapSearch(args);
    const key = this.key();
    return this.scope(signal, async (s) => {
      const id = cacheIdentity(key, mapped);
      const ttl = integer(
        this.options.cacheTtlMs ?? 0,
        "cacheTtlMs",
        0,
        900000,
      );
      const now = (this.deps.now ?? Date.now)();
      const cached = this.cache.get(id);
      if (ttl && cached && now - cached.at < ttl)
        return { ...structuredClone(record(cached.value)), cached: true };
      const data = await this.request("search", mapped.request, key, s);
      const results = [];
      for (const row of rows(data.results).slice(0, mapped.count)) {
        let url: string;
        try {
          url = await this.deps.publicUrl(publicUrlSyntax(row.url), s);
        } catch {
          s.throwIfAborted();
          continue;
        }
        if (typeof row.title !== "string" || typeof row.snippet !== "string")
          fail("Invalid search result");
        const metadata: Params = {};
        for (const f of ["publisher", "venue"])
          if (typeof row[f] === "string")
            metadata[f] = (row[f] as string).slice(0, 512);
        if (Array.isArray(row.authors))
          metadata.authors = row.authors
            .filter((a): a is string => typeof a === "string")
            .slice(0, 30)
            .map((a) => a.slice(0, 200));
        for (const f of ["position", "year", "cited_by_count"])
          if (Number.isSafeInteger(row[f]) && Number(row[f]) >= 0)
            metadata[f] = Math.min(
              Number(row[f]),
              f === "year" ? 9999 : 1000000000,
            );
        for (const f of ["pdf_url", "thumbnail_url"])
          if (typeof row[f] === "string") {
            try {
              metadata[f] = await this.deps.publicUrl(
                publicUrlSyntax(row[f], true),
                s,
              );
            } catch {
              s.throwIfAborted();
            }
          }
        results.push({
          ...metadata,
          title: row.title.slice(0, 512),
          url,
          snippet: row.snippet.slice(0, 4000),
          ...(typeof row.site_name === "string"
            ? { siteName: row.site_name.slice(0, 256) }
            : {}),
          ...(typeof row.date === "string" &&
          /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T.*)?$/.test(row.date)
            ? { published: row.date.slice(0, 64) }
            : {}),
        });
      }
      const value = {
        query: mapped.request.query,
        provider: "tinyfish",
        count: results.length,
        results,
        ...(Number.isSafeInteger(data.total_results) &&
        Number(data.total_results) >= 0
          ? { total_results: Math.min(Number(data.total_results), 1000000000) }
          : {}),
        ...(Number.isInteger(data.page) &&
        Number(data.page) >= 0 &&
        Number(data.page) <= 10
          ? { page: data.page }
          : {}),
      };
      s.throwIfAborted();
      if (ttl) {
        if (this.cache.size >= 100)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(id, { at: now, value: structuredClone(value) });
      }
      return value;
    });
  }
  async fetch(args: Params, signal?: AbortSignal) {
    const batch = await this.fetchBatch(
      {
        urls: [args.url],
        extractMode: args.extractMode,
        maxChars: args.maxChars,
      },
      signal,
    );
    const r = batch.results[0];
    if (r.state === "error")
      throw new TinyFishError(String(r.error), r.status as number | undefined);
    const { state, ...result } = r;
    return result;
  }
  async fetchBatch(args: Params, signal?: AbortSignal) {
    for (const f of Object.keys(args))
      if (!(f in fetchSchema.properties)) fail("Unsupported fetch field");
    if (
      !Array.isArray(args.urls) ||
      args.urls.length < 1 ||
      args.urls.length > 10
    )
      fail("Expected 1-10 URLs");
    if (args.maxOutputChars !== undefined)
      integer(args.maxOutputChars, "maxOutputChars", 4000, 200000);
    const inputs = args.urls.map((u) => string(u, "URL", 2048)),
      max = integer(args.maxChars ?? 20000, "maxChars", 100, 100000);
    const mode = args.extractMode ?? "markdown";
    if (!["markdown", "text"].includes(String(mode)))
      fail("Invalid extractMode");
    const payload: Params = {
      urls: [],
      format: args.format ?? "markdown",
      per_url_timeout_ms: Math.min(this.options.timeoutMs ?? 30000, 110000),
    };
    if (
      !["markdown", "html", "json"].includes(String(payload.format)) ||
      (mode === "text" && payload.format !== "markdown")
    )
      fail("Invalid format");
    for (const f of ["purpose", "if_none_match", "if_modified_since"])
      if (args[f] !== undefined) payload[f] = string(args[f], f);
    if (
      inputs.length !== 1 &&
      (args.if_none_match !== undefined || args.if_modified_since !== undefined)
    )
      fail("Conditional validators require one URL");
    for (const f of [
      "links",
      "image_links",
      "iframe_links",
      "page_metadata",
      "include_etag_and_last_modified",
    ])
      if (args[f] !== undefined) {
        if (typeof args[f] !== "boolean") fail("Invalid " + f);
        payload[f] = args[f];
      }
    for (const f of ["ttl", "per_url_timeout_ms"])
      if (args[f] !== undefined)
        payload[f] = integer(
          args[f],
          f,
          f === "ttl" ? 0 : 1,
          f === "ttl" ? 31536000 : 110000,
        );
    for (const f of ["include_selectors", "exclude_selectors"])
      if (args[f] !== undefined) {
        const v = args[f];
        if (!Array.isArray(v) || v.length < 1 || v.length > 20)
          fail("Invalid selectors");
        payload[f] = v.map((x) => string(x, f, 1000));
      }
    const key = this.key();
    return this.scope(signal, async (s) => {
      const accepted = new Map<number, string>();
      for (let i = 0; i < inputs.length; i++) {
        try {
          accepted.set(
            i,
            await this.deps.publicUrl(publicUrlSyntax(inputs[i]), s),
          );
        } catch {
          s.throwIfAborted();
        }
      }
      payload.urls = [...new Set(accepted.values())];
      const data = accepted.size
        ? await this.request(
            "fetch",
            payload,
            key,
            s,
            (payload.urls as string[]).length,
          )
        : { results: [], errors: [] };
      const successes = rows(data.results),
        errors = rows(data.errors),
        results: Params[] = [];
      let remaining = max;
      for (let i = 0; i < inputs.length; i++) {
        const url = accepted.get(i);
        if (!url) {
          results.push({ index: i, state: "error", error: "unsafe_url" });
          continue;
        }
        const e = errors.find((r) => r.url === url),
          r = successes.find((r) => r.url === url);
        if (e) {
          results.push({
            index: i,
            url,
            state: "error",
            error: knownError(e.error),
            ...(Number.isInteger(e.status) &&
            Number(e.status) >= 100 &&
            Number(e.status) <= 599
              ? { status: e.status }
              : {}),
          });
          continue;
        }
        if (!r) {
          results.push({
            index: i,
            url,
            state: "error",
            error: "missing_result",
          });
          continue;
        }
        try {
          const finalUrl = await this.deps.publicUrl(
            publicUrlSyntax(r.final_url ?? url),
            s,
          );
          let raw: string;
          if (typeof r.text === "string") raw = r.text;
          else if (
            payload.format === "json" &&
            r.text &&
            typeof r.text === "object"
          )
            raw = JSON.stringify(r.text);
          else if (r.not_modified === true) raw = "";
          else throw new TinyFishError("invalid_result");
          if (mode === "text") raw = this.deps.markdownToText(raw);
          const text = raw.slice(0, remaining);
          remaining -= text.length;
          const metadata: Params = {};
          for (const f of [
            "title",
            "description",
            "author",
            "language",
            "published_date",
            "etag",
            "last_modified",
          ])
            if (typeof r[f] === "string")
              metadata[f] = (r[f] as string).slice(0, 512);
          for (const f of ["links", "image_links", "iframe_links"])
            if (Array.isArray(r[f])) {
              const links = [];
              for (const link of (r[f] as unknown[]).slice(0, 10)) {
                try {
                  links.push(
                    await this.deps.publicUrl(publicUrlSyntax(link, true), s),
                  );
                } catch {
                  s.throwIfAborted();
                }
              }
              metadata[f] = links;
            }
          if (r.page_metadata && typeof r.page_metadata === "object")
            metadata.page_metadata = JSON.stringify(r.page_metadata).slice(
              0,
              2000,
            );
          results.push({
            index: i,
            url,
            finalUrl,
            state: "success",
            status: 200,
            contentType:
              payload.format === "html"
                ? "text/html"
                : payload.format === "json"
                  ? "application/json"
                  : "text/markdown",
            extractor: "tinyfish",
            text,
            rawLength: raw.length,
            truncated: raw.length > text.length,
            ...metadata,
            ...(typeof r.not_modified === "boolean"
              ? { not_modified: r.not_modified }
              : {}),
          });
        } catch {
          s.throwIfAborted();
          results.push({
            index: i,
            url,
            state: "error",
            error: "unsafe_or_invalid_result",
          });
        }
      }
      return {
        provider: "tinyfish",
        results,
        maxChars: max,
        outputChars: max - remaining,
      };
    });
  }
  async highlights(args: Params, signal?: AbortSignal) {
    if (!this.options.enableHighlights)
      throw new TinyFishError("highlights_disabled");
    const key = this.key();
    if (
      !Array.isArray(args.urls) ||
      args.urls.length < 1 ||
      args.urls.length > 3
    )
      fail("Expected 1-3 URLs");
    const urls = args.urls.map((u) => publicUrlSyntax(u));
    const query = string(args.question, "question");
    const max = integer(
      args.maxCharacters ?? 4000,
      "maxCharacters",
      300,
      12000,
    );
    const snippets = integer(args.maxSnippets ?? 5, "maxSnippets", 1, 10);
    return this.scope(signal, async (s) => {
      for (const u of urls) await this.deps.publicUrl(u, s);
      const data = await this.request(
        "fetch",
        {
          urls,
          format: "markdown",
          highlights: {
            query,
            max_snippets: snippets,
            max_characters: Math.floor(max / urls.length),
            include_full_page_text: false,
          },
          per_url_timeout_ms: Math.min(this.options.timeoutMs ?? 30000, 110000),
        },
        key,
        s,
        urls.length,
      );
      const successes = rows(data.results),
        errors = rows(data.errors);
      let remaining = max;
      const results = [];
      for (const url of urls) {
        const error = errors.find((r) => r.url === url);
        if (error) {
          results.push({ url, state: "error", error: knownError(error.error) });
          continue;
        }
        const r = successes.find((r) => r.url === url);
        if (!r) {
          results.push({ url, state: "error", error: "missing_result" });
          continue;
        }
        await this.deps.publicUrl(publicUrlSyntax(r.final_url ?? url), s);
        if (r.highlights === undefined) {
          results.push({ url, state: "absent" });
          continue;
        }
        const passages = rows(r.highlights);
        for (const p of passages) {
          if (typeof p.text !== "string") fail("Invalid passage");
          integer(p.rank, "rank", 1, 1000);
        }
        let truncated = passages.length > snippets;
        const out = passages
          .sort((a, b) => Number(a.rank) - Number(b.rank))
          .slice(0, snippets)
          .map((p) => {
            const text =
              typeof p.text === "string" ? p.text : fail("Invalid passage");
            const rank = integer(p.rank, "rank", 1, 1000);
            const sliced = text.slice(0, remaining);
            remaining -= sliced.length;
            truncated ||= sliced.length < text.length;
            return { rank, text: this.deps.wrap(sliced) };
          });
        results.push({
          url,
          state: passages.length ? "passages" : "empty",
          passages: out,
          truncated,
        });
      }
      return {
        results,
        externalContent: {
          untrusted: true,
          source: "web_fetch",
          wrapped: true,
          provider: "tinyfish",
        },
      };
    });
  }
}
function knownError(v: unknown): string {
  return typeof v === "string" &&
    [
      "target_http_error",
      "page_not_found",
      "target_unreachable",
      "timeout",
      "bot_blocked",
      "empty_content",
      "login_required",
      "content_too_large",
      "invalid_url",
      "invalid_redirect_url",
      "proxy_error",
      "conditional_unsupported",
      "selector_not_matched",
      "selector_unsupported",
    ].includes(v)
    ? v
    : "provider_url_error";
}

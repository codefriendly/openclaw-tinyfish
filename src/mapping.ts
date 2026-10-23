export type Params = Record<string, unknown>;
export function fail(message: string): never {
  throw new Error(message);
}
export function string(v: unknown, name: string, max = 2000): string {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    /[\x00-\x1f]/.test(v)
  )
    fail("Invalid " + name);
  return v.trim();
}
export function integer(
  v: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    fail("Invalid " + name);
  return v;
}
const fields = [
  "query",
  "purpose",
  "location",
  "language",
  "include_domains",
  "exclude_domains",
  "domain_type",
  "recency_minutes",
  "after_date",
  "before_date",
  "pub_year_min",
  "pub_year_max",
  "page",
];
export const searchProperties: Record<string, object> = Object.fromEntries(
  fields.map((k) => [
    k,
    ["recency_minutes", "pub_year_min", "pub_year_max", "page"].includes(k)
      ? {
          type: "integer",
          minimum: k === "recency_minutes" ? 1 : 0,
          maximum: k === "page" ? 10 : k === "recency_minutes" ? 5256000 : 9999,
        }
      : {
          type: "string",
          minLength: 1,
          maxLength:
            k === "query" || k === "purpose" || k.endsWith("_domains")
              ? 2000
              : 64,
        },
  ]),
);
Object.assign(searchProperties, {
  include_thumbnail: { type: "boolean" },
  count: { type: "integer", minimum: 1, maximum: 10 },
  country: { type: "string" },
  freshness: { type: "string", enum: ["day", "week", "month", "year"] },
  date_after: { type: "string" },
  date_before: { type: "string" },
  domain_type: { type: "string", enum: ["web", "news", "research_paper"] },
});
export const searchSchema = {
  type: "object",
  required: ["query"],
  additionalProperties: false,
  properties: searchProperties,
};
function date(v: unknown, name: string): string {
  const s = string(v, name, 10);
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    fail("Invalid " + name);
  return s;
}
function domains(v: unknown): string {
  const list = string(v, "domains", 2000)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .sort();
  if (
    list.length > 20 ||
    list.some(
      (s) => !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?[.])+[a-z]{2,63}$/.test(s),
    )
  )
    fail("Invalid domains");
  return [...new Set(list)].join(",");
}
export function mapSearch(input: Params): {
  request: Record<string, string>;
  count: number;
} {
  for (const k of Object.keys(input))
    if (!(k in searchProperties)) fail("Unsupported search field");
  const p = { ...input };
  let thumbnail: string | undefined;
  if (p.include_thumbnail !== undefined) {
    if (typeof p.include_thumbnail !== "boolean")
      fail("Invalid include_thumbnail");
    thumbnail = String(p.include_thumbnail);
    delete p.include_thumbnail;
  }
  for (const [alias, target] of [
    ["country", "location"],
    ["date_after", "after_date"],
    ["date_before", "before_date"],
  ])
    if (p[alias] !== undefined) {
      if (p[target] !== undefined) fail("Conflicting aliases");
      p[target] = p[alias];
      delete p[alias];
    }
  if (p.freshness !== undefined) {
    if (p.recency_minutes !== undefined) fail("Conflicting recency");
    const n = (
      { day: 1440, week: 10080, month: 43200, year: 525600 } as Record<
        string,
        number
      >
    )[String(p.freshness)];
    if (!n) fail("Invalid freshness");
    p.recency_minutes = n;
    delete p.freshness;
  }
  const count = p.count === undefined ? 5 : integer(p.count, "count", 1, 10);
  delete p.count;
  const request: Record<string, string> = { query: string(p.query, "query") };
  for (const k of fields.filter((k) => k !== "query"))
    if (p[k] !== undefined) {
      let v: string | number;
      if (k === "page") v = integer(p[k], k, 0, 10);
      else if (k === "recency_minutes") v = integer(p[k], k, 1, 5256000);
      else if (k.startsWith("pub_year")) v = integer(p[k], k, 0, 9999);
      else if (k.endsWith("_date")) v = date(p[k], k);
      else if (k.endsWith("_domains")) v = domains(p[k]);
      else v = string(p[k], k, k === "purpose" ? 2000 : 64);
      request[k] = String(v);
    }
  if (request.location && !/^[A-Za-z]{2}$/.test(request.location))
    fail("Invalid location");
  if (
    request.language &&
    !/^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(request.language)
  )
    fail("Invalid language");
  if (
    request.domain_type &&
    !["web", "news", "research_paper"].includes(request.domain_type)
  )
    fail("Invalid mode");
  if (request.recency_minutes && (request.after_date || request.before_date))
    fail("Recency conflicts with dates");
  if (
    request.after_date &&
    request.before_date &&
    request.after_date > request.before_date
  )
    fail("Reversed dates");
  if (
    request.domain_type === "research_paper" &&
    (request.recency_minutes || request.after_date || request.before_date)
  )
    fail("Papers require publication years");
  if (
    request.domain_type !== "research_paper" &&
    (request.pub_year_min !== undefined || request.pub_year_max !== undefined)
  )
    fail("Year filters require papers");
  if (
    request.pub_year_min !== undefined &&
    request.pub_year_max !== undefined &&
    +request.pub_year_min > +request.pub_year_max
  )
    fail("Reversed years");
  if (
    request.include_domains
      ?.split(",")
      .some((d) => request.exclude_domains?.split(",").includes(d))
  )
    fail("Overlapping domain filters");
  if (thumbnail !== undefined) request.include_thumbnail = thumbnail;
  return { request, count };
}

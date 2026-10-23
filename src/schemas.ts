const short = { type: "string", minLength: 1, maxLength: 2000 };
const selectors = {
  type: "array",
  minItems: 1,
  maxItems: 20,
  items: { type: "string", minLength: 1, maxLength: 1000 },
};
export const fetchSchema = {
  type: "object",
  required: ["urls"],
  additionalProperties: false,
  properties: {
    urls: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 2048 },
    },
    extractMode: { type: "string", enum: ["markdown", "text"] },
    format: { type: "string", enum: ["markdown", "html", "json"] },
    maxOutputChars: { type: "integer", minimum: 4000, maximum: 200000 },
    maxChars: { type: "integer", minimum: 100, maximum: 100000 },
    purpose: short,
    links: { type: "boolean" },
    image_links: { type: "boolean" },
    iframe_links: { type: "boolean" },
    page_metadata: { type: "boolean" },
    include_etag_and_last_modified: { type: "boolean" },
    if_none_match: short,
    if_modified_since: short,
    ttl: { type: "integer", minimum: 0, maximum: 31536000 },
    per_url_timeout_ms: { type: "integer", minimum: 1, maximum: 110000 },
    include_selectors: selectors,
    exclude_selectors: selectors,
  },
};
export const nativeFetchSchema = {
  type: "object",
  required: ["url"],
  additionalProperties: false,
  properties: {
    url: short,
    extractMode: { type: "string", enum: ["markdown", "text"] },
    maxChars: { type: "integer", minimum: 100, maximum: 100000 },
  },
};

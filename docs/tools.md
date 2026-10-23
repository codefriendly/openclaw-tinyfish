# Tool reference

Use the tool schemas for the complete argument list. These tools are agent tools, not shell commands.

## tinyfish_search

Required query (1–2000 chars); count 1–10 (default 5; local slice, not provider-work reduction). Official fields: purpose, location, language, include_domains, exclude_domains, domain_type (web/news/research_paper), recency_minutes (1–5256000), after_date, before_date, pub_year_min/pub_year_max (0–9999, papers only), page (0–10), include_thumbnail boolean. Domain strings are comma-separated, <=20 validated domains. Aliases: country→location, date_after/date_before→after_date/before_date; freshness day/week/month/year→1440/10080/43200/525600 minutes. Conflicting aliases, recency/date conflicts, invalid/reversed dates/years, paper-inapplicable filters and overlapping domains reject.

Bounded result metadata: title (512), snippet (4000), URL (2048), siteName (256), published (64), publisher/venue (512), authors (30 × 200), position, year, cited_by_count, pdf_url, thumbnail_url. Omit absent fields; unsafe metadata URLs omitted. total_results/page preserved when valid. Authors/year/citations retain official field names. Opaque search fetch configuration is intentionally not exposed: no documented nested contract. No embedded fetch or alternative paid endpoint.

Native web_search uses core's fixed schema and closed result normalization: advanced options/metadata are not fully exposed there. Use tinyfish_search for those, outside sandbox only. Unsupported native filters reject rather than silently changing meaning.

## tinyfish_fetch

Required urls: **1–10**, public webpages. Results preserve input order and index, each state success/error; missing provider rows become missing_result. Unsafe URLs and redirects become per-URL errors while safe inputs continue. Duplicate targets are dispatched once and returned once per input.

Options: extractMode markdown/text; format markdown/html/json (text mode requires markdown); purpose; links/image_links/iframe_links/page_metadata; ttl (0–31536000); per_url_timeout_ms (1–110000); include_etag_and_last_modified; if_none_match/if_modified_since (single URL only); include_selectors/exclude_selectors (1–20 × 1–1000 chars). JSON document trees are serialized into bounded text and may be truncated, not guaranteed parseable.

**maxChars** (100–100000, default 20000) is one combined extracted-text budget, consumed in input order. **maxOutputChars** (4000–200000, default 120000) additionally caps the complete serialized result envelope; if needed metadata is dropped and text shortened while retaining every per-URL state. Untrusted-content security framing adds fixed overhead, and JSON escaping means text length and envelope length differ. Metadata truncation is reported. Per page: seven textual metadata fields <=512 each; three URL lists <=10 each; page_metadata serialized <=2000. Remote errors use allowlisted codes/status only, never upstream messages. Request-wide transport/auth/HTTP failures fail the tool once; no automatic retry.


## tinyfish_highlights

Requires `enableHighlights: true` and account access. Arguments: `question`, `urls` (1–3), `maxCharacters` (300–12000, default 4000), and `maxSnippets` (1–10, default 5). Returns ranked passages with per-URL states and truncation indicators. A missing passage is not proof of account access.

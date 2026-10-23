# TinyFish for OpenClaw

Use TinyFish to search the web and extract readable content, including JavaScript-rendered pages, from OpenClaw. The plugin calls the TinyFish APIs directly. No MCP server is required.

## Features

- **Native search:** select TinyFish as the backend for OpenClaw’s `web_search`.
- **Automatic fetch fallback:** let OpenClaw try local page extraction first, then use TinyFish if it fails.
- **Advanced search:** use `tinyfish_search` for news, research papers, filters, and additional result metadata.
- **Page extraction:** use `tinyfish_fetch` for 1–10 public URLs, with a shared output budget and a separate result for each URL.
- **Highlights:** use `tinyfish_highlights` for question-focused passages when your account has access. Disabled by default.

## Requirements

- OpenClaw **2026.10.5**. Other versions have not been verified.
- Node.js **24.16.0 or later**, subject to OpenClaw’s own requirements.
- A TinyFish API key with search and fetch access. API calls may incur charges.

## Install

Install the plugin from npm on the Gateway host:

```sh
openclaw plugins install openclaw-tinyfish
```

To install a specific version:

```sh
openclaw plugins install openclaw-tinyfish@0.9.1
```

Review any installation warnings. Follow the installer’s runtime-application result to confirm that the Gateway loaded the plugin.

## Configure search and fetch

Save your API key, enable TinyFish search and fetch fallback, then try them. You only need to do this once. API calls may incur charges.

### 1. Save your API key

Run this command on the Gateway host as shown. `TINYFISH_API_KEY` is the name for the saved key; you will enter the key at the prompt.

```sh
openclaw secrets store set TINYFISH_API_KEY --kind secret \
  --allow-host api.search.tinyfish.ai \
  --allow-host api.fetch.tinyfish.ai
```

Paste your TinyFish API key at the hidden prompt and press Enter. OpenClaw stores it securely and limits its use to the two TinyFish API hosts.

**Paste the key only at the hidden prompt, not into the command or a chat message.**

### 2. Enable search and fetch fallback

Run these commands as shown. They connect the plugin to your saved key, select TinyFish for search, and enable automatic fetch fallback. You do not need to enter the key again or edit a configuration file.

```sh
openclaw config set plugins.entries.tinyfish.config.apiKey \
  --ref-source store --ref-provider default --ref-id TINYFISH_API_KEY

openclaw config set plugins.entries.tinyfish.enabled true
openclaw config set tools.web.search.enabled true
openclaw config set tools.web.search.provider tinyfish

openclaw config set plugins.entries.tinyfish.config.enableNativeFetch true
openclaw config set tools.web.fetch.enabled true
openclaw config set tools.web.fetch.cacheTtlMinutes 0
openclaw config set tools.web.fetch.provider tinyfish
```

The fetch cache is disabled because OpenClaw does not keep separate native fetch caches for different credentials. These commands preserve settings outside the paths shown above. If OpenClaw reports that a Gateway restart is needed, follow that instruction before testing.

### 3. Test search and page extraction

Ask your OpenClaw assistant:

> Use web_search to search for TinyFish and return one result. Tell me which provider handled the search.

Check that the tool result reports `provider: "tinyfish"`. To test TinyFish page extraction directly:

> Use tinyfish_fetch to extract https://example.com. Limit the text to 2000 characters.

This names the tool to verify TinyFish itself. For normal use, you can simply ask the assistant to read a page.

## Usage

Ask your assistant, for example:

> Search for recent battery recycling research. Use TinyFish research-paper search and return three results.

> Read these two public pages and summarize their main points.

The assistant can pass arguments such as:

```json
{"query":"battery recycling","domain_type":"research_paper","count":3}
```

```json
{"urls":["https://example.com"],"extractMode":"text","maxChars":2000}
```

See the [tool reference](docs/tools.md) for advanced inputs and output limits.

### How page fetching works

With the setup above, OpenClaw’s `web_fetch` first requests the page and tries local extraction. It uses TinyFish as a fallback when its own fetch or extraction fails. Simple pages may not need a TinyFish API call.

Local extraction can also return incomplete content without reporting a failure. If a page needs JavaScript rendering, or you want TinyFish batch extraction, ask for TinyFish explicitly:

> Use tinyfish_fetch to extract these two pages. Limit their combined text to 6000 characters.

Selecting TinyFish as the fetch provider does not send every page through TinyFish. Even with Readability disabled, OpenClaw can still return Markdown or JSON without calling the provider.

## Other setup methods

The steps above are the recommended path. If you completed them, you do not need these alternatives.

**Control UI:** instead of step 1, open **Settings → Secrets** in OpenClaw. Save a protected secret named `TINYFISH_API_KEY`. Allow `api.search.tinyfish.ai` and `api.fetch.tinyfish.ai`. Then continue with step 2.

**Assistant:** instead of step 1, ask your OpenClaw assistant to request the key through its masked credential prompt and save it as a protected secret with the same name and allowed hosts. Enter the key only in that prompt, not in chat. Then continue with step 2.

**Provider wizard:** OpenClaw also provides `openclaw configure --section web`. Select TinyFish and follow the prompts. The wizard may request a key instead of using the one you saved. If you want to keep using the protected secret store, cancel that prompt and use step 2 above.

## Optional features

**Highlights:** requires account access. Set `plugins.entries.tinyfish.config.enableHighlights` to `true` to enable `tinyfish_highlights`. If the API refuses access, disable the option and check your TinyFish account permissions.

## Limits and security

- Dedicated tools do not run in sandboxed contexts or when sandbox status is unknown. Native provider support also depends on host policy.
- Native `web_search` exposes OpenClaw’s fixed input/output schema. Use `tinyfish_search` for additional filters and metadata.
- Only public webpages are supported for extraction. Private-network targets and known raw download types are rejected. TinyFish controls remote intermediate redirects and DNS.
- The host resolves credentials. Missing, unresolved, or revoked current credentials fail closed. The plugin does not read the secret store or use a fallback environment key.
- Page content and search metadata are untrusted input. Tool output is bounded and wrapped accordingly.
- No automatic retries, purchases, or paid fallback endpoints. Cancellation does not guarantee cancellation of remote work or charges. A small result count limits returned output, not necessarily provider work.

## Troubleshooting

- **Search uses Codex instead of TinyFish:** Codex has a separate search route. Disable `tools.web.search.openaiCodex.enabled` to use the TinyFish provider selected in step 2. Preserve unrelated settings.
- **`missing_api_key` or `unresolved_secret`:** check the shared plugin SecretRef, then run `openclaw secrets reload`. Check that the Gateway has loaded the resolved credential. Do not replace the reference with a plaintext key.
- **TinyFish missing from native provider discovery:** inspect the plugin’s enabled and loaded state. If a plugin reload does not refresh discovery, a Gateway restart may be needed.
- **Tool unavailable in a sandbox:** use an authorized non-sandboxed session. Do not bypass host policy.
- **Highlights refused:** disable highlights. Confirm account access before another test.
- **Installation or trust warning:** review the package source and the host’s trust requirements before proceeding.

## Development

```sh
npm ci
npm run typecheck
npm run format:check
npm test
npm run build
npm run test:host
npm pack --dry-run
```

The host fixtures use temporary configuration and synthetic credentials. HTTP is mocked and socket connections are denied. They target build-specific internal OpenClaw modules. Update the fixtures when those module names change. Unit tests do not prove live API access.

For GitHub Actions releases, see the [publishing guide](docs/publishing.md).

## Remove

```sh
openclaw plugins uninstall tinyfish
```

Review the removal plan and select another search provider if needed. Treat the stored credential separately; uninstalling the plugin does not establish that the secret was deleted.

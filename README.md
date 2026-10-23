# TinyFish for OpenClaw

Use TinyFish to search the web and extract readable content, including JavaScript-rendered pages, from OpenClaw. The plugin calls the TinyFish APIs directly. No MCP server is required.

## Features

- **Native search:** select TinyFish as the backend for OpenClaw’s `web_search`.
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
openclaw plugins install openclaw-tinyfish@0.9.0
```

Review any installation warnings. Follow the installer’s runtime-application result to confirm that the Gateway loaded the plugin.

## Configure search

### 1. Store the key securely

In the OpenClaw Control UI, open **Settings → Secrets**. Store a protected secret named `TINYFISH_API_KEY`. Allow only these API hosts:

- `api.search.tinyfish.ai`
- `api.fetch.tinyfish.ai`

For command-line setup, run the command exactly as shown. `TINYFISH_API_KEY` is the name used to store your key. It is not a placeholder. Do not replace it with your API key.

```sh
openclaw secrets store set TINYFISH_API_KEY --kind secret \
  --allow-host api.search.tinyfish.ai \
  --allow-host api.fetch.tinyfish.ai
```

When prompted, paste your actual TinyFish API key and press Enter. The input is hidden. The key does not appear in the command or shell history.

You can also ask your OpenClaw assistant to request the key through its masked credential prompt. Choose one entry method; you do not need to store the key more than once. Never paste the key into a chat message.

### 2. Select TinyFish

Choose one configuration method. Do not run both.

#### Option A: use the stored SecretRef (recommended)

Save the following as `tinyfish.patch.json`. It contains a reference to the stored key, not the key itself. This merge patch preserves unrelated settings:

```json
{
  "plugins": {
    "entries": {
      "tinyfish": {
        "enabled": true,
        "config": {
          "apiKey": {
            "source": "store",
            "provider": "default",
            "id": "TINYFISH_API_KEY"
          }
        }
      }
    }
  },
  "tools": {
    "web": {
      "search": {
        "enabled": true,
        "provider": "tinyfish"
      }
    }
  }
}
```

Use the exact SecretRef returned by your store if its provider alias or entry name differs. Validate the patch before applying it:

```sh
openclaw config patch --file tinyfish.patch.json --dry-run --json
openclaw config patch --file tinyfish.patch.json
```

#### Option B: use the provider wizard

```sh
openclaw configure --section web
```

Select TinyFish and follow the credential prompts. The wizard may request a key instead of reusing an existing store reference. To preserve the protected-store setup, cancel in that case and use Option A.

Installation alone does not select TinyFish. If Codex’s separate search route is enabled, disable `tools.web.search.openaiCodex.enabled` when you want configured native search to use TinyFish. Preserve unrelated settings.

### 3. Verify the route

Ask your assistant to run `web_search` with one result. Confirm that the tool reports `provider: "tinyfish"`. Then ask it to extract a public page with `tinyfish_fetch`.

## Usage

Ask your assistant, for example:

> Search for recent battery recycling research. Use TinyFish research-paper search and return three results.

> Extract these two public pages with tinyfish_fetch. Limit their combined text to 6000 characters.

The assistant can pass arguments such as:

```json
{"query":"battery recycling","domain_type":"research_paper","count":3}
```

```json
{"urls":["https://example.com"],"extractMode":"text","maxChars":2000}
```

See the [tool reference](docs/tools.md) for advanced inputs and output limits.

## Optional features

**Highlights:** requires account access. Set `plugins.entries.tinyfish.config.enableHighlights` to `true` to enable `tinyfish_highlights`. If the API refuses access, disable the option and check your TinyFish account permissions.

**Native fetch:** disabled by default. Prefer `tinyfish_fetch` for explicit TinyFish extraction. Opt-in native registration requires `enableNativeFetch: true` and `tools.web.fetch.provider: "tinyfish"`. Set `tools.web.fetch.cacheTtlMinutes` to `0`: the host fetch cache is not credential-partitioned. Native `web_fetch` can perform an initial GET and local extraction before provider delegation. Disabling Readability does not force every request through TinyFish.

## Limits and security

- Dedicated tools do not run in sandboxed contexts or when sandbox status is unknown. Native provider support also depends on host policy.
- Native `web_search` exposes OpenClaw’s fixed input/output schema. Use `tinyfish_search` for additional filters and metadata.
- Only public webpages are supported for extraction. Private-network targets and known raw download types are rejected. TinyFish controls remote intermediate redirects and DNS.
- The host resolves credentials. Missing, unresolved, or revoked current credentials fail closed. The plugin does not read the secret store or use a fallback environment key.
- Page content and search metadata are untrusted input. Tool output is bounded and wrapped accordingly.
- No automatic retries, purchases, or paid fallback endpoints. Cancellation does not guarantee cancellation of remote work or charges. A small result count limits returned output, not necessarily provider work.

## Troubleshooting

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

## Remove

```sh
openclaw plugins uninstall tinyfish
```

Review the removal plan and select another search provider if needed. Treat the stored credential separately; uninstalling the plugin does not establish that the secret was deleted.

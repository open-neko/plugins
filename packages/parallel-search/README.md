# @open-neko/plugin-parallel-search

Web search + page fetch for [OpenNeko](https://github.com/open-neko/neko), backed by [Parallel.ai's Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp).

The plugin connects to `https://search.parallel.ai/mcp` over Streamable HTTP and exposes two action kinds.

## Install

```
openneko plugin install @open-neko/plugin-parallel-search
```

The anonymous tier works without any API key — try it first. To use the authenticated tier (higher rate limits), set your key in either:
- the manifest `env`: `"env": { "PARALLEL_API_KEY": "..." }` (env-injection ships in v2)
- the per-call payload: `payload.api_key` (works today; key is stored in `action_request.payload`)

## Actions

### `web_search`

| Field | Value |
|---|---|
| Scope | `external` |
| Payload | `{ query: string, api_key?: string, mcp_url?: string }` |
| Result | `{ text: string, bytes: number }` — concatenated text content from the MCP tool's `content[]` blocks (~25 KB cap upstream) |

`mcp_url` defaults to `https://search.parallel.ai/mcp`. Override to `https://search.parallel.ai/mcp-oauth` if your operator policy requires OAuth.

### `web_fetch`

| Field | Value |
|---|---|
| Scope | `external` |
| Payload | `{ url: string, api_key?: string, mcp_url?: string }` |
| Result | `{ text: string, bytes: number }` — markdown for the URL, token-efficient per upstream docs |

## Capabilities (manifest)

```yaml
network:
  - search.parallel.ai
```

The OpenNeko loader translates this declaration into the plugin VM's network policy. Any attempt by the plugin to reach a different host is blocked at the VM boundary.

## Local development

```
pnpm install
pnpm test
pnpm build           # → dist/run.js (bundled, ~980 KB; bundles @modelcontextprotocol/sdk)
node dist/run.js register '{}'
```

## License

Apache-2.0

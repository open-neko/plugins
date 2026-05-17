import {
  definePlugin,
  type PluginActionRequest,
  type PluginActionOutcome,
} from "@open-neko/plugin-types";
import {
  createMcpClient,
  joinTextContent,
  type McpToolClient,
  type McpToolResult,
} from "./mcp-client.js";

/**
 * Parallel.ai Search MCP — Streamable HTTP. The /mcp endpoint accepts
 * anonymous requests (free tier); /mcp-oauth requires OAuth. For
 * Bearer-token use, hit /mcp with an Authorization header.
 * See https://docs.parallel.ai/integrations/mcp/search-mcp.
 */
export const DEFAULT_PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";

export interface WebSearchPayload {
  query: string;
  api_key?: string;
  mcp_url?: string;
}

export interface WebFetchPayload {
  url: string;
  api_key?: string;
  mcp_url?: string;
}

export class ParallelSearchError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "ParallelSearchError";
  }
}

/** Test seam: inject a fake MCP client factory. */
export interface InvokeOptions {
  createClient?: (opts: {
    url: string;
    apiKey?: string | undefined;
  }) => Promise<McpToolClient>;
}

function resolveApiKey(payloadKey: string | undefined): string | undefined {
  return payloadKey ?? process.env.PARALLEL_API_KEY ?? undefined;
}

function resolveUrl(payloadUrl: string | undefined): string {
  return payloadUrl ?? process.env.PARALLEL_MCP_URL ?? DEFAULT_PARALLEL_MCP_URL;
}

async function withClient<T>(
  url: string,
  apiKey: string | undefined,
  options: InvokeOptions,
  fn: (client: McpToolClient) => Promise<T>,
): Promise<T> {
  const create = options.createClient ?? createMcpClient;
  const client = await create({ url, apiKey });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function unwrap(result: McpToolResult, toolName: string): string {
  if (result.isError) {
    const text = joinTextContent(result) || "(no error text)";
    throw new ParallelSearchError(
      `Parallel.ai ${toolName} returned isError: ${text.slice(0, 500)}`,
    );
  }
  const text = joinTextContent(result);
  if (!text) {
    throw new ParallelSearchError(
      `Parallel.ai ${toolName} returned no text content`,
    );
  }
  return text;
}

export async function runWebSearch(
  payload: WebSearchPayload,
  options: InvokeOptions = {},
): Promise<{ text: string }> {
  if (!payload.query || typeof payload.query !== "string") {
    throw new ParallelSearchError("payload.query (string) is required");
  }
  const url = resolveUrl(payload.mcp_url);
  const apiKey = resolveApiKey(payload.api_key);
  return withClient(url, apiKey, options, async (client) => {
    const result = await client.callTool("web_search", { query: payload.query });
    return { text: unwrap(result, "web_search") };
  });
}

export async function runWebFetch(
  payload: WebFetchPayload,
  options: InvokeOptions = {},
): Promise<{ text: string }> {
  if (!payload.url || typeof payload.url !== "string") {
    throw new ParallelSearchError("payload.url (string) is required");
  }
  const url = resolveUrl(payload.mcp_url);
  const apiKey = resolveApiKey(payload.api_key);
  return withClient(url, apiKey, options, async (client) => {
    const result = await client.callTool("web_fetch", { url: payload.url });
    return { text: unwrap(result, "web_fetch") };
  });
}

async function handleWebSearch(
  request: PluginActionRequest,
): Promise<PluginActionOutcome> {
  const payload = (request.payload ?? {}) as Partial<WebSearchPayload>;
  const { text } = await runWebSearch({
    query: payload.query ?? "",
    api_key: payload.api_key,
    mcp_url: payload.mcp_url,
  });
  return {
    commandOrOperation: `parallel.web_search: ${payload.query ?? ""}`,
    externalRef: null,
    result: { text, bytes: text.length },
  };
}

async function handleWebFetch(
  request: PluginActionRequest,
): Promise<PluginActionOutcome> {
  const payload = (request.payload ?? {}) as Partial<WebFetchPayload>;
  const { text } = await runWebFetch({
    url: payload.url ?? "",
    api_key: payload.api_key,
    mcp_url: payload.mcp_url,
  });
  return {
    commandOrOperation: `parallel.web_fetch: ${payload.url ?? ""}`,
    externalRef: null,
    result: { text, bytes: text.length },
  };
}

export default definePlugin({
  name: "@open-neko/plugin-parallel-search",
  version: "0.2.0",
  actions: [
    {
      kind: "web_search",
      description:
        "Search the web via Parallel.ai's Search MCP. Payload: " +
        "{ query: string, api_key?: string, mcp_url?: string }. " +
        "Returns concatenated excerpts as `text` (~25KB cap from upstream).",
      handler: handleWebSearch,
    },
    {
      kind: "web_fetch",
      description:
        "Fetch markdown for a single URL via Parallel.ai's Search MCP. Payload: " +
        "{ url: string, api_key?: string, mcp_url?: string }. " +
        "Returns the fetched markdown as `text`.",
      handler: handleWebFetch,
    },
  ],
});

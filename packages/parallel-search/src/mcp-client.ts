import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Single content block returned by an MCP tool call. */
export interface McpContent {
  type: string;
  text?: string;
  [k: string]: unknown;
}

/** Result of an MCP tools/call. Mirrors the SDK's CallToolResult shape. */
export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
  [k: string]: unknown;
}

/**
 * Minimal MCP tool-call interface the plugin depends on. Real impl
 * wraps @modelcontextprotocol/sdk; tests pass a fake.
 */
export interface McpToolClient {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface CreateMcpClientOptions {
  url: string;
  apiKey?: string | undefined;
  /** Identifier sent to the server as the MCP client name. */
  clientName?: string;
  /** SDK timeout for the initialize handshake + each tool call. */
  requestTimeoutMs?: number;
}

const DEFAULT_CLIENT_NAME = "open-neko-plugin-parallel-search";
const DEFAULT_CLIENT_VERSION = "0.2.0";

/**
 * Opens a Streamable HTTP MCP connection to the given URL. If an API
 * key is provided, it is sent as `Authorization: Bearer <key>` on
 * every HTTP request the SDK makes (the SDK's transport accepts
 * `requestInit.headers` for exactly this case). No header → anonymous
 * tier.
 *
 * Each call to this function = one MCP session. The plugin runner is
 * one-shot per RPC call (see PLUGINS_PLAN.md), so we open and close a
 * session per action; v2's long-running runner can hold the session
 * across calls without changing this interface.
 */
export async function createMcpClient(
  options: CreateMcpClientOptions,
): Promise<McpToolClient> {
  const url = new URL(options.url);
  const headers: Record<string, string> = {};
  if (options.apiKey) headers["Authorization"] = `Bearer ${options.apiKey}`;

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers },
  });
  const client = new Client({
    name: options.clientName ?? DEFAULT_CLIENT_NAME,
    version: DEFAULT_CLIENT_VERSION,
  });
  await client.connect(transport);

  return {
    async callTool(name, args) {
      const res = await client.callTool({ name, arguments: args });
      return res as McpToolResult;
    },
    async close() {
      try {
        await client.close();
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Concatenates all text-typed content blocks from a tool result.
 * Parallel's web_search/web_fetch return their excerpts as `text` blocks.
 */
export function joinTextContent(result: McpToolResult): string {
  return result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("\n\n");
}

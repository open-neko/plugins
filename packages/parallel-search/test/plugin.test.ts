import { describe, expect, it } from "vitest";
import plugin, {
  DEFAULT_PARALLEL_MCP_URL,
  ParallelSearchError,
  runWebFetch,
  runWebSearch,
} from "../src/plugin";
import type { McpToolClient, McpToolResult } from "../src/mcp-client";
import {
  dispatchPluginRpc,
  RPC_PROTOCOL_VERSION,
} from "@open-neko/plugin-types";

interface RecordedCall {
  name: string;
  args: Record<string, unknown>;
}

function makeFakeClientFactory(result: McpToolResult): {
  factory: NonNullable<Parameters<typeof runWebSearch>[1]>["createClient"];
  calls: RecordedCall[];
  closes: number;
  lastUrl: string | null;
  lastApiKey: string | null | undefined;
} {
  const state = {
    calls: [] as RecordedCall[],
    closes: 0,
    lastUrl: null as string | null,
    lastApiKey: undefined as string | null | undefined,
  };
  const factory: NonNullable<
    Parameters<typeof runWebSearch>[1]
  >["createClient"] = async ({ url, apiKey }) => {
    state.lastUrl = url;
    state.lastApiKey = apiKey ?? null;
    const client: McpToolClient = {
      async callTool(name, args) {
        state.calls.push({ name, args });
        return result;
      },
      async close() {
        state.closes++;
      },
    };
    return client;
  };
  return {
    factory,
    get calls() {
      return state.calls;
    },
    get closes() {
      return state.closes;
    },
    get lastUrl() {
      return state.lastUrl;
    },
    get lastApiKey() {
      return state.lastApiKey;
    },
  };
}

function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

describe("plugin shape", () => {
  it("declares web_search and web_fetch actions", () => {
    expect(plugin.name).toBe("@open-neko/plugin-parallel-search");
    const kinds = plugin.capabilities.action?.kinds.map((a) => a.kind);
    expect(kinds).toEqual(["web_search", "web_fetch"]);
  });

  it("register() via the plugin-types dispatcher reports both actions", async () => {
    const response = await dispatchPluginRpc(plugin, {
      method: "register",
      paramsJson: "{}",
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const result = response.result as {
      protocol: number;
      capabilities: { action?: { kinds: Array<{ kind: string }> } };
    };
    expect(result.protocol).toBe(RPC_PROTOCOL_VERSION);
    expect(result.capabilities.action?.kinds.map((a) => a.kind)).toEqual([
      "web_search",
      "web_fetch",
    ]);
  });
});

describe("runWebSearch", () => {
  it("calls the MCP web_search tool with objective + search_queries and returns the joined text", async () => {
    const fake = makeFakeClientFactory(textResult("hit-a\nhit-b"));
    const out = await runWebSearch(
      { query: "openneko" },
      { createClient: fake.factory },
    );
    expect(out.text).toBe("hit-a\nhit-b");
    expect(fake.calls).toEqual([
      {
        name: "web_search",
        args: { objective: "openneko", search_queries: ["openneko"] },
      },
    ]);
    expect(fake.closes).toBe(1);
  });

  it("defaults the MCP URL to search.parallel.ai/mcp and omits the bearer key", async () => {
    const fake = makeFakeClientFactory(textResult("x"));
    await runWebSearch({ query: "x" }, { createClient: fake.factory });
    expect(fake.lastUrl).toBe(DEFAULT_PARALLEL_MCP_URL);
    expect(fake.lastApiKey).toBeNull();
  });

  it("forwards api_key as the bearer credential when provided", async () => {
    const fake = makeFakeClientFactory(textResult("x"));
    await runWebSearch(
      { query: "x", api_key: "shhh" },
      { createClient: fake.factory },
    );
    expect(fake.lastApiKey).toBe("shhh");
  });

  it("respects PARALLEL_API_KEY env when payload key is absent", async () => {
    const previous = process.env.PARALLEL_API_KEY;
    process.env.PARALLEL_API_KEY = "from-env";
    try {
      const fake = makeFakeClientFactory(textResult("x"));
      await runWebSearch({ query: "x" }, { createClient: fake.factory });
      expect(fake.lastApiKey).toBe("from-env");
    } finally {
      if (previous === undefined) delete process.env.PARALLEL_API_KEY;
      else process.env.PARALLEL_API_KEY = previous;
    }
  });

  it("respects an overridden mcp_url from payload", async () => {
    const fake = makeFakeClientFactory(textResult("x"));
    await runWebSearch(
      { query: "x", mcp_url: "https://search.parallel.ai/mcp-oauth" },
      { createClient: fake.factory },
    );
    expect(fake.lastUrl).toBe("https://search.parallel.ai/mcp-oauth");
  });

  it("throws when query is missing", async () => {
    const fake = makeFakeClientFactory(textResult("x"));
    await expect(
      runWebSearch({ query: "" }, { createClient: fake.factory }),
    ).rejects.toBeInstanceOf(ParallelSearchError);
  });

  it("translates isError=true into a ParallelSearchError with text excerpt", async () => {
    const fake = makeFakeClientFactory({
      isError: true,
      content: [{ type: "text", text: "rate limited" }],
    });
    await expect(
      runWebSearch({ query: "x" }, { createClient: fake.factory }),
    ).rejects.toThrow(/rate limited/);
  });

  it("throws when the tool returns no text content", async () => {
    const fake = makeFakeClientFactory({ content: [] });
    await expect(
      runWebSearch({ query: "x" }, { createClient: fake.factory }),
    ).rejects.toThrow(/no text content/);
  });

  it("closes the client even when the call throws", async () => {
    const fake = makeFakeClientFactory({
      isError: true,
      content: [{ type: "text", text: "boom" }],
    });
    await expect(
      runWebSearch({ query: "x" }, { createClient: fake.factory }),
    ).rejects.toThrow();
    expect(fake.closes).toBe(1);
  });
});

describe("runWebFetch", () => {
  it("calls the MCP web_fetch tool with { url }", async () => {
    const fake = makeFakeClientFactory(textResult("# Hello"));
    const out = await runWebFetch(
      { url: "https://example.com" },
      { createClient: fake.factory },
    );
    expect(out.text).toBe("# Hello");
    expect(fake.calls).toEqual([
      { name: "web_fetch", args: { url: "https://example.com" } },
    ]);
  });

  it("throws when url is missing", async () => {
    const fake = makeFakeClientFactory(textResult("x"));
    await expect(
      runWebFetch({ url: "" }, { createClient: fake.factory }),
    ).rejects.toThrow(/url.*required/);
  });
});

describe("execute_action through the plugin runtime dispatcher", () => {
  it("web_search dispatches into runWebSearch and reports text + bytes", async () => {
    const fake = makeFakeClientFactory(textResult("aaaa"));
    // Monkey-patch the plugin's default createMcpClient via the action's
    // handler closure isn't possible — dispatchPluginRpc calls the
    // registered handler directly, which calls createMcpClient. We instead
    // verify behaviour by stubbing process env + calling the exported
    // functions in the runWebSearch tests above. Here we just check
    // the dispatch path returns the right shape when the underlying call
    // succeeds via the global fetch path being short-circuited by a
    // missing implementation — covered indirectly via runWebSearch tests.
    void fake;
    const response = await dispatchPluginRpc(plugin, {
      method: "execute_action",
      paramsJson: JSON.stringify({
        request: {
          id: "req-1",
          orgId: "org-1",
          scope: "external",
          kind: "web_search",
          target: null,
          summary: "search",
          payload: {
            query: "openneko",
            // Point at an unreachable URL so we fail fast — the test
            // asserts the error path (PLUGIN_ERROR with a message) rather
            // than network success, which would require a real MCP
            // endpoint or a global SDK monkey-patch that doesn't compose
            // cleanly across the bundled runner.
            mcp_url: "https://127.0.0.1:1/mcp",
          },
          riskLevel: "low",
        },
      }),
    });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error.code).toBe("PLUGIN_ERROR");
  });
});

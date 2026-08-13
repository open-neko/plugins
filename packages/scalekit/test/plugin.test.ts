import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin, {
  runBeginAuth,
  runBeginConnect,
  runCompleteAuth,
  runCompleteConnect,
  runMcpAction,
  runRefreshConnect,
  ScalekitPluginError,
} from "../src/plugin";
import type {
  ScalekitClient,
  ScalekitTokenResponse,
  ScalekitUserinfo,
} from "../src/scalekit-client";
import {
  pkceChallenge,
  serializeOauthState,
  type TokenSet,
} from "../src/mcp-oauth";
import {
  dispatchPluginRpc,
  RPC_PROTOCOL_VERSION,
  type ConnectorCredential,
} from "@open-neko/plugin-types";

const MCP_URL = "https://mcp.scalekit.com";

function fakeClient(opts: {
  authorizationUrl?: string;
  tokens?: ScalekitTokenResponse;
  userinfo?: ScalekitUserinfo;
}): ScalekitClient {
  return {
    buildAuthorizationUrl({ redirectUri, state, loginHint }) {
      return (
        opts.authorizationUrl ??
        `https://foo.scalekit.com/oauth/authorize?state=${state}&redirect=${redirectUri}&hint=${loginHint ?? ""}`
      );
    },
    async exchangeCode() {
      return (
        opts.tokens ?? {
          access_token: "at-1",
          token_type: "Bearer",
          expires_in: 3600,
        }
      );
    },
    async fetchUserinfo() {
      return (
        opts.userinfo ?? {
          sub: "user-1",
          email: "amit@example.com",
          name: "Amit",
        }
      );
    },
  };
}

interface FakeOauthRecorder {
  discoverResourceCalls: string[];
  discoverAsCalls: string[];
  registerCalls: Array<{ registrationEndpoint: string; redirectUris: string[] }>;
  exchangeCalls: Array<Record<string, unknown>>;
  refreshCalls: Array<Record<string, unknown>>;
}

function fakeMcpOauth(overrides: {
  resource?: { authorizationServers: string[]; scopesSupported: string[] };
  as?: { authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint: string | null };
  registered?: { clientId: string; clientSecret: string | null };
  tokenSet?: TokenSet;
  refreshSet?: TokenSet;
  recorder?: FakeOauthRecorder;
}) {
  const recorder = overrides.recorder ?? {
    discoverResourceCalls: [],
    discoverAsCalls: [],
    registerCalls: [],
    exchangeCalls: [],
    refreshCalls: [],
  };
  return {
    async discoverResource(mcpUrl: string) {
      recorder.discoverResourceCalls.push(mcpUrl);
      return (
        overrides.resource ?? {
          authorizationServers: ["https://as.scalekit.com"],
          scopesSupported: ["environment_read", "organization_write"],
        }
      );
    },
    async discoverAuthorizationServer(asUrl: string) {
      recorder.discoverAsCalls.push(asUrl);
      return (
        overrides.as ?? {
          authorizationEndpoint: "https://as.scalekit.com/authorize",
          tokenEndpoint: "https://as.scalekit.com/token",
          registrationEndpoint: "https://as.scalekit.com/register",
        }
      );
    },
    async registerClient(
      registrationEndpoint: string,
      input: { clientName: string; redirectUris: string[] },
    ) {
      recorder.registerCalls.push({
        registrationEndpoint,
        redirectUris: input.redirectUris,
      });
      return (
        overrides.registered ?? {
          clientId: "dcr-client-1",
          clientSecret: null,
        }
      );
    },
    buildAuthorizationUrl(input: {
      authorizationEndpoint: string;
      clientId: string;
      redirectUri: string;
      state: string;
      codeVerifier: string;
      scopes: string[];
    }) {
      return `https://as.scalekit.com/authorize?client_id=${input.clientId}&state=${input.state}&scope=${encodeURIComponent(input.scopes.join(" "))}`;
    },
    async exchangeCode(input: Record<string, unknown>) {
      recorder.exchangeCalls.push(input);
      return (
        overrides.tokenSet ?? {
          access_token: "at-mgmt",
          refresh_token: "rt-mgmt",
          expires_in: 3600,
        }
      );
    },
    async refreshTokens(input: Record<string, unknown>) {
      recorder.refreshCalls.push(input);
      return (
        overrides.refreshSet ?? {
          access_token: "at-refreshed",
          refresh_token: "rt-rotated",
          expires_in: 3600,
        }
      );
    },
  };
}

describe("plugin shape", () => {
  it("declares auth + deployment-scoped mcp-oauth connect + MCP tool actions", () => {
    expect(plugin.name).toBe("@open-neko/plugin-scalekit");
    expect(plugin.capabilities.auth?.providerLabel).toBe("Scalekit");
    expect(plugin.capabilities.connect?.flow).toBe("mcp-oauth");
    expect(plugin.capabilities.connect?.credentialScope).toBe("deployment");
    expect(plugin.capabilities.connect?.providerLabel).toBe("Scalekit workspace");
    const kinds = plugin.capabilities.action?.kinds ?? [];
    expect(kinds.length).toBeGreaterThanOrEqual(30);
    const names = kinds.map((k) => k.kind);
    expect(names).toContain("generate_admin_portal_link");
    expect(names).toContain("get_environment_credentials");
    expect(names).toContain("list_organization_connections");
    expect(names).not.toContain("get_scalekit_organization");
    expect(names).not.toContain("generate_scalekit_portal_link");
    for (const k of kinds) {
      expect(typeof k.handler).toBe("function");
    }
  });

  it("register() via dispatcher carries auth + connect + action", async () => {
    const r = await dispatchPluginRpc(plugin, {
      method: "register",
      paramsJson: "{}",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = r.result as {
      protocol: number;
      capabilities: {
        action?: { kinds: Array<{ kind: string }> };
        auth?: { providerLabel?: string };
        connect?: {
          flow?: string;
          credentialScope?: string;
          scopes?: string[];
        };
      };
    };
    expect(out.protocol).toBe(RPC_PROTOCOL_VERSION);
    expect(out.capabilities.auth?.providerLabel).toBe("Scalekit");
    expect(out.capabilities.connect?.flow).toBe("mcp-oauth");
    expect(out.capabilities.connect?.credentialScope).toBe("deployment");
    expect(out.capabilities.action?.kinds.map((k) => k.kind)).toContain(
      "list_environments",
    );
  });
});

describe("env resolution (auth)", () => {
  it("throws ScalekitPluginError when env vars missing", async () => {
    const previous = {
      env: process.env.SCALEKIT_ENVIRONMENT_URL,
      id: process.env.SCALEKIT_CLIENT_ID,
      secret: process.env.SCALEKIT_CLIENT_SECRET,
    };
    delete process.env.SCALEKIT_ENVIRONMENT_URL;
    delete process.env.SCALEKIT_CLIENT_ID;
    delete process.env.SCALEKIT_CLIENT_SECRET;
    try {
      await expect(
        runBeginAuth(
          { redirectUri: "https://app.example.com/cb", state: "x" },
          { createClient: () => ({} as ScalekitClient) },
        ),
      ).rejects.toBeInstanceOf(ScalekitPluginError);
    } finally {
      if (previous.env !== undefined)
        process.env.SCALEKIT_ENVIRONMENT_URL = previous.env;
      if (previous.id !== undefined)
        process.env.SCALEKIT_CLIENT_ID = previous.id;
      if (previous.secret !== undefined)
        process.env.SCALEKIT_CLIENT_SECRET = previous.secret;
    }
  });
});

describe("auth capability", () => {
  beforeEach(() => {
    process.env.SCALEKIT_ENVIRONMENT_URL = "https://foo.scalekit.com";
    process.env.SCALEKIT_CLIENT_ID = "c";
    process.env.SCALEKIT_CLIENT_SECRET = "s";
  });
  afterEach(() => {
    delete process.env.SCALEKIT_ENVIRONMENT_URL;
    delete process.env.SCALEKIT_CLIENT_ID;
    delete process.env.SCALEKIT_CLIENT_SECRET;
  });

  it("runBeginAuth returns the client-built URL", async () => {
    const result = await runBeginAuth(
      { redirectUri: "https://app.example.com/cb", state: "csrf" },
      {
        createClient: () =>
          fakeClient({
            authorizationUrl: "https://foo.scalekit.com/oauth/authorize?stub=1",
          }),
      },
    );
    expect(result.authorizationUrl).toBe(
      "https://foo.scalekit.com/oauth/authorize?stub=1",
    );
  });

  it("runCompleteAuth maps identity + groups", async () => {
    const result = await runCompleteAuth(
      { code: "c", redirectUri: "https://app.example.com/cb", state: "s" },
      {
        createClient: () =>
          fakeClient({
            userinfo: {
              sub: "user-1",
              email: "amit@example.com",
              name: "Amit",
              organization_id: "org-1",
              groups: ["everyone"],
              roles: ["admin"],
            },
          }),
      },
    );
    expect(result.identity).toEqual({
      sub: "user-1",
      email: "amit@example.com",
      name: "Amit",
      orgId: "org-1",
      groups: ["everyone", "admin"],
    });
  });
});

describe("connect capability (mcp-oauth)", () => {
  beforeEach(() => {
    delete process.env.SCALEKIT_MCP_URL;
  });
  afterEach(() => {
    delete process.env.SCALEKIT_MCP_URL;
  });

  it("begin discovers + registers + returns authorizationUrl with oauthState", async () => {
    const recorder: FakeOauthRecorder = {
      discoverResourceCalls: [],
      discoverAsCalls: [],
      registerCalls: [],
      exchangeCalls: [],
      refreshCalls: [],
    };
    const result = await runBeginConnect(
      {
        operatorId: "__deployment__",
        redirectUri: "https://app.example.com/api/integrations/connect/callback",
        state: "csrf-1",
        scopes: [],
      },
      { createMcpOAuth: () => fakeMcpOauth({ recorder }) },
    );
    expect(result.authorizationUrl).toContain("client_id=dcr-client-1");
    expect(result.oauthState).toBeTruthy();
    expect(recorder.discoverResourceCalls).toEqual([MCP_URL]);
    expect(recorder.discoverAsCalls).toEqual(["https://as.scalekit.com"]);
    expect(recorder.registerCalls).toEqual([
      {
        registrationEndpoint: "https://as.scalekit.com/register",
        redirectUris: [
          "https://app.example.com/api/integrations/connect/callback",
        ],
      },
    ]);
  });

  it("begin falls back to discovered scopes and generates a PKCE verifier", async () => {
    const recorder: FakeOauthRecorder = {
      discoverResourceCalls: [],
      discoverAsCalls: [],
      registerCalls: [],
      exchangeCalls: [],
      refreshCalls: [],
    };
    const result = await runBeginConnect(
      {
        operatorId: "__deployment__",
        redirectUri: "https://app.example.com/cb",
        state: "s",
        scopes: [],
      },
      { createMcpOAuth: () => fakeMcpOauth({ recorder }) },
    );
    const parsed = JSON.parse(
      Buffer.from(result.oauthState!, "base64url").toString("utf8"),
    ) as { codeVerifier: string; scopes: string[]; tokenEndpoint: string };
    expect(parsed.scopes).toEqual(["environment_read", "organization_write"]);
    expect(parsed.tokenEndpoint).toBe("https://as.scalekit.com/token");
    expect(parsed.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pkceChallenge(parsed.codeVerifier)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("complete exchanges the code and returns a refreshable credential", async () => {
    const oauthState = serializeOauthState({
      mcpUrl: MCP_URL,
      authorizationServerUrl: "https://as.scalekit.com",
      tokenEndpoint: "https://as.scalekit.com/token",
      clientId: "dcr-client-1",
      clientSecret: null,
      codeVerifier: "verifier-1234567890123456789012345678901234567890123",
      scopes: ["environment_read"],
      redirectUri: "https://app.example.com/cb",
    });
    const recorder: FakeOauthRecorder = {
      discoverResourceCalls: [],
      discoverAsCalls: [],
      registerCalls: [],
      exchangeCalls: [],
      refreshCalls: [],
    };
    const result = await runCompleteConnect(
      {
        operatorId: "__deployment__",
        code: "auth-code",
        redirectUri: "https://app.example.com/cb",
        state: "s",
        scopes: [],
        oauthState,
      },
      { createMcpOAuth: () => fakeMcpOauth({ recorder }) },
    );
    expect(recorder.exchangeCalls[0]).toMatchObject({
      code: "auth-code",
      codeVerifier: "verifier-1234567890123456789012345678901234567890123",
    });
    const tokens = result.credential.tokens as Record<string, unknown>;
    expect(tokens.access_token).toBe("at-mgmt");
    expect(tokens.refresh_token).toBe("rt-mgmt");
    expect(tokens.token_endpoint).toBe("https://as.scalekit.com/token");
    expect(tokens.client_id).toBe("dcr-client-1");
    expect(tokens.expires_at).toBeTypeOf("string");
  });

  it("refresh rotates the stored credential", async () => {
    const current: ConnectorCredential = {
      tokens: {
        access_token: "at-old",
        refresh_token: "rt-old",
        expires_at: "0",
        token_endpoint: "https://as.scalekit.com/token",
        client_id: "dcr-client-1",
        client_secret: "",
      },
      connectedAt: new Date().toISOString(),
    };
    const recorder: FakeOauthRecorder = {
      discoverResourceCalls: [],
      discoverAsCalls: [],
      registerCalls: [],
      exchangeCalls: [],
      refreshCalls: [],
    };
    const result = await runRefreshConnect(
      { operatorId: "__deployment__", current },
      { createMcpOAuth: () => fakeMcpOauth({ recorder }) },
    );
    expect(recorder.refreshCalls[0]).toMatchObject({
      refreshToken: "rt-old",
      clientId: "dcr-client-1",
    });
    const tokens = result.credential.tokens as Record<string, unknown>;
    expect(tokens.access_token).toBe("at-refreshed");
    expect(tokens.refresh_token).toBe("rt-rotated");
    expect(result.credential.refreshedAt).toBeTypeOf("string");
  });

  it("complete without oauthState throws a clear error", async () => {
    await expect(
      runCompleteConnect(
        {
          operatorId: "__deployment__",
          code: "c",
          redirectUri: "https://app.example.com/cb",
          state: "s",
          scopes: [],
        },
        { createMcpOAuth: () => fakeMcpOauth({}) },
      ),
    ).rejects.toThrow(/oauthState/);
  });
});

describe("action capability (MCP tool wrappers)", () => {
  afterEach(() => {
    delete process.env.OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS;
    delete process.env.SCALEKIT_MCP_URL;
  });

  function credentialTokens(overrides: Record<string, unknown> = {}) {
    return {
      access_token: "at-fresh",
      refresh_token: "rt-1",
      expires_at: String(Date.now() + 3600_000),
      token_endpoint: "https://as.scalekit.com/token",
      client_id: "dcr-client-1",
      client_secret: "",
      ...overrides,
    };
  }

  it("calls the MCP tool with the payload and returns the text", async () => {
    process.env.OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS = JSON.stringify(
      credentialTokens(),
    );
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const result = await runMcpAction(
      "list_environments",
      {
        id: "req-1",
        orgId: "org-1",
        actorId: null,
        scope: "internal",
        kind: "list_environments",
        target: null,
        summary: null,
        payload: { pageToken: "1" },
        riskLevel: null,
      },
      {
        createMcpClient: async () => ({
          async callTool(name, args) {
            toolCalls.push({ name, args });
            return { content: [{ type: "text", text: "env_1 DEV" }] };
          },
          async close() {},
        }),
      },
    );
    expect(toolCalls).toEqual([
      { name: "list_environments", args: { pageToken: "1" } },
    ]);
    expect(result.result).toEqual({ text: "env_1 DEV", isError: false });
  });

  it("refreshes in-memory when the access token is expired", async () => {
    process.env.OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS = JSON.stringify(
      credentialTokens({ access_token: "", expires_at: "0" }),
    );
    const recorder: FakeOauthRecorder = {
      discoverResourceCalls: [],
      discoverAsCalls: [],
      registerCalls: [],
      exchangeCalls: [],
      refreshCalls: [],
    };
    const accessTokensSeen: string[] = [];
    await runMcpAction(
      "get_environment_credentials",
      {
        id: "req-2",
        orgId: "org-1",
        actorId: null,
        scope: "internal",
        kind: "get_environment_credentials",
        target: null,
        summary: null,
        payload: { environmentId: "env_1" },
        riskLevel: null,
      },
      {
        createMcpOAuth: () => fakeMcpOauth({ recorder }),
        createMcpClient: async ({ accessToken }) => {
          accessTokensSeen.push(accessToken);
          return {
            async callTool() {
              return { content: [{ type: "text", text: "SCALEKIT_ENVIRONMENT_URL=..." }] };
            },
            async close() {},
          };
        },
      },
    );
    expect(recorder.refreshCalls.length).toBe(1);
    expect(accessTokensSeen).toEqual(["at-refreshed"]);
  });

  it("throws a clear error when the workspace is not connected", async () => {
    delete process.env.OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS;
    await expect(
      runMcpAction(
        "list_environments",
        {
          id: "req-3",
          orgId: "org-1",
          actorId: null,
          scope: "internal",
          kind: "list_environments",
          target: null,
          summary: null,
          payload: {},
          riskLevel: null,
        },
        { createMcpClient: async () => ({ callTool: async () => ({ content: [] }), close: async () => {} }) },
      ),
    ).rejects.toThrow(/not connected/);
  });
});

describe("dispatcher integration", () => {
  beforeEach(() => {
    process.env.SCALEKIT_ENVIRONMENT_URL = "https://foo.scalekit.com";
    process.env.SCALEKIT_CLIENT_ID = "c";
    process.env.SCALEKIT_CLIENT_SECRET = "s";
  });
  afterEach(() => {
    delete process.env.SCALEKIT_ENVIRONMENT_URL;
    delete process.env.SCALEKIT_CLIENT_ID;
    delete process.env.SCALEKIT_CLIENT_SECRET;
  });

  it("begin_auth via dispatcher surfaces missing-env errors", async () => {
    delete process.env.SCALEKIT_ENVIRONMENT_URL;
    const r = await dispatchPluginRpc(plugin, {
      method: "begin_auth",
      paramsJson: JSON.stringify({
        params: {
          redirectUri: "https://app.example.com/cb",
          state: "csrf",
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/SCALEKIT_ENVIRONMENT_URL/);
  });
});

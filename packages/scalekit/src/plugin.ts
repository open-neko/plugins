import {
  definePlugin,
  type AuthIdentity,
  type BeginAuthParams,
  type BeginAuthResult,
  type BeginConnectParams,
  type BeginConnectResult,
  type CompleteAuthParams,
  type CompleteAuthResult,
  type CompleteConnectParams,
  type CompleteConnectResult,
  type ApplyDirectoryChangeParams,
  type ApplyDirectoryChangeResult,
  type ListDirectoryParams,
  type ListDirectoryResult,
  type ConnectorCredential,
  type PluginActionOutcome,
  type PluginActionRequest,
  type RefreshConnectParams,
  type RefreshConnectResult,
} from "@open-neko/plugin-types";
import {
  createScalekitClient,
  type ScalekitClient,
  type ScalekitUserinfo,
} from "./scalekit-client.js";
import { createScalekitDirectory } from "./directory.js";
import {
  createMcpClient,
  joinTextContent,
  SCALEKIT_MCP_TOOLS,
  type McpToolClient,
} from "./mcp-tools.js";
import {
  createMcpOAuth,
  generatePkceVerifier,
  parseOauthState,
  serializeOauthState,
  type OauthState,
} from "./mcp-oauth.js";

const DEFAULT_MCP_URL = "https://mcp.scalekit.com/";

/**
 * Display list of OAuth scopes for the consent screen. The actual OAuth
 * scope strings are discovered at runtime from the MCP server's protected
 * resource metadata (`scopes_supported`); begin requests the full menu
 * (wks:read/write, env:read/write, org:read/write on Scalekit's hosted
 * server) and the consent screen enumerates them.
 */
const DECLARED_SCOPES = [
  "wks:read",
  "wks:write",
  "env:read",
  "env:write",
  "org:read",
  "org:write",
];

/** Test seam: inject fakes instead of constructing the real clients. */
export interface InvokeOptions {
  createClient?: (env: ResolvedEnv) => ScalekitClient;
  createMcpOAuth?: () => ReturnType<typeof createMcpOAuth>;
  createDirectory?: (env: ResolvedEnv & { organizationId: string }) => ReturnType<typeof createScalekitDirectory>;
  createMcpClient?: (options: {
    url: string;
    accessToken: string;
  }) => Promise<McpToolClient>;
}

export class ScalekitPluginError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "ScalekitPluginError";
  }
}

interface ResolvedEnv {
  environmentUrl: string;
  clientId: string;
  clientSecret: string;
}

function resolveEnv(): ResolvedEnv {
  const environmentUrl = process.env.SCALEKIT_ENVIRONMENT_URL;
  const clientId = process.env.SCALEKIT_CLIENT_ID;
  const clientSecret = process.env.SCALEKIT_CLIENT_SECRET;
  const missing: string[] = [];
  if (!environmentUrl) missing.push("SCALEKIT_ENVIRONMENT_URL");
  if (!clientId) missing.push("SCALEKIT_CLIENT_ID");
  if (!clientSecret) missing.push("SCALEKIT_CLIENT_SECRET");
  if (missing.length > 0) {
    throw new ScalekitPluginError(
      `${missing.join(", ")} not set (run \`openneko secrets set @open-neko/plugin-scalekit ${missing[0]}\`)`,
    );
  }
  return {
    environmentUrl: environmentUrl as string,
    clientId: clientId as string,
    clientSecret: clientSecret as string,
  };
}

function resolveMcpUrl(): string {
  const raw = process.env.SCALEKIT_MCP_URL ?? DEFAULT_MCP_URL;
  return raw.trim().replace(/\/+$/, "");
}

function clientOrDefault(options: InvokeOptions): ScalekitClient {
  const env = resolveEnv();
  const make =
    options.createClient ??
    ((e) =>
      createScalekitClient({
        environmentUrl: e.environmentUrl,
        clientId: e.clientId,
        clientSecret: e.clientSecret,
      }));
  return make(env);
}

function mcpOauthOrDefault(options: InvokeOptions) {
  return options.createMcpOAuth ? options.createMcpOAuth() : createMcpOAuth();
}

// ─── auth capability (SSO sign-in) ─────────────────────────────────────

export async function runBeginAuth(
  params: BeginAuthParams,
  options: InvokeOptions = {},
): Promise<BeginAuthResult> {
  if (!params.redirectUri) {
    throw new ScalekitPluginError("params.redirectUri is required");
  }
  if (!params.state) {
    throw new ScalekitPluginError("params.state is required");
  }
  const client = clientOrDefault(options);
  const authorizationUrl = client.buildAuthorizationUrl({
    redirectUri: params.redirectUri,
    state: params.state,
    loginHint: params.loginHint ?? null,
  });
  return { authorizationUrl };
}

export async function runCompleteAuth(
  params: CompleteAuthParams,
  options: InvokeOptions = {},
): Promise<CompleteAuthResult> {
  if (!params.code) {
    throw new ScalekitPluginError("params.code is required");
  }
  if (!params.redirectUri) {
    throw new ScalekitPluginError("params.redirectUri is required");
  }
  if (!params.state) {
    throw new ScalekitPluginError("params.state is required");
  }
  const client = clientOrDefault(options);
  const tokens = await client.exchangeCode({
    code: params.code,
    redirectUri: params.redirectUri,
  });
  const userinfo = await client.fetchUserinfo(tokens.access_token);
  const identity = toIdentity(userinfo);
  return { identity };
}

function toIdentity(info: ScalekitUserinfo): AuthIdentity {
  const email = info.email ?? "";
  if (!email) {
    // OpenNeko keys app_user off email; an IdP that doesn't return one
    // is not usable here. Surface a clear error rather than silently
    // creating a user with no email.
    throw new ScalekitPluginError(
      "Scalekit userinfo returned no email — check the IdP's released scopes",
    );
  }
  const groups = collectGroups(info);
  const displayName =
    info.name ??
    [info.given_name, info.family_name].filter(Boolean).join(" ").trim() ??
    null;
  return {
    sub: info.sub,
    email,
    name: displayName && displayName.length > 0 ? displayName : null,
    orgId: info.organization_id ?? null,
    groups,
  };
}

function collectGroups(info: ScalekitUserinfo): string[] {
  // Different downstream IdPs surface group membership under
  // `groups` (Okta default), `roles` (Entra), or both. We union them
  // so OpenNeko's role mapping only has to look at one list.
  const out = new Set<string>();
  for (const g of info.groups ?? []) {
    if (typeof g === "string" && g) out.add(g);
  }
  for (const r of info.roles ?? []) {
    if (typeof r === "string" && r) out.add(r);
  }
  return [...out];
}

// ─── directory capability (SCIM users and groups) ──────────────────────

function directoryOrDefault(options: InvokeOptions) {
  const env = resolveEnv();
  const organizationId = process.env.SCALEKIT_ORGANIZATION_ID?.trim();
  if (!organizationId) {
    throw new ScalekitPluginError(
      "SCALEKIT_ORGANIZATION_ID not set (run `openneko secrets set @open-neko/plugin-scalekit SCALEKIT_ORGANIZATION_ID`)",
    );
  }
  const make = options.createDirectory ?? createScalekitDirectory;
  return make({ ...env, organizationId });
}

export async function runListDirectory(
  params: ListDirectoryParams,
  options: InvokeOptions = {},
): Promise<ListDirectoryResult> {
  return directoryOrDefault(options).list(params);
}

export async function runApplyDirectoryChange(
  params: ApplyDirectoryChangeParams,
  options: InvokeOptions = {},
): Promise<ApplyDirectoryChangeResult> {
  return directoryOrDefault(options).apply(params);
}

// ─── connect capability (deployment-scoped MCP-OAuth) ──────────────────

/**
 * Begin the MCP-OAuth-2.1 dance: discover the protected resource + AS
 * metadata, register the client (DCR), build the PKCE authorization URL,
 * and serialize the in-flight state into oauthState for the core to echo
 * back on complete.
 */
export async function runBeginConnect(
  params: BeginConnectParams,
  options: InvokeOptions = {},
): Promise<BeginConnectResult> {
  if (!params.redirectUri) {
    throw new ScalekitPluginError("params.redirectUri is required");
  }
  if (!params.state) {
    throw new ScalekitPluginError("params.state is required");
  }
  const oauth = mcpOauthOrDefault(options);
  const mcpUrl = resolveMcpUrl();
  const resource = await oauth.discoverResource(mcpUrl);
  const asUrl = resource.authorizationServers[0];
  if (!asUrl) {
    throw new ScalekitPluginError(
      `Scalekit MCP server at ${mcpUrl} advertised no authorization server`,
    );
  }
  const as = await oauth.discoverAuthorizationServer(asUrl);
  let clientId = "";
  let clientSecret: string | null = null;
  if (as.registrationEndpoint) {
    const registered = await oauth.registerClient(as.registrationEndpoint, {
      clientName: "openneko-plugin-scalekit",
      redirectUris: [params.redirectUri],
    });
    clientId = registered.clientId;
    clientSecret = registered.clientSecret;
  }
  if (!clientId) {
    throw new ScalekitPluginError(
      "Scalekit MCP authorization server did not support client registration (DCR)",
    );
  }
  const codeVerifier = params.codeVerifier ?? generatePkceVerifier();
  // mcp-oauth: the authorization server's discovered scopes are the truth.
  // The manifest list is display metadata only — requesting anything less
  // than the full menu yields a token that fails the server's per-tool
  // scope validation (401 on tools/call).
  const scopes = resource.scopesSupported;
  const authorizationUrl = oauth.buildAuthorizationUrl({
    authorizationEndpoint: as.authorizationEndpoint,
    clientId,
    redirectUri: params.redirectUri,
    state: params.state,
    codeVerifier,
    scopes,
  });
  const oauthState: OauthState = {
    mcpUrl,
    authorizationServerUrl: asUrl,
    tokenEndpoint: as.tokenEndpoint,
    clientId,
    clientSecret,
    codeVerifier,
    scopes,
    redirectUri: params.redirectUri,
  };
  return { authorizationUrl, oauthState: serializeOauthState(oauthState) };
}

/**
 * Exchange the authorization code using the echoed oauthState, returning
 * a ConnectorCredential whose tokens carry everything refresh needs
 * (access/refresh tokens, token endpoint, DCR client creds, expiry).
 */
export async function runCompleteConnect(
  params: CompleteConnectParams,
  options: InvokeOptions = {},
): Promise<CompleteConnectResult> {
  if (!params.code) {
    throw new ScalekitPluginError("params.code is required");
  }
  const state = parseOauthState(params.oauthState);
  const oauth = mcpOauthOrDefault(options);
  const codeVerifier = params.codeVerifier ?? state.codeVerifier;
  const tokens = await oauth.exchangeCode({
    tokenEndpoint: state.tokenEndpoint,
    clientId: state.clientId,
    clientSecret: state.clientSecret,
    code: params.code,
    redirectUri: params.redirectUri || state.redirectUri,
    codeVerifier,
  });
  const credential: ConnectorCredential = {
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at:
        tokens.expires_in != null
          ? String(Date.now() + tokens.expires_in * 1000)
          : null,
      token_endpoint: state.tokenEndpoint,
      client_id: state.clientId,
      client_secret: state.clientSecret ?? "",
    },
    scopes: state.scopes.length > 0 ? state.scopes : undefined,
    providerLabel: "Scalekit workspace",
    connectedAt: new Date().toISOString(),
  };
  return { credential };
}

/** Rotate the deployment's refresh token; the worker persists the writeback. */
export async function runRefreshConnect(
  params: RefreshConnectParams,
  options: InvokeOptions = {},
): Promise<RefreshConnectResult> {
  const t = params.current.tokens as Record<string, unknown>;
  const tokenEndpoint = str(t.token_endpoint);
  const clientId = str(t.client_id);
  const refreshToken = str(t.refresh_token);
  if (!tokenEndpoint || !clientId || !refreshToken) {
    throw new ScalekitPluginError(
      "stored credential is missing token_endpoint/client_id/refresh_token — reconnect the workspace",
    );
  }
  const oauth = mcpOauthOrDefault(options);
  const tokens = await oauth.refreshTokens({
    tokenEndpoint,
    clientId,
    clientSecret: strOrNull(t.client_secret),
    refreshToken,
  });
  const credential: ConnectorCredential = {
    ...params.current,
    tokens: {
      ...t,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
      expires_at:
        tokens.expires_in != null
          ? String(Date.now() + tokens.expires_in * 1000)
          : t.expires_at,
    },
    refreshedAt: new Date().toISOString(),
  };
  return { credential };
}

// ─── action capability (MCP tool wrappers) ─────────────────────────────

/**
 * Read the deployment credential the worker injected for this call. The
 * worker pre-refreshes near expiry; if the token is still stale here we
 * refresh in-memory so the call can proceed (the rotation is lost, but the
 * worker's next pre-refresh re-syncs).
 */
async function freshAccessToken(
  tokens: Record<string, unknown>,
  options: InvokeOptions,
): Promise<string> {
  const accessToken = str(tokens.access_token);
  const expiresAt = num(tokens.expires_at);
  if (accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) {
    return accessToken;
  }
  const oauth = mcpOauthOrDefault(options);
  const tokenEndpoint = str(tokens.token_endpoint);
  const clientId = str(tokens.client_id);
  const refreshToken = str(tokens.refresh_token);
  if (!tokenEndpoint || !clientId || !refreshToken) {
    throw new ScalekitPluginError(
      "Scalekit workspace is not connected — authorize it on the Integrations page first",
    );
  }
  const refreshed = await oauth.refreshTokens({
    tokenEndpoint,
    clientId,
    clientSecret: strOrNull(tokens.client_secret),
    refreshToken,
  });
  return refreshed.access_token;
}

function readCredentialFromEnv(): Record<string, unknown> {
  const raw = process.env.OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS;
  if (!raw) {
    throw new ScalekitPluginError(
      "Scalekit workspace is not connected — authorize it on the Integrations page first",
    );
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new ScalekitPluginError(
      "OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS is not valid JSON",
      err,
    );
  }
}

export async function runMcpAction(
  kind: string,
  request: PluginActionRequest,
  options: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  const tokens = readCredentialFromEnv();
  const accessToken = await freshAccessToken(tokens, options);
  const mcpUrl = resolveMcpUrl();
  const make =
    options.createMcpClient ??
    ((opts) => createMcpClient({ url: opts.url, accessToken: opts.accessToken }));
  const client = await make({ url: mcpUrl, accessToken });
  try {
    const result = await client.callTool(
      kind,
      (request.payload ?? {}) as Record<string, unknown>,
    );
    const text = joinTextContent(result);
    return { result: { text, isError: result.isError === true } };
  } finally {
    await client.close().catch(() => {});
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export default definePlugin({
  name: "@open-neko/plugin-scalekit",
  version: "0.5.0", // x-release-please-version
  capabilities: {
    auth: {
      providerLabel: "Scalekit",
      begin: (params) => runBeginAuth(params),
      complete: (params) => runCompleteAuth(params),
    },
    connect: {
      providerLabel: "Scalekit workspace",
      flow: "mcp-oauth",
      credentialScope: "deployment",
      scopes: DECLARED_SCOPES,
      begin: (params) => runBeginConnect(params),
      complete: (params) => runCompleteConnect(params),
      refresh: (params) => runRefreshConnect(params),
    },
    directory: {
      providerLabel: "Scalekit directory",
      read: { users: true, groups: true, memberships: true },
      write: { createUser: true, deactivateUser: false },
      list: (params) => runListDirectory(params),
      apply: (params) => runApplyDirectoryChange(params),
    },
    action: {
      kinds: SCALEKIT_MCP_TOOLS.map((tool) => ({
        kind: tool.kind,
        description: tool.description,
        default_mode: tool.default_mode,
        example: tool.example,
        handler: (request: PluginActionRequest) =>
          runMcpAction(tool.kind, request),
      })),
    },
  },
});

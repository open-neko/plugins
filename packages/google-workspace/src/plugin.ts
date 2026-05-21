/**
 * Google Workspace connector plugin.
 *
 * Two surfaces:
 *
 *   1. `connect` — per-operator OAuth2 + PKCE flow against the
 *      operator's own Google Cloud OAuth client. Each operator on
 *      this deployment authorises independently; the worker
 *      persists the resulting credentials in the per-operator
 *      section of the secrets store.
 *
 *   2. `action` — Gmail / Calendar / Sheets actions backed by the
 *      connected operator's account. At action-execution time the
 *      worker injects the operator's credential as the
 *      OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS env var (JSON-encoded
 *      access_token + refresh_token); the action handler reads it,
 *      makes the API call, and returns the outcome.
 *
 * No tokens cross the sandbox boundary except via this env-var
 * injection — the plugin never persists anything to disk; the
 * worker is the only writer to secrets.json.
 */

import { createHash } from "node:crypto";
import {
  definePlugin,
  type BeginConnectParams,
  type BeginConnectResult,
  type CompleteConnectParams,
  type CompleteConnectResult,
  type ConnectorCredential,
  type PluginActionOutcome,
  type PluginActionRequest,
  type RefreshConnectParams,
  type RefreshConnectResult,
} from "@open-neko/plugin-types";
import { GoogleClient, type GoogleClientConfig } from "./google-client.js";

export class GoogleWorkspaceError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "GoogleWorkspaceError";
  }
}

interface ResolvedClientEnv {
  clientId: string;
  clientSecret: string;
}

/** Test seam: inject a fake GoogleClient. */
export interface InvokeOptions {
  createClient?: (env: ResolvedClientEnv) => GoogleClient;
}

function resolveClientEnv(): ResolvedClientEnv {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (missing.length > 0) {
    throw new GoogleWorkspaceError(
      `${missing.join(", ")} not set. Create an OAuth client in your Google Cloud Console project, then \`openneko secrets set @open-neko/connector-google-workspace ${missing[0]} …\`.`,
    );
  }
  return { clientId: clientId!, clientSecret: clientSecret! };
}

function clientOrDefault(options: InvokeOptions): GoogleClient {
  const env = resolveClientEnv();
  const make =
    options.createClient ??
    ((e: ResolvedClientEnv) =>
      new GoogleClient({
        clientId: e.clientId,
        clientSecret: e.clientSecret,
      } satisfies GoogleClientConfig));
  return make(env);
}

function pkceChallengeS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export async function runBeginConnect(
  params: BeginConnectParams,
  options: InvokeOptions = {},
): Promise<BeginConnectResult> {
  if (!params.codeVerifier) {
    throw new GoogleWorkspaceError(
      "params.codeVerifier is required — Google connect requires PKCE",
    );
  }
  if (params.scopes.length === 0) {
    throw new GoogleWorkspaceError("params.scopes must not be empty");
  }
  const client = clientOrDefault(options);
  const authorizationUrl = client.buildAuthorizationUrl({
    redirectUri: params.redirectUri,
    state: params.state,
    scopes: params.scopes,
    codeChallenge: pkceChallengeS256(params.codeVerifier),
  });
  return { authorizationUrl };
}

export async function runCompleteConnect(
  params: CompleteConnectParams,
  options: InvokeOptions = {},
): Promise<CompleteConnectResult> {
  if (!params.codeVerifier) {
    throw new GoogleWorkspaceError(
      "params.codeVerifier is required — Google connect requires PKCE",
    );
  }
  const client = clientOrDefault(options);
  const tokens = await client.exchangeCode({
    code: params.code,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
  });
  if (!tokens.access_token) {
    throw new GoogleWorkspaceError(
      "Google's code-exchange response had no access_token",
    );
  }
  const credential: ConnectorCredential = {
    tokens: tokens as unknown as Record<string, unknown>,
    scopes: tokens.scope
      ? tokens.scope.split(/\s+/).filter(Boolean)
      : params.scopes,
    providerLabel: "Google Workspace",
    connectedAt: new Date().toISOString(),
  };
  return { credential };
}

export async function runRefreshConnect(
  params: RefreshConnectParams,
  options: InvokeOptions = {},
): Promise<RefreshConnectResult> {
  const refreshToken =
    typeof params.current.tokens.refresh_token === "string"
      ? params.current.tokens.refresh_token
      : null;
  if (!refreshToken) {
    throw new GoogleWorkspaceError(
      "Stored credential has no refresh_token — operator must reconnect to re-grant offline access",
    );
  }
  const client = clientOrDefault(options);
  const fresh = await client.refreshTokens(refreshToken);
  // Google omits refresh_token from refresh responses when keeping the
  // existing one. Carry the prior refresh_token forward if absent.
  const mergedTokens: Record<string, unknown> = {
    ...params.current.tokens,
    ...fresh,
  };
  if (!fresh.refresh_token) {
    mergedTokens.refresh_token = refreshToken;
  }
  return {
    credential: {
      tokens: mergedTokens,
      scopes:
        fresh.scope?.split(/\s+/).filter(Boolean) ??
        params.current.scopes,
      providerLabel: "Google Workspace",
      connectedAt: params.current.connectedAt,
      refreshedAt: new Date().toISOString(),
    },
  };
}

// ─── Action handlers ─────────────────────────────────────────────────

function readInjectedTokens(): { access_token: string } {
  const raw = process.env.OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS;
  if (!raw) {
    throw new GoogleWorkspaceError(
      "OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS not injected — action invoked without an operator credential. The operator must Connect via /integrations first.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new GoogleWorkspaceError(
      `OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { access_token?: unknown }).access_token !== "string"
  ) {
    throw new GoogleWorkspaceError(
      "OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS missing access_token",
    );
  }
  return { access_token: (parsed as { access_token: string }).access_token };
}

interface ActionInvokeOptions extends InvokeOptions {
  /** Test seam: override the env-injected tokens. */
  readTokens?: () => { access_token: string };
}

export async function runSendGmail(
  request: PluginActionRequest,
  options: ActionInvokeOptions = {},
): Promise<PluginActionOutcome> {
  const payload = request.payload as
    | { to?: unknown; subject?: unknown; body?: unknown; cc?: unknown }
    | null;
  const to = typeof payload?.to === "string" ? payload.to : "";
  const subject = typeof payload?.subject === "string" ? payload.subject : "";
  const body = typeof payload?.body === "string" ? payload.body : "";
  if (!to || !subject) {
    throw new GoogleWorkspaceError(
      'send_gmail payload missing "to" or "subject"',
    );
  }
  const tokens = (options.readTokens ?? readInjectedTokens)();
  const client = clientOrDefault(options);
  const sent = await client.sendGmail(tokens.access_token, {
    to,
    subject,
    body,
    cc: typeof payload?.cc === "string" ? payload.cc : undefined,
  });
  return {
    result: sent,
    externalRef: sent.id,
    commandOrOperation: `gmail.send → ${to}`,
  };
}

export async function runListCalendarEvents(
  request: PluginActionRequest,
  options: ActionInvokeOptions = {},
): Promise<PluginActionOutcome> {
  const payload = request.payload as
    | { maxResults?: unknown; timeMin?: unknown }
    | null;
  const maxResults =
    typeof payload?.maxResults === "number" ? payload.maxResults : 10;
  const timeMin = typeof payload?.timeMin === "string" ? payload.timeMin : undefined;
  const tokens = (options.readTokens ?? readInjectedTokens)();
  const client = clientOrDefault(options);
  const out = await client.listCalendarEvents(tokens.access_token, {
    maxResults,
    timeMin,
  });
  return {
    result: { events: out.items },
    externalRef: null,
    commandOrOperation: `calendar.list (${out.items.length} events)`,
  };
}

export async function runAppendSheetRow(
  request: PluginActionRequest,
  options: ActionInvokeOptions = {},
): Promise<PluginActionOutcome> {
  const payload = request.payload as
    | { spreadsheetId?: unknown; range?: unknown; values?: unknown }
    | null;
  const spreadsheetId =
    typeof payload?.spreadsheetId === "string" ? payload.spreadsheetId : "";
  const range = typeof payload?.range === "string" ? payload.range : "";
  const values = Array.isArray(payload?.values)
    ? payload.values.map((v) => String(v))
    : [];
  if (!spreadsheetId || !range || values.length === 0) {
    throw new GoogleWorkspaceError(
      'append_sheet_row payload requires "spreadsheetId", "range", and non-empty "values" array',
    );
  }
  const tokens = (options.readTokens ?? readInjectedTokens)();
  const client = clientOrDefault(options);
  const out = await client.appendSheetRow(tokens.access_token, {
    spreadsheetId,
    range,
    values,
  });
  return {
    result: out,
    externalRef: out.updates.updatedRange,
    commandOrOperation: `sheets.append → ${out.updates.updatedRange}`,
  };
}

export default definePlugin({
  name: "@open-neko/connector-google-workspace",
  version: "0.1.0",
  capabilities: {
    connect: {
      providerLabel: "Google Workspace",
      scopes: [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/documents",
      ],
      flow: "oauth2-pkce",
      begin: (params) => runBeginConnect(params),
      complete: (params) => runCompleteConnect(params),
      refresh: (params) => runRefreshConnect(params),
    },
    action: {
      kinds: [
        {
          kind: "send_gmail",
          description:
            "Send an email from the connected operator's Gmail account.",
          handler: (req) => runSendGmail(req),
        },
        {
          kind: "list_calendar_events",
          description:
            "List upcoming events on the connected operator's primary calendar.",
          handler: (req) => runListCalendarEvents(req),
        },
        {
          kind: "append_sheet_row",
          description:
            "Append a row to a Google Sheet the connected operator can edit.",
          handler: (req) => runAppendSheetRow(req),
        },
      ],
    },
  },
});

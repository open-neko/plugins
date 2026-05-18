import {
  definePlugin,
  type AuthIdentity,
  type BeginAuthParams,
  type BeginAuthResult,
  type CompleteAuthParams,
  type CompleteAuthResult,
} from "@open-neko/plugin-types";
import {
  createScalekitClient,
  type ScalekitClient,
  type ScalekitUserinfo,
} from "./scalekit-client.js";

/** Test seam: inject a fake ScalekitClient instead of constructing the real one. */
export interface InvokeOptions {
  createClient?: (env: ResolvedEnv) => ScalekitClient;
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

export default definePlugin({
  name: "@open-neko/plugin-scalekit",
  version: "0.1.0",
  auth: {
    providerLabel: "Scalekit",
    begin: (params) => runBeginAuth(params),
    complete: (params) => runCompleteAuth(params),
  },
});

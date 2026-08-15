/**
 * @open-neko/plugin-magic-link — passwordless email sign-in.
 *
 * Implements OpenNeko's auth contract with `provisioning: "manual"`:
 * the core only starts this flow for emails an admin pre-provisioned,
 * and never creates users from it. This plugin's job is narrow —
 * mint a signed token, email the link, verify the token on callback:
 *
 *   begin_auth    → HMAC-sign {email, state, expiry}, email the link
 *                   `${redirectUri}?code=<token>&state=<state>`, and
 *                   point the browser at the "check your email" notice.
 *   complete_auth → verify signature + expiry + state binding, return
 *                   the identity (groups always empty — role and
 *                   access assignment is the core's job, and nothing
 *                   self-asserted should influence it).
 *
 * Single-use and same-browser properties come from the core's
 * read-and-clear state cookie; see token.ts for the exact argument.
 */

import {
  definePlugin,
  type AuthIdentity,
  type BeginAuthParams,
  type BeginAuthResult,
  type CompleteAuthParams,
  type CompleteAuthResult,
} from "@open-neko/plugin-types";
import { buildSignInEmail, resolveProvider, type EmailSender } from "./email.js";
import {
  clampTtl,
  mintToken,
  MIN_SECRET_LENGTH,
  verifyToken,
} from "./token.js";

export class MagicLinkPluginError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "MagicLinkPluginError";
  }
}

/** Test seam: inject a fake sender / clock instead of the real ones. */
export interface InvokeOptions {
  send?: EmailSender;
  nowMs?: number;
}

interface ResolvedEnv {
  secret: string;
  from: string;
  ttlSeconds: number;
}

function resolveEnv(): ResolvedEnv {
  const secret = process.env.MAGIC_LINK_SIGNING_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new MagicLinkPluginError(
      `MAGIC_LINK_SIGNING_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  const from = process.env.MAGIC_LINK_FROM?.trim() ?? "";
  if (!from) {
    throw new MagicLinkPluginError("MAGIC_LINK_FROM must be set");
  }
  const rawTtl = process.env.MAGIC_LINK_TTL_SECONDS;
  const ttlSeconds = clampTtl(rawTtl ? Number(rawTtl) : undefined);
  return { secret, from, ttlSeconds };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function runBeginAuth(
  params: BeginAuthParams,
  options: InvokeOptions = {},
): Promise<BeginAuthResult> {
  if (!params.redirectUri) {
    throw new MagicLinkPluginError("params.redirectUri is required");
  }
  if (!params.state) {
    throw new MagicLinkPluginError("params.state is required");
  }
  const email = params.loginHint?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) {
    // The core's sign-in page requires the email field
    // (loginHintRequired), so reaching here means a hand-built request.
    throw new MagicLinkPluginError(
      "magic link sign-in requires the email address as loginHint",
    );
  }

  let callback: URL;
  try {
    callback = new URL(params.redirectUri);
  } catch {
    throw new MagicLinkPluginError("params.redirectUri must be an absolute URL");
  }

  const env = resolveEnv();
  const token = mintToken({
    email,
    state: params.state,
    secret: env.secret,
    ttlSeconds: env.ttlSeconds,
    nowMs: options.nowMs,
  });

  const link = new URL(callback.toString());
  link.searchParams.set("code", token);
  link.searchParams.set("state", params.state);

  const send = options.send ?? resolveProvider({
    resendApiKey: process.env.RESEND_API_KEY,
    postmarkServerToken: process.env.POSTMARK_SERVER_TOKEN,
    sendgridApiKey: process.env.SENDGRID_API_KEY,
  }).send;
  await send(
    buildSignInEmail({
      from: env.from,
      to: email,
      link: link.toString(),
      ttlMinutes: Math.max(1, Math.round(env.ttlSeconds / 60)),
    }),
  );

  // No IdP to redirect to — bounce the browser to the sign-in page's
  // "check your email" notice. The core shows the identical notice when
  // it drops an unprovisioned email before ever calling us.
  return {
    authorizationUrl: `${callback.origin}/signin?notice=link-sent`,
  };
}

export async function runCompleteAuth(
  params: CompleteAuthParams,
  options: InvokeOptions = {},
): Promise<CompleteAuthResult> {
  if (!params.code) {
    throw new MagicLinkPluginError("params.code is required");
  }
  if (!params.state) {
    throw new MagicLinkPluginError("params.state is required");
  }
  const env = resolveEnv();
  const claims = verifyToken({
    token: params.code,
    state: params.state,
    secret: env.secret,
    nowMs: options.nowMs,
  });
  const identity: AuthIdentity = {
    // Deterministic per mailbox so repeat sign-ins hit the same
    // app_user row via the sub lookup.
    sub: `magic-link:${claims.email}`,
    email: claims.email,
    name: null,
    orgId: null,
    // Self-asserted flows must never influence role mapping.
    groups: [],
  };
  return { identity };
}

export default definePlugin({
  name: "@open-neko/plugin-magic-link",
  version: "0.1.0", // x-release-please-version
  capabilities: {
    auth: {
      providerLabel: "Email link",
      begin: (params) => runBeginAuth(params),
      complete: (params) => runCompleteAuth(params),
    },
  },
});

/**
 * Thin HTTP client for Google's OAuth + Workspace APIs. All network
 * calls go through `fetchImpl` so tests can inject a fake without
 * touching real Google endpoints.
 */

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export interface GoogleTokens {
  /** Bearer token for API calls. */
  access_token: string;
  /** Long-lived rotation token. Absent when Google didn't return one
   *  (e.g. follow-up consent without offline access). Treat as optional
   *  in callers; the absence of a refresh token means the credential
   *  will eventually expire and the operator has to reconnect. */
  refresh_token?: string;
  /** Seconds until access_token expires. */
  expires_in?: number;
  /** OAuth scopes ultimately granted (may be narrower than requested). */
  scope?: string;
  /** Always "Bearer" for Google. */
  token_type?: string;
  /** OIDC ID token when scope includes openid. */
  id_token?: string;
}

const ACCOUNTS_ORIGIN = "https://accounts.google.com";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const CALENDAR_LIST_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const SHEETS_APPEND_URL = (sheetId: string, range: string) =>
  `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

export class GoogleClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: GoogleClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Build the full authorization URL the operator's browser should
   * follow. The plugin returns this string from runBeginConnect; the
   * web app redirects the operator to it.
   *
   * PKCE: the worker mints the code_verifier and passes it through.
   * The plugin computes the S256 challenge and includes it on the URL.
   * The matching code_verifier comes back through runCompleteConnect
   * for the token exchange.
   */
  buildAuthorizationUrl(params: {
    redirectUri: string;
    state: string;
    scopes: string[];
    codeChallenge: string;
    /** Email hint to pre-select an account. */
    loginHint?: string | null;
  }): string {
    const url = new URL(`${ACCOUNTS_ORIGIN}/o/oauth2/v2/auth`);
    url.searchParams.set("client_id", this.cfg.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", params.scopes.join(" "));
    url.searchParams.set("state", params.state);
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    // access_type=offline + prompt=consent are the two parameters that
    // make Google return a refresh_token. Without both, subsequent
    // re-authorizations sometimes silently omit the refresh_token and
    // the connector stops working after the first hour.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
    return url.toString();
  }

  /** Exchange an authorization code for a token set. */
  async exchangeCode(params: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleTokens> {
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: params.redirectUri,
    });
    const res = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(
        `google oauth code exchange failed (HTTP ${res.status}): ${text}`,
      );
    }
    return (await res.json()) as GoogleTokens;
  }

  /** Rotate the access token using a stored refresh token. */
  async refreshTokens(refreshToken: string): Promise<GoogleTokens> {
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(
        `google oauth refresh failed (HTTP ${res.status}): ${text}`,
      );
    }
    // Google omits refresh_token from the response when rotating a
    // long-lived one — the operator's existing refresh_token is still
    // valid. Callers must merge: keep the old refresh_token if the new
    // payload omits it.
    return (await res.json()) as GoogleTokens;
  }

  // ─── Action APIs ───────────────────────────────────────────────────

  async sendGmail(
    accessToken: string,
    message: { to: string; subject: string; body: string; cc?: string },
  ): Promise<{ id: string; threadId: string }> {
    const headers: string[] = [`To: ${message.to}`, `Subject: ${message.subject}`];
    if (message.cc) headers.push(`Cc: ${message.cc}`);
    headers.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "");
    const raw = Buffer.from([...headers, message.body].join("\r\n"), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const res = await this.fetchImpl(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`gmail send failed (HTTP ${res.status}): ${text}`);
    }
    return (await res.json()) as { id: string; threadId: string };
  }

  async listCalendarEvents(
    accessToken: string,
    params: { maxResults?: number; timeMin?: string } = {},
  ): Promise<{
    items: Array<{
      id: string;
      summary?: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      htmlLink?: string;
    }>;
  }> {
    const url = new URL(CALENDAR_LIST_EVENTS_URL);
    url.searchParams.set("maxResults", String(params.maxResults ?? 10));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", params.timeMin ?? new Date().toISOString());
    const res = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`calendar list failed (HTTP ${res.status}): ${text}`);
    }
    return (await res.json()) as Awaited<ReturnType<GoogleClient["listCalendarEvents"]>>;
  }

  async appendSheetRow(
    accessToken: string,
    params: { spreadsheetId: string; range: string; values: string[] },
  ): Promise<{ updates: { updatedRange: string; updatedRows: number } }> {
    const res = await this.fetchImpl(
      SHEETS_APPEND_URL(params.spreadsheetId, params.range),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [params.values] }),
      },
    );
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`sheets append failed (HTTP ${res.status}): ${text}`);
    }
    return (await res.json()) as Awaited<ReturnType<GoogleClient["appendSheetRow"]>>;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable>";
  }
}

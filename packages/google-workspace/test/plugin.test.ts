import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleWorkspaceError,
  runAppendSheetRow,
  runBeginConnect,
  runCompleteConnect,
  runListCalendarEvents,
  runRefreshConnect,
  runSendGmail,
} from "../src/plugin";
import { GoogleClient } from "../src/google-client";

function withClientEnv(): void {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
}

beforeEach(() => {
  withClientEnv();
  delete process.env.OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeFetch(
  fn: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(fn(url, init));
  }) as typeof fetch;
}

function makeClient(fn: Parameters<typeof fakeFetch>[0]): GoogleClient {
  return new GoogleClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    fetchImpl: fakeFetch(fn),
  });
}

describe("runBeginConnect", () => {
  it("builds an OAuth URL with PKCE challenge, offline access, and prompt=consent", async () => {
    const result = await runBeginConnect(
      {
        operatorId: "op-1",
        redirectUri: "https://app.example.com/api/integrations/connect/x/callback",
        state: "csrf-token",
        scopes: ["openid", "https://www.googleapis.com/auth/gmail.send"],
        codeVerifier: "verifier-xyz",
      },
      { createClient: () => makeClient(() => new Response()) },
    );
    const url = new URL(result.authorizationUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/integrations/connect/x/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("csrf-token");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe(
      "openid https://www.googleapis.com/auth/gmail.send",
    );
    // PKCE challenge is sha256(verifier) base64url'd; can't predict the
    // exact value without recomputing, but it must be present.
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("throws clearly when codeVerifier is absent (PKCE is mandatory)", async () => {
    await expect(
      runBeginConnect({
        operatorId: "op-1",
        redirectUri: "https://x",
        state: "csrf",
        scopes: ["openid"],
      }),
    ).rejects.toThrow(/PKCE/);
  });

  it("throws when scopes is empty", async () => {
    await expect(
      runBeginConnect({
        operatorId: "op-1",
        redirectUri: "https://x",
        state: "csrf",
        scopes: [],
        codeVerifier: "v",
      }),
    ).rejects.toThrow(/scopes/);
  });

  it("throws GoogleWorkspaceError when GOOGLE_CLIENT_ID is missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(
      runBeginConnect({
        operatorId: "op-1",
        redirectUri: "https://x",
        state: "csrf",
        scopes: ["openid"],
        codeVerifier: "v",
      }),
    ).rejects.toThrow(/GOOGLE_CLIENT_ID/);
  });
});

describe("runCompleteConnect", () => {
  it("exchanges the code and returns a credential with scopes derived from response", async () => {
    const result = await runCompleteConnect(
      {
        operatorId: "op-1",
        code: "auth-code-1",
        redirectUri: "https://app/cb",
        state: "csrf",
        scopes: ["openid"],
        codeVerifier: "verifier-xyz",
      },
      {
        createClient: () =>
          makeClient((url, init) => {
            expect(url).toBe("https://oauth2.googleapis.com/token");
            expect(init?.method).toBe("POST");
            const body = new URLSearchParams(init!.body as string);
            expect(body.get("code")).toBe("auth-code-1");
            expect(body.get("code_verifier")).toBe("verifier-xyz");
            expect(body.get("grant_type")).toBe("authorization_code");
            return new Response(
              JSON.stringify({
                access_token: "at-1",
                refresh_token: "rt-1",
                expires_in: 3599,
                scope:
                  "openid https://www.googleapis.com/auth/gmail.send",
                token_type: "Bearer",
              }),
              { status: 200 },
            );
          }),
      },
    );
    expect(result.credential.tokens.access_token).toBe("at-1");
    expect(result.credential.tokens.refresh_token).toBe("rt-1");
    expect(result.credential.providerLabel).toBe("Google Workspace");
    expect(result.credential.scopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    expect(result.credential.connectedAt).toBeTruthy();
  });

  it("rejects when Google returns no access_token", async () => {
    await expect(
      runCompleteConnect(
        {
          operatorId: "op-1",
          code: "auth-code-1",
          redirectUri: "https://app/cb",
          state: "csrf",
          scopes: ["openid"],
          codeVerifier: "v",
        },
        {
          createClient: () =>
            makeClient(() => new Response(JSON.stringify({}), { status: 200 })),
        },
      ),
    ).rejects.toThrow(/no access_token/);
  });

  it("surfaces Google's error body when token exchange fails", async () => {
    await expect(
      runCompleteConnect(
        {
          operatorId: "op-1",
          code: "bad-code",
          redirectUri: "https://app/cb",
          state: "csrf",
          scopes: ["openid"],
          codeVerifier: "v",
        },
        {
          createClient: () =>
            makeClient(
              () =>
                new Response(
                  JSON.stringify({
                    error: "invalid_grant",
                    error_description: "Bad code",
                  }),
                  { status: 400 },
                ),
            ),
        },
      ),
    ).rejects.toThrow(/code exchange failed.*HTTP 400/s);
  });
});

describe("runRefreshConnect", () => {
  it("rotates tokens and preserves the refresh_token when Google omits it", async () => {
    const result = await runRefreshConnect(
      {
        operatorId: "op-1",
        current: {
          tokens: {
            access_token: "at-old",
            refresh_token: "rt-stable",
          },
          providerLabel: "Google Workspace",
          connectedAt: "2026-05-21T10:00:00Z",
        },
      },
      {
        createClient: () =>
          makeClient((url, init) => {
            const body = new URLSearchParams(init!.body as string);
            expect(body.get("grant_type")).toBe("refresh_token");
            expect(body.get("refresh_token")).toBe("rt-stable");
            return new Response(
              JSON.stringify({
                access_token: "at-rotated",
                expires_in: 3599,
                token_type: "Bearer",
                // No refresh_token — Google often omits when keeping
                // the existing one. The plugin must preserve it.
              }),
              { status: 200 },
            );
          }),
      },
    );
    expect(result.credential.tokens.access_token).toBe("at-rotated");
    expect(result.credential.tokens.refresh_token).toBe("rt-stable");
    expect(result.credential.refreshedAt).toBeTruthy();
    expect(result.credential.connectedAt).toBe("2026-05-21T10:00:00Z");
  });

  it("uses a new refresh_token when Google rotates it", async () => {
    const result = await runRefreshConnect(
      {
        operatorId: "op-1",
        current: {
          tokens: { access_token: "at-old", refresh_token: "rt-old" },
          connectedAt: "2026-05-21T10:00:00Z",
        },
      },
      {
        createClient: () =>
          makeClient(
            () =>
              new Response(
                JSON.stringify({
                  access_token: "at-rotated",
                  refresh_token: "rt-new",
                  expires_in: 3599,
                }),
                { status: 200 },
              ),
          ),
      },
    );
    expect(result.credential.tokens.refresh_token).toBe("rt-new");
  });

  it("errors clearly when the stored credential has no refresh_token", async () => {
    await expect(
      runRefreshConnect({
        operatorId: "op-1",
        current: {
          tokens: { access_token: "at-only" }, // no refresh_token
          connectedAt: "2026-05-21T10:00:00Z",
        },
      }),
    ).rejects.toThrow(/no refresh_token/);
  });
});

describe("Action handlers", () => {
  describe("runSendGmail", () => {
    function req(payload: Record<string, unknown>) {
      return {
        id: "req-1",
        orgId: "org-1",
        scope: "external" as const,
        kind: "send_gmail",
        target: null,
        summary: "send gmail",
        payload,
        riskLevel: "low" as const,
      };
    }

    it("base64url-encodes the message and POSTs it to gmail.send", async () => {
      const outcome = await runSendGmail(
        req({ to: "ceo@example.com", subject: "Q3 update", body: "All green." }),
        {
          readTokens: () => ({ access_token: "at-1" }),
          createClient: () =>
            makeClient((url, init) => {
              expect(url).toBe(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
              );
              expect(
                (init!.headers as Record<string, string>).Authorization,
              ).toBe("Bearer at-1");
              const body = JSON.parse(init!.body as string) as { raw: string };
              const decoded = Buffer.from(
                body.raw.replace(/-/g, "+").replace(/_/g, "/"),
                "base64",
              ).toString("utf8");
              expect(decoded).toContain("To: ceo@example.com");
              expect(decoded).toContain("Subject: Q3 update");
              expect(decoded).toContain("All green.");
              return new Response(
                JSON.stringify({ id: "msg-1", threadId: "thr-1" }),
                { status: 200 },
              );
            }),
        },
      );
      expect(outcome.externalRef).toBe("msg-1");
      expect(outcome.commandOrOperation).toContain("gmail.send");
    });

    it("rejects when 'to' or 'subject' is missing", async () => {
      await expect(
        runSendGmail(req({ body: "no recipient" }), {
          readTokens: () => ({ access_token: "at-1" }),
          createClient: () => makeClient(() => new Response()),
        }),
      ).rejects.toThrow(/to.*subject/);
    });

    it("errors clearly when no credential is injected", async () => {
      await expect(
        runSendGmail(req({ to: "x@y.com", subject: "s", body: "b" })),
      ).rejects.toThrow(/CREDENTIAL_TOKENS/);
    });

    it("reads tokens from OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS env var", async () => {
      process.env.OPENNEKO_CONNECTOR_CREDENTIAL_TOKENS = JSON.stringify({
        access_token: "at-from-env",
        refresh_token: "rt-env",
      });
      let observedAuth = "";
      await runSendGmail(
        req({ to: "x@y.com", subject: "s", body: "b" }),
        {
          createClient: () =>
            makeClient((_url, init) => {
              observedAuth =
                (init!.headers as Record<string, string>).Authorization ?? "";
              return new Response(
                JSON.stringify({ id: "x", threadId: "t" }),
                { status: 200 },
              );
            }),
        },
      );
      expect(observedAuth).toBe("Bearer at-from-env");
    });
  });

  describe("runListCalendarEvents", () => {
    it("fetches and returns the items", async () => {
      const outcome = await runListCalendarEvents(
        {
          id: "req-2",
          orgId: "org-1",
          scope: "external",
          kind: "list_calendar_events",
          target: null,
          summary: "list",
          payload: { maxResults: 5 },
          riskLevel: "low",
        },
        {
          readTokens: () => ({ access_token: "at-1" }),
          createClient: () =>
            makeClient((url) => {
              const u = new URL(url);
              expect(u.searchParams.get("maxResults")).toBe("5");
              expect(u.searchParams.get("singleEvents")).toBe("true");
              return new Response(
                JSON.stringify({
                  items: [
                    {
                      id: "ev-1",
                      summary: "Stand-up",
                      start: { dateTime: "2026-05-22T10:00:00Z" },
                      end: { dateTime: "2026-05-22T10:30:00Z" },
                    },
                  ],
                }),
                { status: 200 },
              );
            }),
        },
      );
      const result = outcome.result as { events: Array<{ id: string }> };
      expect(result.events[0]?.id).toBe("ev-1");
    });
  });

  describe("runAppendSheetRow", () => {
    it("posts the row to the sheets append endpoint", async () => {
      const outcome = await runAppendSheetRow(
        {
          id: "req-3",
          orgId: "org-1",
          scope: "external",
          kind: "append_sheet_row",
          target: null,
          summary: "append",
          payload: {
            spreadsheetId: "1abc",
            range: "Sheet1!A:C",
            values: ["2026-05-21", "Germany revenue drop", "62%"],
          },
          riskLevel: "low",
        },
        {
          readTokens: () => ({ access_token: "at-1" }),
          createClient: () =>
            makeClient((url, init) => {
              expect(url).toContain(
                "https://sheets.googleapis.com/v4/spreadsheets/1abc/values/Sheet1!A%3AC:append",
              );
              const body = JSON.parse(init!.body as string) as {
                values: string[][];
              };
              expect(body.values[0]).toEqual([
                "2026-05-21",
                "Germany revenue drop",
                "62%",
              ]);
              return new Response(
                JSON.stringify({
                  updates: { updatedRange: "Sheet1!A2:C2", updatedRows: 1 },
                }),
                { status: 200 },
              );
            }),
        },
      );
      expect(outcome.externalRef).toBe("Sheet1!A2:C2");
    });

    it("rejects on missing required fields", async () => {
      await expect(
        runAppendSheetRow(
          {
            id: "req-3",
            orgId: "org-1",
            scope: "external",
            kind: "append_sheet_row",
            target: null,
            summary: "append",
            payload: { spreadsheetId: "1abc" /* no range or values */ },
            riskLevel: "low",
          },
          {
            readTokens: () => ({ access_token: "at-1" }),
            createClient: () => makeClient(() => new Response()),
          },
        ),
      ).rejects.toThrow(/range.*values/);
    });
  });
});

describe("GoogleWorkspaceError", () => {
  it("is exported and identifiable by name", () => {
    const err = new GoogleWorkspaceError("test");
    expect(err.name).toBe("GoogleWorkspaceError");
    expect(err.message).toBe("test");
  });
});

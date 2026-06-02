import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin, {
  runBeginAuth,
  runCompleteAuth,
  ScalekitPluginError,
} from "../src/plugin";
import type {
  ScalekitClient,
  ScalekitTokenResponse,
  ScalekitUserinfo,
} from "../src/scalekit-client";
import {
  dispatchPluginRpc,
  RPC_PROTOCOL_VERSION,
} from "@open-neko/plugin-types";

function fakeClient(opts: {
  authorizationUrl?: string;
  tokens?: ScalekitTokenResponse;
  userinfo?: ScalekitUserinfo;
  recorder?: {
    authCalls: Array<{ redirectUri: string; state: string; loginHint?: string | null }>;
    exchangeCalls: Array<{ code: string; redirectUri: string }>;
    userinfoCalls: string[];
  };
}): ScalekitClient {
  return {
    buildAuthorizationUrl({ redirectUri, state, loginHint }) {
      opts.recorder?.authCalls.push({ redirectUri, state, loginHint });
      return (
        opts.authorizationUrl ?? `https://foo.scalekit.com/oauth/authorize?state=${state}`
      );
    },
    async exchangeCode({ code, redirectUri }) {
      opts.recorder?.exchangeCalls.push({ code, redirectUri });
      return (
        opts.tokens ?? {
          access_token: "at-1",
          token_type: "Bearer",
          expires_in: 3600,
        }
      );
    },
    async fetchUserinfo(token: string) {
      opts.recorder?.userinfoCalls.push(token);
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

describe("plugin shape", () => {
  it("declares scalekit as an auth provider only (no actions)", () => {
    expect(plugin.name).toBe("@open-neko/plugin-scalekit");
    expect(plugin.capabilities.action).toBeUndefined();
    expect(plugin.capabilities.auth?.providerLabel).toBe("Scalekit");
    expect(typeof plugin.capabilities.auth?.begin).toBe("function");
    expect(typeof plugin.capabilities.auth?.complete).toBe("function");
  });

  it("register() via dispatcher carries the provider label", async () => {
    const r = await dispatchPluginRpc(plugin, {
      method: "register",
      paramsJson: "{}",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = r.result as {
      protocol: number;
      capabilities: {
        action?: { kinds: unknown[] };
        auth?: { providerLabel?: string };
      };
    };
    expect(out.protocol).toBe(RPC_PROTOCOL_VERSION);
    expect(out.capabilities.action).toBeUndefined();
    expect(out.capabilities.auth?.providerLabel).toBe("Scalekit");
  });
});

describe("env resolution", () => {
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
          {
            redirectUri: "https://app.example.com/cb",
            state: "x",
          },
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

describe("runBeginAuth", () => {
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

  it("returns the authorization URL the client constructs", async () => {
    const recorder = {
      authCalls: [] as Array<{ redirectUri: string; state: string; loginHint?: string | null }>,
      exchangeCalls: [] as Array<{ code: string; redirectUri: string }>,
      userinfoCalls: [] as string[],
    };
    const result = await runBeginAuth(
      {
        redirectUri: "https://app.example.com/cb",
        state: "csrf-token",
        loginHint: "amit@example.com",
      },
      {
        createClient: () =>
          fakeClient({
            authorizationUrl:
              "https://foo.scalekit.com/oauth/authorize?stub=1",
            recorder,
          }),
      },
    );
    expect(result.authorizationUrl).toBe(
      "https://foo.scalekit.com/oauth/authorize?stub=1",
    );
    expect(recorder.authCalls).toEqual([
      {
        redirectUri: "https://app.example.com/cb",
        state: "csrf-token",
        loginHint: "amit@example.com",
      },
    ]);
  });

  it("rejects empty state", async () => {
    await expect(
      runBeginAuth(
        {
          redirectUri: "https://app.example.com/cb",
          state: "",
        },
        { createClient: () => fakeClient({}) },
      ),
    ).rejects.toBeInstanceOf(ScalekitPluginError);
  });
});

describe("runCompleteAuth", () => {
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

  it("exchanges the code, fetches userinfo, maps groups + roles", async () => {
    const recorder = {
      authCalls: [],
      exchangeCalls: [] as Array<{ code: string; redirectUri: string }>,
      userinfoCalls: [] as string[],
    };
    const result = await runCompleteAuth(
      {
        code: "auth-code",
        redirectUri: "https://app.example.com/cb",
        state: "csrf-token",
      },
      {
        createClient: () =>
          fakeClient({
            tokens: {
              access_token: "at-42",
              token_type: "Bearer",
            },
            userinfo: {
              sub: "user-42",
              email: "amit@example.com",
              given_name: "Amit",
              family_name: "Patel",
              organization_id: "org-abc",
              groups: ["everyone", "engineering"],
              roles: ["admin", "engineering"],
            },
            recorder,
          }),
      },
    );
    expect(recorder.exchangeCalls).toEqual([
      { code: "auth-code", redirectUri: "https://app.example.com/cb" },
    ]);
    expect(recorder.userinfoCalls).toEqual(["at-42"]);
    expect(result.identity).toEqual({
      sub: "user-42",
      email: "amit@example.com",
      name: "Amit Patel",
      orgId: "org-abc",
      groups: ["everyone", "engineering", "admin"],
    });
  });

  it("uses name claim verbatim when present", async () => {
    const out = await runCompleteAuth(
      {
        code: "c",
        redirectUri: "https://app.example.com/cb",
        state: "csrf",
      },
      {
        createClient: () =>
          fakeClient({
            userinfo: {
              sub: "u-1",
              email: "x@y.com",
              name: "Display Name",
            },
          }),
      },
    );
    expect(out.identity.name).toBe("Display Name");
  });

  it("throws when userinfo has no email", async () => {
    await expect(
      runCompleteAuth(
        { code: "c", redirectUri: "https://app.example.com/cb", state: "s" },
        {
          createClient: () =>
            fakeClient({
              userinfo: { sub: "u-1" },
            }),
        },
      ),
    ).rejects.toThrow(/no email/);
  });

  it("rejects empty code", async () => {
    await expect(
      runCompleteAuth(
        { code: "", redirectUri: "https://app.example.com/cb", state: "s" },
        { createClient: () => fakeClient({}) },
      ),
    ).rejects.toBeInstanceOf(ScalekitPluginError);
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

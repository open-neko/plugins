import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "../src/email.js";
import { runBeginAuth, runCompleteAuth } from "../src/plugin.js";

const SECRET = "s".repeat(32);
const NOW = 1_755_000_000_000;
const CALLBACK = "https://neko.example/api/auth/callback";

describe("magic-link auth flow", () => {
  let sent: EmailMessage[];
  const send = vi.fn(async (message: EmailMessage) => {
    sent.push(message);
  });

  beforeEach(() => {
    sent = [];
    send.mockClear();
    process.env.MAGIC_LINK_SIGNING_SECRET = SECRET;
    process.env.MAGIC_LINK_FROM = "OpenNeko <signin@company.com>";
    delete process.env.MAGIC_LINK_TTL_SECONDS;
  });
  afterEach(() => {
    delete process.env.MAGIC_LINK_SIGNING_SECRET;
    delete process.env.MAGIC_LINK_FROM;
  });

  it("emails a link that completes into the same identity", async () => {
    const begin = await runBeginAuth(
      {
        redirectUri: CALLBACK,
        state: "state-1",
        loginHint: "Person@Company.com",
      },
      { send, nowMs: NOW },
    );
    expect(begin.authorizationUrl).toBe(
      "https://neko.example/signin?notice=link-sent",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("person@company.com");

    const linkMatch = /https:\/\/\S+/.exec(sent[0].text);
    expect(linkMatch).not.toBeNull();
    const link = new URL(linkMatch![0]);
    expect(`${link.origin}${link.pathname}`).toBe(CALLBACK);
    expect(link.searchParams.get("state")).toBe("state-1");

    const complete = await runCompleteAuth(
      {
        code: link.searchParams.get("code")!,
        redirectUri: CALLBACK,
        state: "state-1",
      },
      { nowMs: NOW + 60_000 },
    );
    expect(complete.identity).toEqual({
      sub: "magic-link:person@company.com",
      email: "person@company.com",
      name: null,
      orgId: null,
      groups: [],
    });
  });

  it("refuses to begin without a usable email hint", async () => {
    for (const loginHint of [null, "", "not-an-email"]) {
      await expect(
        runBeginAuth(
          { redirectUri: CALLBACK, state: "s", loginHint },
          { send, nowMs: NOW },
        ),
      ).rejects.toThrow(/email address as loginHint/);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects completion with a mismatched state", async () => {
    await runBeginAuth(
      { redirectUri: CALLBACK, state: "state-1", loginHint: "a@b.co" },
      { send, nowMs: NOW },
    );
    const link = new URL(/https:\/\/\S+/.exec(sent[0].text)![0]);
    await expect(
      runCompleteAuth(
        {
          code: link.searchParams.get("code")!,
          redirectUri: CALLBACK,
          state: "different-state",
        },
        { nowMs: NOW },
      ),
    ).rejects.toThrow(/browser that requested it/);
  });

  it("rejects completion after expiry", async () => {
    process.env.MAGIC_LINK_TTL_SECONDS = "60";
    await runBeginAuth(
      { redirectUri: CALLBACK, state: "state-1", loginHint: "a@b.co" },
      { send, nowMs: NOW },
    );
    const link = new URL(/https:\/\/\S+/.exec(sent[0].text)![0]);
    await expect(
      runCompleteAuth(
        {
          code: link.searchParams.get("code")!,
          redirectUri: CALLBACK,
          state: "state-1",
        },
        { nowMs: NOW + 61_000 },
      ),
    ).rejects.toThrow(/expired/);
  });

  it("never returns groups — role assignment stays with the core", async () => {
    await runBeginAuth(
      { redirectUri: CALLBACK, state: "state-1", loginHint: "a@b.co" },
      { send, nowMs: NOW },
    );
    const link = new URL(/https:\/\/\S+/.exec(sent[0].text)![0]);
    const complete = await runCompleteAuth(
      {
        code: link.searchParams.get("code")!,
        redirectUri: CALLBACK,
        state: "state-1",
      },
      { nowMs: NOW },
    );
    expect(complete.identity.groups).toEqual([]);
  });

  it("fails begin when the signing secret is missing or short", async () => {
    process.env.MAGIC_LINK_SIGNING_SECRET = "short";
    await expect(
      runBeginAuth(
        { redirectUri: CALLBACK, state: "s", loginHint: "a@b.co" },
        { send, nowMs: NOW },
      ),
    ).rejects.toThrow(/MAGIC_LINK_SIGNING_SECRET/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSignInEmail, parseFrom, resolveProvider } from "../src/email.js";

describe("resolveProvider", () => {
  it("requires exactly one configured provider", () => {
    expect(() => resolveProvider({})).toThrow(/no email provider/);
    expect(() =>
      resolveProvider({ resendApiKey: "a", sendgridApiKey: "b" }),
    ).toThrow(/multiple email providers/);
    expect(resolveProvider({ resendApiKey: "a" }).name).toBe("resend");
    expect(resolveProvider({ postmarkServerToken: "a" }).name).toBe("postmark");
    expect(resolveProvider({ sendgridApiKey: "a" }).name).toBe("sendgrid");
  });
});

describe("provider senders", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const message = buildSignInEmail({
    from: "OpenNeko <signin@company.com>",
    to: "person@company.com",
    link: "https://neko.example/api/auth/callback?code=t&state=s",
    ttlMinutes: 10,
  });

  it("posts to the provider API and passes on success", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await resolveProvider({ resendApiKey: "key" }).send(message);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces provider rejections with status and truncated body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("sender not verified", { status: 422 })),
    );
    await expect(
      resolveProvider({ postmarkServerToken: "key" }).send(message),
    ).rejects.toThrow(/Postmark rejected the sign-in email \(422\)/);
  });
});

describe("parseFrom", () => {
  it("splits display-name form and passes bare addresses through", () => {
    expect(parseFrom("OpenNeko <signin@company.com>")).toEqual({
      email: "signin@company.com",
      name: "OpenNeko",
    });
    expect(parseFrom("signin@company.com")).toEqual({
      email: "signin@company.com",
    });
  });
});

describe("buildSignInEmail", () => {
  it("includes the link in text and HTML-escaped form", () => {
    const message = buildSignInEmail({
      from: "a@b.co",
      to: "person@company.com",
      link: "https://neko.example/cb?code=a&state=b",
      ttlMinutes: 10,
    });
    expect(message.text).toContain("https://neko.example/cb?code=a&state=b");
    expect(message.html).toContain("https://neko.example/cb?code=a&amp;state=b");
    expect(message.text).toContain("works once");
    expect(message.text).toContain("same browser");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginActionRequest } from "@open-neko/plugin-types";
import { runGetEmailStatus, runGetTemplate, runSendEmail } from "../src/plugin";
import { ResendClient } from "../src/resend-client";

function request(payload: Record<string, unknown>): PluginActionRequest {
  return { id: "req-1", orgId: "org", scope: "external", kind: "send_email", target: null, summary: null, payload, riskLevel: null };
}

function fakeFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function withFetch(fetchImpl: ReturnType<typeof fakeFetch>) {
  return { createClient: (apiKey: string) => new ResendClient({ apiKey, fetch: fetchImpl as unknown as typeof fetch }) };
}

function sentBody(fetchImpl: ReturnType<typeof fakeFetch>) {
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : null };
}

const ENV = { RESEND_API_KEY: "re_test", RESEND_FROM: "Acme Ops <ops@mail.acme.com>" };

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
});
afterEach(() => {
  for (const k of ["RESEND_API_KEY", "RESEND_FROM", "RESEND_ALLOWED_RECIPIENTS", "RESEND_REPLY_TO", "RESEND_FOOTER_TEXT"]) delete process.env[k];
});

describe("send_email", () => {
  it("sends Markdown in the house layout with an idempotency key", async () => {
    process.env.RESEND_FOOTER_TEXT = "Sent by OpenNeko";
    const f = fakeFetch({ id: "em_1" });
    const out = await runSendEmail(
      request({ to: "a@acme.com, Bob <b@acme.com>", cc: ["c@partner.com"], subject: "Low stock", markdown: "## 3 SKUs" }),
      withFetch(f),
    );
    const { url, headers, body } = sentBody(f);
    expect(url).toBe("https://api.resend.com/emails");
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toBe("openneko-action-req-1");
    expect(body).toMatchObject({
      from: "Acme Ops <ops@mail.acme.com>",
      to: ["a@acme.com", "Bob <b@acme.com>"],
      cc: ["c@partner.com"],
      subject: "Low stock",
      text: "## 3 SKUs\n\n--\nSent by OpenNeko\n",
    });
    expect(body.html).toContain("<h2 style=");
    expect(out.externalRef).toBe("em_1");
    expect(out.commandOrOperation).toBe("resend.send_email to 3 recipients");
  });

  it("sends a template with variables and no html", async () => {
    const f = fakeFetch({ id: "em_2" });
    await runSendEmail(request({ to: ["a@acme.com"], template: "daily-ops", variables: { count: 3, region: "EU" } }), withFetch(f));
    const { body } = sentBody(f);
    expect(body.template).toEqual({ id: "daily-ops", variables: { count: 3, region: "EU" } });
    expect(body).not.toHaveProperty("html");
    expect(body).not.toHaveProperty("subject");
  });

  it("ignores a from address in the payload", async () => {
    const f = fakeFetch({ id: "em_3" });
    await runSendEmail(request({ to: "a@acme.com", from: "ceo@acme.com", subject: "x", markdown: "y" }), withFetch(f));
    expect(sentBody(f).body.from).toBe("Acme Ops <ops@mail.acme.com>");
  });

  it("needs exactly one body", async () => {
    const f = fakeFetch({ id: "x" });
    await expect(runSendEmail(request({ to: "a@acme.com", subject: "x" }), withFetch(f))).rejects.toThrow(/exactly one body/);
    await expect(
      runSendEmail(request({ to: "a@acme.com", subject: "x", markdown: "a", html: "<p>b</p>" }), withFetch(f)),
    ).rejects.toThrow(/got markdown, html/);
    expect(f).not.toHaveBeenCalled();
  });

  it("needs a subject unless it sends a template", async () => {
    await expect(runSendEmail(request({ to: "a@acme.com", markdown: "a" }), withFetch(fakeFetch({})))).rejects.toThrow(/subject is required/);
  });

  it("refuses recipients outside RESEND_ALLOWED_RECIPIENTS before calling Resend", async () => {
    process.env.RESEND_ALLOWED_RECIPIENTS = "acme.com, *.acme.com";
    const f = fakeFetch({ id: "x" });
    await expect(
      runSendEmail(request({ to: ["a@eu.acme.com"], bcc: "x@gmail.com", subject: "x", markdown: "y" }), withFetch(f)),
    ).rejects.toThrow(/does not include: x@gmail.com/);
    expect(f).not.toHaveBeenCalled();
    await runSendEmail(request({ to: ["a@eu.acme.com", "b@ACME.com"], subject: "x", markdown: "y" }), withFetch(f));
    expect(f).toHaveBeenCalledOnce();
  });

  it("rejects an address that is not valid", async () => {
    await expect(runSendEmail(request({ to: "acme.com", subject: "x", markdown: "y" }), withFetch(fakeFetch({})))).rejects.toThrow(
      /not valid: acme.com/,
    );
  });

  it("reports Resend's error message", async () => {
    const f = fakeFetch({ statusCode: 403, message: "The mail.acme.com domain is not verified." }, 403);
    await expect(runSendEmail(request({ to: "a@acme.com", subject: "x", markdown: "y" }), withFetch(f))).rejects.toThrow(
      /\(403\): The mail.acme.com domain is not verified/,
    );
  });
});

describe("read actions", () => {
  it("returns a template's subject and variable keys", async () => {
    const f = fakeFetch({
      id: "tpl_1",
      alias: "daily-ops",
      name: "Daily ops",
      status: "published",
      subject: "Ops for {{{date}}}",
      html: "<p>long</p>",
      variables: [{ key: "date", type: "string", fallback_value: null }, { key: "count", type: "number", fallback_value: 0 }],
    });
    const out = await runGetTemplate(request({ template: "daily-ops" }), withFetch(f));
    expect(sentBody(f).url).toBe("https://api.resend.com/templates/daily-ops");
    expect(out.result).toEqual({
      id: "tpl_1",
      alias: "daily-ops",
      name: "Daily ops",
      status: "published",
      subject: "Ops for {{{date}}}",
      variables: [{ key: "date", type: "string" }, { key: "count", type: "number", fallback: 0 }],
    });
  });

  it("returns an email's delivery status", async () => {
    const f = fakeFetch({ id: "em_1", last_event: "bounced", to: ["a@acme.com"], subject: "x", created_at: "2026-09-29" });
    const out = await runGetEmailStatus(request({ emailId: "em_1" }), withFetch(f));
    expect(out.result).toMatchObject({ emailId: "em_1", status: "bounced" });
  });
});

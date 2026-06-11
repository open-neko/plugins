// CH5 — the WhatsApp channel: projection (1024-char clamp, reply
// buttons), Cloud API inbound normalization (incl. CH1 sender capture),
// X-Hub-Signature-256 verification, delivery.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CapabilityProfile } from "@open-neko/plugin-types";
import {
  deliver,
  parseInbound,
  verifyInbound,
  WHATSAPP_PROFILE,
} from "../src/plugin.js";
import { projectWhatsapp } from "../src/projection.js";

const profile: CapabilityProfile = WHATSAPP_PROFILE;

const webhook = (message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "15550001111" },
            contacts: [{ wa_id: "4477123", profile: { name: "Ada" } }],
            messages: [{ from: "4477123", ...message }],
          },
        },
      ],
    },
  ],
});

describe("projectWhatsapp", () => {
  it("renders an approval ask as reply buttons and clamps to the char budget", () => {
    const { body, buttons } = projectWhatsapp(
      [
        { kind: "converse", text: "x".repeat(2000) },
        { kind: "ask", ask: "approval", prompt: "Send it?", decisionRef: "ar-7" },
      ] as never,
      profile,
    );
    expect(body.length).toBeLessThanOrEqual(1024);
    expect(buttons).toEqual([
      { id: "approve:ar-7", title: "Approve" },
      { id: "reject:ar-7", title: "Reject" },
    ]);
  });
});

describe("parseInbound", () => {
  it("normalizes a text message with sender + recipient", () => {
    const result = parseInbound({
      raw: webhook({ type: "text", text: { body: "hi neko" } }),
      headers: {},
      body: "",
    } as never);
    expect(result.intents).toEqual([{ kind: "utterance", text: "hi neko" }]);
    expect(result.sender).toEqual({
      id: "4477123",
      displayName: "Ada",
      workspaceId: "15550001111",
    });
    expect(result.recipient).toEqual({ kind: "whatsapp", to: "4477123" });
  });

  it("decodes an interactive reply button into a decision", () => {
    const result = parseInbound({
      raw: webhook({
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: "approve:ar-7", title: "Approve" } },
      }),
      headers: {},
      body: "",
    } as never);
    expect(result.intents).toEqual([
      { kind: "decision", decisionRef: "ar-7", choice: "approve" },
    ]);
  });
});

describe("verifyInbound", () => {
  it("verifies X-Hub-Signature-256 over the raw body, failing closed", () => {
    const secret = "app-secret";
    process.env.WHATSAPP_APP_SECRET = secret;
    const body = JSON.stringify(webhook({ type: "text", text: { body: "x" } }));
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(
      verifyInbound({ headers: { "X-Hub-Signature-256": sig }, body } as never),
    ).toEqual({ ok: true });
    expect(
      verifyInbound({ headers: { "X-Hub-Signature-256": "sha256=dead" }, body } as never),
    ).toEqual({ ok: false });
    expect(verifyInbound({ headers: {}, body } as never)).toEqual({ ok: false });
    delete process.env.WHATSAPP_APP_SECRET;
    expect(
      verifyInbound({ headers: { "X-Hub-Signature-256": sig }, body } as never),
    ).toEqual({ ok: false });
  });
});

describe("deliver", () => {
  it("sends interactive messages when the projection carries buttons", async () => {
    process.env.WHATSAPP_TOKEN = "tok";
    process.env.WHATSAPP_PHONE_ID = "15550001111";
    const sent: Array<Record<string, unknown>> = [];
    const result = await deliver(
      {
        recipient: { to: "4477123" },
        events: [
          { kind: "ask", ask: "approval", prompt: "Send it?", decisionRef: "ar-7" },
        ],
        profile,
      } as never,
      {
        createClient: () => ({
          sendMessage: async (payload) => {
            sent.push(payload);
            return { id: "wamid.1" };
          },
        }),
      },
    );
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_ID;
    expect(result).toEqual({ delivered: true, ref: "wamid.1" });
    expect(sent[0].type).toBe("interactive");
  });

  it("dry-runs without credentials", async () => {
    delete process.env.WHATSAPP_TOKEN;
    const result = await deliver(
      {
        recipient: { to: "4477123" },
        events: [{ kind: "converse", text: "hello" }],
        profile,
      } as never,
    );
    expect(result.delivered).toBe(false);
    expect(result.ref).toMatch(/^dry-run:/);
  });
});

import { describe, expect, it } from "vitest";
import { definePlugin } from "../src/define-plugin";
import { dispatchPluginRpc } from "../src/runner";
import { RPC_PROTOCOL_VERSION, RegisterResult } from "../src/rpc";
import { CapabilityProfile } from "../src/channel";

const sampleProfile = {
  modalities: ["text"] as const,
  richMedia: { markdown: true, cards: false, charts: false, images: false, interactiveControls: true },
  interaction: { turnTaking: "async" as const, canApproveInline: true, quickReplies: true },
  constraints: { latencyClass: "interactive" as const, attentionModel: "push" as const },
  fidelity: "summary" as const,
};

const channelPlugin = definePlugin({
  name: "@open-neko/channel-example",
  version: "0.1.0",
  capabilities: {
    channel: {
      providerLabel: "Example",
      profile: sampleProfile,
      directions: ["outbound", "inbound"],
      ingress: "webhook",
      deliver: async (p) => ({
        delivered: true,
        ref: `sent:${(p.recipient as { chatId?: number }).chatId}`,
      }),
      parseInbound: async (p) => ({
        intents: [{ kind: "utterance", text: String((p.raw as { text?: string }).text) }],
      }),
      verifyInbound: async (p) => ({ ok: p.headers["x-secret"] === "s3cret" }),
    },
  },
});

describe("definePlugin — channel capability", () => {
  it("accepts a channel-only plugin", () => {
    expect(channelPlugin.capabilities.channel?.providerLabel).toBe("Example");
    expect(channelPlugin.capabilities.action).toBeUndefined();
  });

  it("throws when channel.providerLabel is missing", () => {
    expect(() =>
      definePlugin({
        name: "@x/y",
        version: "0.1.0",
        capabilities: {
          channel: { providerLabel: "", profile: sampleProfile, directions: ["outbound"], deliver: async () => ({ delivered: true }) },
        },
      }),
    ).toThrow(/providerLabel/);
  });

  it("throws when channel.profile is missing", () => {
    expect(() =>
      definePlugin({
        name: "@x/y",
        version: "0.1.0",
        capabilities: {
          channel: { providerLabel: "X", profile: undefined as unknown as typeof sampleProfile, directions: ["outbound"], deliver: async () => ({ delivered: true }) },
        },
      }),
    ).toThrow(/profile/);
  });

  it("throws when channel.directions is empty", () => {
    expect(() =>
      definePlugin({
        name: "@x/y",
        version: "0.1.0",
        capabilities: {
          channel: { providerLabel: "X", profile: sampleProfile, directions: [], deliver: async () => ({ delivered: true }) },
        },
      }),
    ).toThrow(/directions/);
  });

  it("throws when channel.deliver is not a function", () => {
    expect(() =>
      definePlugin({
        name: "@x/y",
        version: "0.1.0",
        capabilities: {
          channel: { providerLabel: "X", profile: sampleProfile, directions: ["outbound"], deliver: "nope" as unknown as () => Promise<never> },
        },
      }),
    ).toThrow(/deliver/);
  });
});

describe("dispatchPluginRpc — channel capability", () => {
  it("register surfaces the channel capability + profile", async () => {
    const r = await dispatchPluginRpc(channelPlugin, { method: "register", paramsJson: "{}" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const registered = RegisterResult.parse(r.result);
    expect(registered.protocol).toBe(RPC_PROTOCOL_VERSION);
    expect(registered.capabilities.channel?.providerLabel).toBe("Example");
    expect(registered.capabilities.channel?.directions).toEqual(["outbound", "inbound"]);
    expect(registered.capabilities.channel?.ingress).toBe("webhook");
    expect(registered.capabilities.channel?.profile.constraints.latencyClass).toBe("interactive");
  });

  it("deliver routes to the handler with recipient + events + profile", async () => {
    const r = await dispatchPluginRpc(channelPlugin, {
      method: "deliver",
      paramsJson: JSON.stringify({
        recipient: { kind: "telegram", chatId: 42 },
        events: [{ kind: "inform", id: "i1", mood: "good", title: "T", body: "B" }],
        profile: sampleProfile,
      }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toEqual({ delivered: true, ref: "sent:42" });
  });

  it("parse_inbound normalizes a raw payload to intents", async () => {
    const r = await dispatchPluginRpc(channelPlugin, {
      method: "parse_inbound",
      paramsJson: JSON.stringify({ raw: { text: "hello" } }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.result as { intents: unknown[] }).intents).toEqual([
      { kind: "utterance", text: "hello" },
    ]);
  });

  it("verify_inbound returns the handler's verdict", async () => {
    const good = await dispatchPluginRpc(channelPlugin, {
      method: "verify_inbound",
      paramsJson: JSON.stringify({ headers: { "x-secret": "s3cret" }, body: "{}" }),
    });
    expect(good.ok && (good.result as { ok: boolean }).ok).toBe(true);
    const bad = await dispatchPluginRpc(channelPlugin, {
      method: "verify_inbound",
      paramsJson: JSON.stringify({ headers: { "x-secret": "nope" }, body: "{}" }),
    });
    expect(bad.ok && (bad.result as { ok: boolean }).ok).toBe(false);
  });

  it("deliver on a non-channel plugin errors", async () => {
    const actionPlugin = definePlugin({
      name: "@x/y",
      version: "0.1.0",
      capabilities: { action: { kinds: [{ kind: "k", description: "d", handler: async () => ({ result: {} }) }] } },
    });
    const r = await dispatchPluginRpc(actionPlugin, {
      method: "deliver",
      paramsJson: JSON.stringify({ recipient: { kind: "x" }, events: [], profile: sampleProfile }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/does not implement a channel/);
  });
});

describe("CapabilityProfile schema", () => {
  it("parses a valid profile", () => {
    expect(() => CapabilityProfile.parse(sampleProfile)).not.toThrow();
  });

  it("rejects a profile missing a richMedia flag", () => {
    const bad = { ...sampleProfile, richMedia: { markdown: true } };
    expect(CapabilityProfile.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty modalities array", () => {
    const bad = { ...sampleProfile, modalities: [] };
    expect(CapabilityProfile.safeParse(bad).success).toBe(false);
  });
});

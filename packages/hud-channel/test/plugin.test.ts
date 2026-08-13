import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchPluginRpc, RPC_PROTOCOL_VERSION } from "@open-neko/plugin-types";
import plugin, { deliver, HUD_PROFILE } from "../src/plugin";
import { signBody } from "../src/security";

const call = (method: string, params: unknown) =>
  dispatchPluginRpc(plugin, { method, paramsJson: JSON.stringify(params ?? {}) });

describe("channel-hud plugin", () => {
  const originalSecret = process.env.HUD_CHANNEL_SECRET;
  const originalWorkspace = process.env.HUD_CHANNEL_WORKSPACE;

  beforeEach(() => {
    process.env.HUD_CHANNEL_SECRET = "test-secret";
    process.env.HUD_CHANNEL_WORKSPACE = "test-pack";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalSecret === undefined) delete process.env.HUD_CHANNEL_SECRET;
    else process.env.HUD_CHANNEL_SECRET = originalSecret;
    if (originalWorkspace === undefined) delete process.env.HUD_CHANNEL_WORKSPACE;
    else process.env.HUD_CHANNEL_WORKSPACE = originalWorkspace;
  });

  it("registers the generic visual channel contract", async () => {
    const response = await call("register", {});
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const result = response.result as {
      protocol: number;
      pluginName: string;
      capabilities: { channel?: { providerLabel: string; profile: unknown } };
    };
    expect(result.protocol).toBe(RPC_PROTOCOL_VERSION);
    expect(result.pluginName).toBe("@open-neko/channel-hud");
    expect(result.capabilities.channel?.providerLabel).toBe("HUD surface");
    expect(result.capabilities.channel?.profile).toEqual(HUD_PROFILE);
  });

  it("projects and signs an outbound delivery", async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body);
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-openneko-hud-signature"]).toBe(
        `sha256=${signBody(body, "test-secret")}`,
      );
      const envelope = JSON.parse(body) as {
        schema: string;
        workspace: string;
        projections: Array<Record<string, unknown>>;
      };
      expect(envelope.schema).toBe("openneko.hud.delivery.v1");
      expect(envelope.workspace).toBe("test-pack");
      expect(envelope.projections[0]).toMatchObject({
        id: "finding-1",
        type: "finding",
        title: "Transfer rate degraded",
        anchor: { kind: "asset", id: "atlas-dawn" },
      });
      return new Response("{}", { status: 202 });
    });

    const result = await deliver(
      {
        recipient: { kind: "hud", workspace: "test-pack" },
        profile: HUD_PROFILE,
        events: [{
          kind: "inform",
          id: "finding-1",
          mood: "watch",
          title: "Transfer rate degraded",
          body: "Rate is below plan.",
          evidence: [{ label: "Asset", ref: "asset:atlas-dawn" }],
        }],
      },
      {
        fetch: request as typeof fetch,
        now: () => new Date("2026-08-08T10:30:00.000Z"),
        randomId: () => "delivery-1",
        channelUrl: "http://example.test",
      },
    );

    expect(result).toEqual({ delivered: true, ref: "delivery-1" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("normalizes decisions and utterances without domain assumptions", async () => {
    const decision = await call("parse_inbound", {
      raw: {
        kind: "decision",
        decisionRef: "request-7",
        choice: "approve",
        operatorId: "op-4",
        operatorName: "Control room",
      },
    });
    expect(decision.ok && decision.result).toMatchObject({
      intents: [{ kind: "decision", decisionRef: "request-7", choice: "approve" }],
      recipient: { kind: "hud", workspace: "test-pack" },
      sender: { id: "op-4", displayName: "Control room", workspaceId: "test-pack" },
    });

    const utterance = await call("parse_inbound", {
      raw: { kind: "utterance", text: "Focus the active incident" },
    });
    expect(utterance.ok && utterance.result).toMatchObject({
      intents: [{ kind: "utterance", text: "Focus the active incident" }],
    });
  });

  it("verifies inbound HMAC signatures case-insensitively", async () => {
    const body = JSON.stringify({ kind: "decision", decisionRef: "r1", choice: "reject" });
    const good = await call("verify_inbound", {
      headers: { "X-OpenNeko-HUD-Signature": `sha256=${signBody(body, "test-secret")}` },
      body,
    });
    expect(good.ok && (good.result as { ok: boolean }).ok).toBe(true);

    const bad = await call("verify_inbound", {
      headers: { "x-openneko-hud-signature": "sha256=" + "0".repeat(64) },
      body,
    });
    expect(bad.ok && (bad.result as { ok: boolean }).ok).toBe(false);
  });

  it("rejects delivery when the secret is absent", async () => {
    delete process.env.HUD_CHANNEL_SECRET;
    await expect(deliver({
      recipient: { kind: "hud" },
      profile: HUD_PROFILE,
      events: [{ kind: "converse", id: "m1", role: "assistant", text: "hello" }],
    }, {
      fetch: vi.fn() as unknown as typeof fetch,
    })).rejects.toThrow("HUD_CHANNEL_SECRET is required");
  });
});

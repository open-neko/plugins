import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dispatchPluginRpc, RPC_PROTOCOL_VERSION } from "@open-neko/plugin-types";
import plugin, { TELEGRAM_PROFILE, pollInbound } from "../src/plugin";
import type { TelegramClient } from "../src/telegram-client";

const call = (method: string, params: unknown) =>
  dispatchPluginRpc(plugin, { method, paramsJson: JSON.stringify(params ?? {}) });

describe("channel-telegram plugin RPC", () => {
  const origToken = process.env.TELEGRAM_BOT_TOKEN;
  const origSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });
  afterEach(() => {
    if (origToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = origToken;
    if (origSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = origSecret;
  });

  it("register reports the channel capability + profile from code", async () => {
    const res = await call("register", {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const result = res.result as {
      protocol: number;
      pluginName: string;
      capabilities: { channel?: { providerLabel: string; directions: string[]; profile: unknown } };
    };
    expect(result.protocol).toBe(RPC_PROTOCOL_VERSION);
    expect(result.pluginName).toBe("@open-neko/channel-telegram");
    expect(result.capabilities.channel?.providerLabel).toBe("Telegram");
    expect(result.capabilities.channel?.directions).toEqual(["outbound", "inbound"]);
    expect(result.capabilities.channel?.profile).toEqual(TELEGRAM_PROFILE);
  });

  it("deliver dry-runs without a token and reports not delivered", async () => {
    const events = [{ kind: "inform", id: "i1", mood: "good", title: "All clear", body: "Nothing to do." }];
    const res = await call("deliver", {
      recipient: { kind: "telegram", chatId: 555 },
      events,
      profile: TELEGRAM_PROFILE,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const result = res.result as { delivered: boolean; ref?: string };
    expect(result.delivered).toBe(false);
    expect(result.ref).toMatch(/^dry-run:/);
  });

  it("parse_inbound normalizes a button tap to a decision", async () => {
    const res = await call("parse_inbound", { raw: { callback_query: { data: "approve:dr-7" } } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const result = res.result as { intents: unknown[] };
    expect(result.intents).toEqual([{ kind: "decision", decisionRef: "dr-7", choice: "approve" }]);
  });

  it("verify_inbound matches the configured secret and rejects mismatch / missing", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
    const good = await call("verify_inbound", {
      headers: { "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
      body: "{}",
    });
    expect(good.ok && (good.result as { ok: boolean }).ok).toBe(true);

    const bad = await call("verify_inbound", {
      headers: { "x-telegram-bot-api-secret-token": "nope" },
      body: "{}",
    });
    expect(bad.ok && (bad.result as { ok: boolean }).ok).toBe(false);

    const missing = await call("verify_inbound", { headers: {}, body: "{}" });
    expect(missing.ok && (missing.result as { ok: boolean }).ok).toBe(false);
  });

  it("parse_inbound surfaces the sender recipient (for auto-bind)", async () => {
    const res = await call("parse_inbound", {
      raw: { message: { text: "hi", chat: { id: 8102762294 } } },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const result = res.result as { intents: unknown[]; recipient?: unknown };
    expect(result.recipient).toEqual({ kind: "telegram", chatId: 8102762294 });
  });

  it("poll_inbound dry-runs to an empty batch without a token", async () => {
    const res = await call("poll_inbound", {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.result as { updates: unknown[] }).updates).toEqual([]);
  });

  it("pollInbound fetches getUpdates, splits the batch, and advances the cursor", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t";
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const fakeClient = {
      call: async (method: string, body: Record<string, unknown>) => {
        calls.push({ method, body });
        return [
          { update_id: 10, message: { text: "hi", chat: { id: 9 } } },
          { update_id: 11, callback_query: { data: "approve:x", message: { chat: { id: 9 } } } },
        ];
      },
    } as unknown as TelegramClient;
    const res = await pollInbound({ cursor: "10" }, { createClient: () => fakeClient });
    expect(calls[0]?.method).toBe("getUpdates");
    expect(calls[0]?.body).toMatchObject({ timeout: 0, offset: 10 });
    expect(res.updates).toHaveLength(2);
    expect(res.cursor).toBe("12");
  });
});

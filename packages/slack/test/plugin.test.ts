import { afterEach, beforeEach, describe, expect, it } from "vitest";
import plugin, {
  runLookup,
  runReact,
  runSendDm,
  runSendMessage,
  SlackPluginError,
} from "../src/plugin";
import type { SlackClient, SlackEnvelope } from "../src/slack-client";
import {
  dispatchPluginRpc,
  RPC_PROTOCOL_VERSION,
} from "@open-neko/plugin-types";

interface RecordedCall {
  shape: "postJson" | "postForm" | "get";
  method: string;
  body: Record<string, unknown>;
}

function fakeClient(
  responses: Partial<Record<string, SlackEnvelope | ((c: RecordedCall) => SlackEnvelope)>>,
): { client: SlackClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const respond = (call: RecordedCall): SlackEnvelope => {
    const r = responses[call.method];
    if (typeof r === "function") return r(call);
    if (r) return r;
    throw new Error(`fakeClient: no response for ${call.method}`);
  };
  const client: SlackClient = {
    async postJson(method, body) {
      const call: RecordedCall = { shape: "postJson", method, body };
      calls.push(call);
      return respond(call);
    },
    async postForm(method, body) {
      const call: RecordedCall = { shape: "postForm", method, body };
      calls.push(call);
      return respond(call);
    },
    async get(method, params) {
      const call: RecordedCall = { shape: "get", method, body: params };
      calls.push(call);
      return respond(call);
    },
  };
  return { client, calls };
}

describe("plugin shape", () => {
  it("declares all four Slack actions", () => {
    expect(plugin.name).toBe("@open-neko/plugin-slack");
    expect(plugin.capabilities.action?.kinds.map((a) => a.kind)).toEqual([
      "send_slack_message",
      "send_slack_dm",
      "react_slack_message",
      "lookup_slack_entity",
    ]);
  });

  it("register() via dispatcher reports all kinds", async () => {
    const r = await dispatchPluginRpc(plugin, {
      method: "register",
      paramsJson: "{}",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = r.result as {
      protocol: number;
      capabilities: { action?: { kinds: Array<{ kind: string }> } };
    };
    expect(out.protocol).toBe(RPC_PROTOCOL_VERSION);
    expect(out.capabilities.action?.kinds).toHaveLength(4);
  });
});

describe("token resolution", () => {
  it("throws SlackPluginError when SLACK_BOT_TOKEN is missing", async () => {
    const previous = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    try {
      await expect(
        runSendMessage(
          { channel: "C", text: "hi" },
          { createClient: () => ({} as SlackClient) },
        ),
      ).rejects.toBeInstanceOf(SlackPluginError);
    } finally {
      if (previous !== undefined) process.env.SLACK_BOT_TOKEN = previous;
    }
  });
});

describe("runSendMessage", () => {
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
  });
  afterEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("posts via chat.postMessage and returns ts in externalRef", async () => {
    const { client, calls } = fakeClient({
      "chat.postMessage": { ok: true, ts: "1700000.0001", channel: "C123" },
    });
    const out = await runSendMessage(
      { channel: "#alerts", text: "ping" },
      { createClient: () => client },
    );
    expect(calls[0]?.method).toBe("chat.postMessage");
    expect(calls[0]?.body).toMatchObject({ channel: "#alerts", text: "ping" });
    expect(out.externalRef).toBe("1700000.0001");
    expect(out.commandOrOperation).toMatch(/chat\.postMessage/);
  });

  it("rejects empty payload", async () => {
    await expect(
      runSendMessage(
        { channel: "", text: "x" },
        { createClient: () => ({} as SlackClient) },
      ),
    ).rejects.toThrow(/channel/);
    await expect(
      runSendMessage(
        { channel: "C", text: "" },
        { createClient: () => ({} as SlackClient) },
      ),
    ).rejects.toThrow(/text/);
  });
});

describe("runSendDm", () => {
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
  });
  afterEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("opens an IM then posts the message", async () => {
    const { client, calls } = fakeClient({
      "conversations.open": { ok: true, channel: { id: "D123" } },
      "chat.postMessage": { ok: true, ts: "1.0" },
    });
    const out = await runSendDm(
      { user: "U999", text: "hello" },
      { createClient: () => client },
    );
    expect(calls.map((c) => c.method)).toEqual([
      "conversations.open",
      "chat.postMessage",
    ]);
    expect(calls[1]?.body).toMatchObject({ channel: "D123", text: "hello" });
    expect(out.externalRef).toBe("1.0");
  });

  it("errors when conversations.open returns no channel.id", async () => {
    const { client } = fakeClient({
      "conversations.open": { ok: true, channel: {} },
    });
    await expect(
      runSendDm({ user: "U999", text: "hi" }, { createClient: () => client }),
    ).rejects.toThrow(/no channel\.id/);
  });
});

describe("runReact", () => {
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
  });
  afterEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("posts to reactions.add and strips colons from name", async () => {
    const { client, calls } = fakeClient({
      "reactions.add": { ok: true },
    });
    await runReact(
      { channel: "C1", timestamp: "1.0", name: ":thumbsup:" },
      { createClient: () => client },
    );
    expect(calls[0]?.body).toMatchObject({
      channel: "C1",
      timestamp: "1.0",
      name: "thumbsup",
    });
  });
});

describe("runLookup", () => {
  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
  });
  afterEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("user_by_email returns the user id", async () => {
    const { client, calls } = fakeClient({
      "users.lookupByEmail": {
        ok: true,
        user: { id: "U42", name: "amit" },
      },
    });
    const out = await runLookup(
      { kind: "user_by_email", value: "amit@example.com" },
      { createClient: () => client },
    );
    expect(calls[0]?.method).toBe("users.lookupByEmail");
    expect(calls[0]?.body).toEqual({ email: "amit@example.com" });
    expect(out.externalRef).toBe("U42");
  });

  it("channel_by_name pages through conversations.list to find the match", async () => {
    const { client, calls } = fakeClient({
      "conversations.list": (c) => {
        const cursor = (c.body as Record<string, string>).cursor;
        if (!cursor) {
          return {
            ok: true,
            channels: [{ id: "C1", name: "general" }],
            response_metadata: { next_cursor: "page-2" },
          };
        }
        return {
          ok: true,
          channels: [{ id: "C2", name: "alerts" }],
          response_metadata: { next_cursor: "" },
        };
      },
    });
    const out = await runLookup(
      { kind: "channel_by_name", value: "#alerts" },
      { createClient: () => client },
    );
    expect(calls).toHaveLength(2);
    expect(out.externalRef).toBe("C2");
  });

  it("channel_by_name throws when no channel matches", async () => {
    const { client } = fakeClient({
      "conversations.list": {
        ok: true,
        channels: [],
        response_metadata: { next_cursor: "" },
      },
    });
    await expect(
      runLookup({ kind: "channel_by_name", value: "ghost" }, { createClient: () => client }),
    ).rejects.toThrow(/not found/);
  });

  it("rejects unknown kind", async () => {
    await expect(
      runLookup(
        { kind: "garbage" as unknown as "user_by_email", value: "x" },
        { createClient: () => ({} as SlackClient) },
      ),
    ).rejects.toThrow(/unknown lookup scope/);
  });
});

describe("execute_action via dispatcher", () => {
  it("send_slack_message dispatch path surfaces no-token error cleanly", async () => {
    const previous = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    try {
      const r = await dispatchPluginRpc(plugin, {
        method: "execute_action",
        paramsJson: JSON.stringify({
          request: {
            id: "req-1",
            orgId: "org-1",
            scope: "external",
            kind: "send_slack_message",
            target: null,
            summary: "post",
            payload: { channel: "C1", text: "hi" },
            riskLevel: "low",
          },
        }),
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.message).toMatch(/SLACK_BOT_TOKEN/);
    } finally {
      if (previous !== undefined) process.env.SLACK_BOT_TOKEN = previous;
    }
  });
});

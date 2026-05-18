import {
  definePlugin,
  type PluginActionOutcome,
  type PluginActionRequest,
} from "@open-neko/plugin-types";
import {
  createSlackClient,
  SlackApiError,
  type SlackClient,
} from "./slack-client.js";

/** Test seam: inject a fake SlackClient instead of the real one. */
export interface InvokeOptions {
  createClient?: (token: string) => SlackClient;
}

export class SlackPluginError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "SlackPluginError";
  }
}

function resolveToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new SlackPluginError(
      "SLACK_BOT_TOKEN env var is not set (run `openneko secrets set @open-neko/plugin-slack SLACK_BOT_TOKEN`)",
    );
  }
  return token;
}

function clientOrDefault(options: InvokeOptions): SlackClient {
  const make = options.createClient ?? ((token) => createSlackClient({ token }));
  return make(resolveToken());
}

export interface SendSlackMessagePayload {
  channel: string;
  text: string;
  blocks?: unknown[];
  thread_ts?: string;
}

export async function runSendMessage(
  payload: SendSlackMessagePayload,
  options: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  if (!payload.channel || typeof payload.channel !== "string") {
    throw new SlackPluginError("payload.channel (channel id or name) is required");
  }
  if (!payload.text || typeof payload.text !== "string") {
    throw new SlackPluginError("payload.text is required");
  }
  const client = clientOrDefault(options);
  const envelope = await client.postJson("chat.postMessage", {
    channel: payload.channel,
    text: payload.text,
    blocks: payload.blocks,
    thread_ts: payload.thread_ts,
  });
  const channel = (envelope.channel as string | undefined) ?? payload.channel;
  const ts = envelope.ts as string | undefined;
  return {
    commandOrOperation: `slack.chat.postMessage:${channel}`,
    externalRef: ts ?? null,
    result: { channel, ts: ts ?? null, permalink: null },
  };
}

export interface SendSlackDmPayload {
  user: string;
  text: string;
  blocks?: unknown[];
}

export async function runSendDm(
  payload: SendSlackDmPayload,
  options: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  if (!payload.user || typeof payload.user !== "string") {
    throw new SlackPluginError("payload.user (user id, e.g. U123) is required");
  }
  if (!payload.text || typeof payload.text !== "string") {
    throw new SlackPluginError("payload.text is required");
  }
  const client = clientOrDefault(options);
  const opened = await client.postJson("conversations.open", {
    users: payload.user,
  });
  const channelId = (opened.channel as { id?: string } | undefined)?.id;
  if (!channelId) {
    throw new SlackPluginError(
      `Slack conversations.open returned no channel.id for user ${payload.user}`,
    );
  }
  const sent = await client.postJson("chat.postMessage", {
    channel: channelId,
    text: payload.text,
    blocks: payload.blocks,
  });
  const ts = sent.ts as string | undefined;
  return {
    commandOrOperation: `slack.chat.postMessage:dm:${payload.user}`,
    externalRef: ts ?? null,
    result: { user: payload.user, channel: channelId, ts: ts ?? null },
  };
}

export interface ReactSlackMessagePayload {
  channel: string;
  timestamp: string;
  name: string;
}

export async function runReact(
  payload: ReactSlackMessagePayload,
  options: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  if (!payload.channel || !payload.timestamp || !payload.name) {
    throw new SlackPluginError(
      "payload.channel, payload.timestamp, payload.name are all required",
    );
  }
  const client = clientOrDefault(options);
  await client.postJson("reactions.add", {
    channel: payload.channel,
    timestamp: payload.timestamp,
    name: payload.name.replace(/^:|:$/g, ""),
  });
  return {
    commandOrOperation: `slack.reactions.add:${payload.name}`,
    externalRef: null,
    result: {
      channel: payload.channel,
      timestamp: payload.timestamp,
      name: payload.name,
    },
  };
}

export type LookupKind = "user_by_email" | "channel_by_name";

export interface LookupSlackEntityPayload {
  kind: LookupKind;
  value: string;
}

export async function runLookup(
  payload: LookupSlackEntityPayload,
  options: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  if (!payload.kind || !payload.value) {
    throw new SlackPluginError(
      "payload.kind ('user_by_email' or 'channel_by_name') and payload.value are required",
    );
  }
  const client = clientOrDefault(options);
  if (payload.kind === "user_by_email") {
    const envelope = await client.get("users.lookupByEmail", {
      email: payload.value,
    });
    const user = envelope.user as { id?: string; name?: string } | undefined;
    if (!user?.id) {
      throw new SlackPluginError(
        `Slack users.lookupByEmail returned no user.id for ${payload.value}`,
      );
    }
    return {
      commandOrOperation: `slack.users.lookupByEmail:${payload.value}`,
      externalRef: user.id,
      result: { kind: "user_by_email", id: user.id, name: user.name ?? null },
    };
  }
  if (payload.kind === "channel_by_name") {
    const target = payload.value.replace(/^#/, "");
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = {
        types: "public_channel,private_channel",
        limit: "1000",
      };
      if (cursor) params.cursor = cursor;
      const envelope = await client.get("conversations.list", params);
      const channels = (envelope.channels ?? []) as Array<{
        id?: string;
        name?: string;
      }>;
      const match = channels.find((c) => c.name === target);
      if (match?.id) {
        return {
          commandOrOperation: `slack.conversations.list:${target}`,
          externalRef: match.id,
          result: { kind: "channel_by_name", id: match.id, name: target },
        };
      }
      const nextCursor = (envelope.response_metadata as { next_cursor?: string } | undefined)
        ?.next_cursor;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    throw new SlackPluginError(`Slack channel "${target}" not found`);
  }
  throw new SlackPluginError(`unknown lookup kind: ${payload.kind}`);
}

async function handleSendMessage(
  request: PluginActionRequest,
): Promise<PluginActionOutcome> {
  return runSendMessage(
    (request.payload ?? {}) as unknown as SendSlackMessagePayload,
  );
}

async function handleSendDm(
  request: PluginActionRequest,
): Promise<PluginActionOutcome> {
  return runSendDm(
    (request.payload ?? {}) as unknown as SendSlackDmPayload,
  );
}

async function handleReact(
  request: PluginActionRequest,
): Promise<PluginActionOutcome> {
  return runReact(
    (request.payload ?? {}) as unknown as ReactSlackMessagePayload,
  );
}

async function handleLookup(
  request: PluginActionRequest,
): Promise<PluginActionOutcome> {
  return runLookup(
    (request.payload ?? {}) as unknown as LookupSlackEntityPayload,
  );
}

export default definePlugin({
  name: "@open-neko/plugin-slack",
  version: "0.1.0",
  capabilities: {
    action: {
      kinds: [
        {
          kind: "send_slack_message",
          description:
            "Post a message to a Slack channel. Payload: { channel, text, blocks?, thread_ts? }. channel is a channel id (preferred) or #name. Requires SLACK_BOT_TOKEN with chat:write.",
          handler: handleSendMessage,
        },
        {
          kind: "send_slack_dm",
          description:
            "DM a user. Payload: { user, text, blocks? }. user is a user id (e.g. U123). Opens an IM channel via conversations.open then posts. Requires im:write + chat:write.",
          handler: handleSendDm,
        },
        {
          kind: "react_slack_message",
          description:
            "React to a message. Payload: { channel, timestamp, name }. name is the emoji shortcode without colons (e.g. 'thumbsup'). Requires reactions:write.",
          handler: handleReact,
        },
        {
          kind: "lookup_slack_entity",
          description:
            "Resolve a user email to id, or a channel name to id. Payload: { kind: 'user_by_email' | 'channel_by_name', value }. Returns id + name. Requires users:read.email and/or channels:read+groups:read.",
          handler: handleLookup,
        },
      ],
    },
  },
});

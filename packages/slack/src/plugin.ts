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
    throw new SlackPluginError(
      "payload.user (Slack user id, email, or display name) is required",
    );
  }
  if (!payload.text || typeof payload.text !== "string") {
    throw new SlackPluginError("payload.text is required");
  }
  const client = clientOrDefault(options);
  // Slack's conversations.open requires a user id (U…/W…). Models often pass
  // the original name they got from the operator and forget to substitute
  // the lookup_slack_entity result. Resolve here so the action works either
  // way — passing a name/email is just shorthand for "look it up and DM".
  const userId = USER_ID_RE.test(payload.user)
    ? payload.user
    : await findUserId(client, payload.user);
  const opened = await client.postJson("conversations.open", { users: userId });
  const channelId = (opened.channel as { id?: string } | undefined)?.id;
  if (!channelId) {
    throw new SlackPluginError(
      `Slack conversations.open returned no channel.id for user ${userId}`,
    );
  }
  const sent = await client.postJson("chat.postMessage", {
    channel: channelId,
    text: payload.text,
    blocks: payload.blocks,
  });
  const ts = sent.ts as string | undefined;
  return {
    commandOrOperation: `slack.chat.postMessage:dm:${userId}`,
    externalRef: ts ?? null,
    result: { user: userId, channel: channelId, ts: ts ?? null },
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

/**
 * Two payload shapes are accepted:
 *
 * 1. Natural / agent-friendly (preferred): { type: "user"|"channel", query }
 *    `query` can be a name, email, Slack id (U…/C…), or #channel-name. The
 *    plugin auto-routes to the right Slack API based on the shape of the
 *    value: email → `users.lookupByEmail`; id → `users.info`/`conversations.info`;
 *    name → paged `users.list`/`conversations.list` with a tolerant match.
 *
 * 2. Precise legacy: { kind: "user_by_email"|"channel_by_name", value }
 *    Backwards-compatible with v0.1.0. Always hits the precise endpoint
 *    even if `value` looks like an id.
 *
 * Either shape is fine. The natural shape lets the agent emit
 * `{ type: "user", query: "amit" }` without first knowing the email.
 */
export type LookupKind = "user_by_email" | "channel_by_name";

export interface LookupSlackEntityPayload {
  // Natural shape:
  type?: "user" | "channel";
  query?: string;
  // Legacy precise shape (still supported):
  kind?: LookupKind;
  value?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USER_ID_RE = /^[UW][A-Z0-9]+$/;
const CHANNEL_ID_RE = /^[CDG][A-Z0-9]+$/;

function normalizeLookupInput(payload: LookupSlackEntityPayload): {
  scope: "user" | "channel";
  query: string;
  precise?: LookupKind;
} {
  // Accept any combination of {type|kind} + {query|value}. Models reach for
  // both shapes interchangeably — meet them where they are.
  const scopeRaw =
    (payload as { type?: string; kind?: string }).type ??
    (payload as { kind?: string }).kind;
  const queryRaw =
    (payload as { query?: string; value?: string }).query ??
    (payload as { value?: string }).value;
  if (!scopeRaw || typeof queryRaw !== "string" || queryRaw.length === 0) {
    throw new SlackPluginError(
      "payload must include a scope ('user' or 'channel') and a query (name, email, id, or #channel). " +
        "Accepted shapes: { type, query } | { kind, value } | { kind: 'user_by_email'|'channel_by_name', value }",
    );
  }
  if (scopeRaw === "user_by_email") {
    return { scope: "user", query: queryRaw, precise: "user_by_email" };
  }
  if (scopeRaw === "channel_by_name") {
    return { scope: "channel", query: queryRaw, precise: "channel_by_name" };
  }
  if (scopeRaw === "user" || scopeRaw === "channel") {
    return { scope: scopeRaw, query: queryRaw };
  }
  throw new SlackPluginError(`unknown lookup scope "${scopeRaw}"`);
}

function nameMatchesUser(
  user: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string; real_name_normalized?: string } },
  needle: string,
): boolean {
  const n = needle.toLowerCase();
  return [
    user.name,
    user.real_name,
    user.profile?.display_name,
    user.profile?.real_name,
    user.profile?.real_name_normalized,
  ].some((v) => typeof v === "string" && v.toLowerCase() === n) ||
    [
      user.name,
      user.real_name,
      user.profile?.display_name,
      user.profile?.real_name,
    ].some((v) => typeof v === "string" && v.toLowerCase().split(/\s+/).includes(n));
}

type FoundUser = {
  id: string;
  name: string | null;
  real_name: string | null;
  via: "users.info" | "users.lookupByEmail" | "users.list";
};

// Resolve a query (id, email, or display name) to a Slack user id. The
// minimal version, used both by lookup_slack_entity and as an inline
// fallback in send_slack_dm when the agent forgets to use the looked-up id.
async function findUser(
  client: SlackClient,
  query: string,
  forceEmailPath: boolean = false,
): Promise<FoundUser> {
  if (forceEmailPath || EMAIL_RE.test(query)) {
    const envelope = await client.get("users.lookupByEmail", { email: query });
    const user = envelope.user as { id?: string; name?: string } | undefined;
    if (!user?.id) {
      throw new SlackPluginError(
        `Slack users.lookupByEmail returned no user.id for ${query}`,
      );
    }
    return { id: user.id, name: user.name ?? null, real_name: null, via: "users.lookupByEmail" };
  }
  if (USER_ID_RE.test(query)) {
    const envelope = await client.get("users.info", { user: query });
    const user = envelope.user as { id?: string; name?: string } | undefined;
    if (!user?.id) {
      throw new SlackPluginError(`Slack users.info returned no user for ${query}`);
    }
    return { id: user.id, name: user.name ?? null, real_name: null, via: "users.info" };
  }
  // Name fallback: paginate users.list (up to 10 pages × 1000 = 10k users).
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = { limit: "1000" };
    if (cursor) params.cursor = cursor;
    const envelope = await client.get("users.list", params);
    const members = (envelope.members ?? []) as Array<{
      id?: string;
      name?: string;
      real_name?: string;
      deleted?: boolean;
      is_bot?: boolean;
      profile?: { display_name?: string; real_name?: string; real_name_normalized?: string };
    }>;
    const match = members.find(
      (u) => !u.deleted && !u.is_bot && u.id && nameMatchesUser(u, query),
    );
    if (match?.id) {
      return {
        id: match.id,
        name: match.name ?? null,
        real_name: match.real_name ?? null,
        via: "users.list",
      };
    }
    const nextCursor = (envelope.response_metadata as { next_cursor?: string } | undefined)
      ?.next_cursor;
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  throw new SlackPluginError(`Slack user "${query}" not found by name or email`);
}

async function findUserId(client: SlackClient, query: string): Promise<string> {
  return (await findUser(client, query)).id;
}

async function lookupUser(
  client: SlackClient,
  query: string,
  precise?: LookupKind,
): Promise<PluginActionOutcome> {
  const user = await findUser(client, query, precise === "user_by_email");
  const kind = precise === "user_by_email" ? "user_by_email" : "user";
  return {
    commandOrOperation: `slack.${user.via}:${query}`,
    externalRef: user.id,
    result: {
      kind,
      id: user.id,
      name: user.name,
      ...(user.real_name ? { real_name: user.real_name } : {}),
    },
  };
}

async function lookupChannel(
  client: SlackClient,
  query: string,
  precise?: LookupKind,
): Promise<PluginActionOutcome> {
  const target = query.replace(/^#/, "");
  if (precise === undefined && CHANNEL_ID_RE.test(target)) {
    const envelope = await client.get("conversations.info", { channel: target });
    const channel = envelope.channel as { id?: string; name?: string } | undefined;
    if (!channel?.id) {
      throw new SlackPluginError(
        `Slack conversations.info returned no channel for ${target}`,
      );
    }
    return {
      commandOrOperation: `slack.conversations.info:${target}`,
      externalRef: channel.id,
      result: { kind: "channel", id: channel.id, name: channel.name ?? null },
    };
  }
  // Name fallback (this is also the legacy channel_by_name path).
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
        result: {
          kind: precise === "channel_by_name" ? "channel_by_name" : "channel",
          id: match.id,
          name: target,
        },
      };
    }
    const nextCursor = (envelope.response_metadata as { next_cursor?: string } | undefined)
      ?.next_cursor;
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  throw new SlackPluginError(`Slack channel "${target}" not found`);
}

export async function runLookup(
  payload: LookupSlackEntityPayload,
  options: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  const { scope, query, precise } = normalizeLookupInput(payload);
  const client = clientOrDefault(options);
  if (scope === "user") return lookupUser(client, query, precise);
  return lookupChannel(client, query, precise);
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
          default_mode: "ask",
          handler: handleSendMessage,
        },
        {
          kind: "send_slack_dm",
          description:
            "DM a user. Payload: { user, text, blocks? }. `user` can be a Slack user id (U…), an email, or a display name — the plugin resolves it. Opens an IM channel via conversations.open then posts. Requires im:write + chat:write (+ users:read / users:read.email for non-id resolution).",
          default_mode: "ask",
          handler: handleSendDm,
        },
        {
          kind: "react_slack_message",
          description:
            "React to a message. Payload: { channel, timestamp, name }. name is the emoji shortcode without colons (e.g. 'thumbsup'). Requires reactions:write.",
          default_mode: "ask",
          handler: handleReact,
        },
        {
          kind: "lookup_slack_entity",
          description:
            "Resolve a Slack user or channel to its id. Payload: { type: 'user' | 'channel', query } where `query` can be a name, email, Slack id (U…/C…), or #channel-name. Returns id + name. Also accepts the legacy precise form { kind: 'user_by_email' | 'channel_by_name', value }. Requires users:read (+ users:read.email for emails, channels:read+groups:read for channels).",
          default_mode: "auto",
          handler: handleLookup,
        },
      ],
    },
  },
});

import type {
  ChannelRecipient,
  ChannelSender,
  IntentEvent,
} from "@open-neko/plugin-types";

type Obj = Record<string, unknown>;
const asObj = (value: unknown): Obj | null =>
  typeof value === "object" && value !== null ? (value as Obj) : null;
const asStr = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const stripLeadingMention = (text: string): string =>
  text.replace(/^\s*<@[^>]+>\s*/, "").trim();

const isSlashCommand = (payload: Obj): boolean =>
  typeof payload.command === "string" && payload.command.length > 0;

// One umbrella command (/openneko <subcommand> …): the first token of `text`
// is the sub-command, mapped to an `invoke` the worker routes like the web.
const parseSlashCommand = (payload: Obj): IntentEvent[] => {
  const text = (asStr(payload.text) ?? "").trim();
  const [first, ...rest] = text.split(/\s+/).filter(Boolean);
  const command = first ?? (asStr(payload.command) ?? "").replace(/^\//, "");
  if (!command) return [];
  return [{ kind: "invoke", command, args: first ? { text: rest.join(" ") } : {} }];
};

/** Slack slash commands, interactivity (`block_actions`), and Events API
 *  messages → IntentEvent[]. */
export const parseSlackInbound = (raw: unknown): IntentEvent[] => {
  const payload = asObj(raw);
  if (!payload) return [];

  if (isSlashCommand(payload)) return parseSlashCommand(payload);

  if (payload.type === "block_actions" && Array.isArray(payload.actions)) {
    const message = asObj(payload.message);
    const threadRef =
      asStr(message?.thread_ts) ??
      asStr(message?.ts) ??
      asStr(asObj(payload.container)?.message_ts) ??
      undefined;
    const intents: IntentEvent[] = [];
    for (const entry of payload.actions) {
      const action = asObj(entry);
      if (!action) continue;
      const actionId = asStr(action.action_id) ?? "";
      if (actionId === "approve" || actionId === "reject") {
        intents.push({ kind: "decision", decisionRef: asStr(action.value) ?? "", choice: actionId });
      } else if (actionId.startsWith("select:")) {
        // A choice tap continues the thread as the chosen option's label — there's
        // no held session to resume, so it flows in as the user's next reply.
        const label = asStr(asObj(action.text)?.text) ?? actionId.slice(7);
        intents.push({ kind: "utterance", text: label, threadRef });
      }
    }
    return intents;
  }

  if (payload.type === "event_callback") {
    const event = asObj(payload.event);
    if (!event || event.bot_id) return [];
    // @-mention in a channel → reply in a thread rooted at the mention.
    if (event.type === "app_mention" && typeof event.text === "string") {
      const text = stripLeadingMention(event.text);
      const threadRef = asStr(event.thread_ts) ?? asStr(event.ts) ?? undefined;
      return text ? [{ kind: "utterance", text, threadRef }] : [];
    }
    // DM → always respond. Channel messages without a mention are ignored: the
    // bot only subscribes to message.im + app_mention, so it never spams a room.
    if (
      event.type === "message" &&
      typeof event.text === "string" &&
      !event.subtype &&
      event.channel_type === "im"
    ) {
      return [
        { kind: "utterance", text: event.text, threadRef: asStr(event.thread_ts) ?? undefined },
      ];
    }
  }
  return [];
};

/** The conversation to reply into — the worker auto-binds delivery on first contact. */
export const recipientFromSlackPayload = (raw: unknown): ChannelRecipient | undefined => {
  const payload = asObj(raw);
  if (!payload) return undefined;

  // Slash command → ephemeral reply to the invoking user in the same channel.
  if (isSlashCommand(payload)) {
    const channel = asStr(payload.channel_id);
    if (!channel) return undefined;
    const user = asStr(payload.user_id);
    return { kind: "slack", channel, ...(user ? { user, ephemeral: true } : {}) };
  }

  const event = asObj(payload.event);
  const message = asObj(payload.message);
  const container = asObj(payload.container);
  const threadTs =
    asStr(event?.thread_ts) ??
    (event?.type === "app_mention" ? asStr(event?.ts) : null) ??
    asStr(message?.thread_ts) ??
    asStr(message?.ts) ??
    asStr(container?.message_ts);
  const channel =
    asStr(event?.channel) ??
    asStr(asObj(payload.channel)?.id) ??
    asStr(container?.channel_id);
  if (!channel) return undefined;
  return { kind: "slack", channel, ...(threadTs ? { thread_ts: threadTs } : {}) };
};

/**
 * CH1: the sending user. Slash commands carry `user_id`; events carry
 * `event.user` + team scope. Bot messages carry no human sender.
 */
export const senderFromSlackPayload = (raw: unknown): ChannelSender | undefined => {
  const payload = asObj(raw);
  if (!payload) return undefined;

  if (isSlashCommand(payload)) {
    const id = asStr(payload.user_id);
    if (!id) return undefined;
    const displayName = asStr(payload.user_name);
    const workspaceId = asStr(payload.team_id);
    return {
      id,
      ...(displayName ? { displayName } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };
  }

  const event = asObj(payload.event);
  if (event?.bot_id) return undefined;
  const user = asObj(payload.user);
  const id = asStr(event?.user) ?? asStr(user?.id);
  if (!id) return undefined;
  const workspaceId =
    asStr(payload.team_id) ??
    asStr(asObj(payload.team)?.id) ??
    asStr(event?.team) ??
    undefined;
  const displayName = asStr(user?.name) ?? asStr(user?.username) ?? undefined;
  return {
    id,
    ...(displayName ? { displayName } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
};

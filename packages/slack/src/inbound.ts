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

const fromAction = (action: Obj): IntentEvent | null => {
  const actionId = asStr(action.action_id) ?? "";
  const value = asStr(action.value) ?? "";
  if (actionId === "approve") return { kind: "decision", decisionRef: value, choice: "approve" };
  if (actionId === "reject") return { kind: "decision", decisionRef: value, choice: "reject" };
  if (actionId.startsWith("select:")) {
    const sep = value.indexOf(":");
    if (sep < 0) return null;
    return { kind: "select", ref: value.slice(0, sep), optionId: value.slice(sep + 1) };
  }
  return null;
};

/** Slack interactivity (`block_actions`) and Events API messages → IntentEvent[]. */
export const parseSlackInbound = (raw: unknown): IntentEvent[] => {
  const payload = asObj(raw);
  if (!payload) return [];

  if (payload.type === "block_actions" && Array.isArray(payload.actions)) {
    const intents: IntentEvent[] = [];
    for (const entry of payload.actions) {
      const action = asObj(entry);
      const intent = action ? fromAction(action) : null;
      if (intent) intents.push(intent);
    }
    return intents;
  }

  if (payload.type === "event_callback") {
    const event = asObj(payload.event);
    if (event?.type === "message" && typeof event.text === "string" && !event.bot_id) {
      const threadRef = asStr(event.thread_ts) ?? undefined;
      return [{ kind: "utterance", text: event.text, threadRef }];
    }
  }
  return [];
};

/** The conversation to reply into — the worker auto-binds delivery on first contact. */
export const recipientFromSlackPayload = (raw: unknown): ChannelRecipient | undefined => {
  const payload = asObj(raw);
  if (!payload) return undefined;
  const channel =
    asStr(asObj(payload.event)?.channel) ??
    asStr(asObj(payload.channel)?.id) ??
    asStr(asObj(payload.container)?.channel_id);
  return channel ? { kind: "slack", channel } : undefined;
};

/**
 * CH1: the sending user (`event.user` / `user.id`) + team scope. Bot
 * messages carry bot_id, not a human sender — those return undefined.
 */
export const senderFromSlackPayload = (raw: unknown): ChannelSender | undefined => {
  const payload = asObj(raw);
  if (!payload) return undefined;
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

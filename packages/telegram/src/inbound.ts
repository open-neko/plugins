import type { ChannelRecipient, IntentEvent } from "@open-neko/plugin-types";

/** Decodes the `verb:rest` callback_data convention shared with other quick-reply channels. */
const intentFromButtonData = (data: string): IntentEvent | null => {
  const idx = data.indexOf(":");
  if (idx < 0) return null;
  const verb = data.slice(0, idx);
  const rest = data.slice(idx + 1);
  if (verb === "approve") return { kind: "decision", decisionRef: rest, choice: "approve" };
  if (verb === "reject") return { kind: "decision", decisionRef: rest, choice: "reject" };
  if (verb === "select") {
    const sep = rest.indexOf(":");
    if (sep < 0) return null;
    return { kind: "select", ref: rest.slice(0, sep), optionId: rest.slice(sep + 1) };
  }
  return null;
};

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null =>
  typeof v === "object" && v !== null ? (v as Obj) : null;
const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The sender's chat as a delivery recipient — lets the worker auto-bind on first contact. */
export const recipientFromTelegramUpdate = (raw: unknown): ChannelRecipient | undefined => {
  const update = asObj(raw);
  if (!update) return undefined;
  const cq = asObj(update.callback_query);
  const message =
    asObj(update.message) ??
    asObj(update.edited_message) ??
    asObj(update.channel_post) ??
    (cq ? asObj(cq.message) : null);
  const chat = message ? asObj(message.chat) : null;
  const chatId = chat?.id;
  if (typeof chatId === "number" || typeof chatId === "string") {
    return { kind: "telegram", chatId };
  }
  return undefined;
};

const intentFromUpdate = (update: Obj): IntentEvent | null => {
  const cq = asObj(update.callback_query);
  if (cq) {
    const data = asStr(cq.data);
    return data ? intentFromButtonData(data) : null;
  }
  const message =
    asObj(update.message) ?? asObj(update.edited_message) ?? asObj(update.channel_post);
  if (message) {
    const text = asStr(message.text);
    if (!text) return null;
    const chat = asObj(message.chat);
    const chatId = chat?.id;
    const threadRef =
      typeof chatId === "number" || typeof chatId === "string" ? String(chatId) : undefined;
    if (text.startsWith("/")) {
      const segs = text.slice(1).split(/\s+/);
      const cmd = segs[0];
      if (cmd) {
        const rest = segs.slice(1).join(" ");
        return { kind: "invoke", command: cmd, ...(rest ? { args: { text: rest } } : {}) };
      }
    }
    return { kind: "utterance", text, ...(threadRef ? { threadRef } : {}) };
  }
  return null;
};

/**
 * Telegram Update(s) → IntentEvent[]. Accepts a single webhook Update, a
 * getUpdates envelope ({ result: Update[] }), or a bare array of Updates.
 */
export const parseTelegramInbound = (raw: unknown): IntentEvent[] => {
  const obj = asObj(raw);
  const updates: unknown[] = Array.isArray(raw)
    ? raw
    : obj && Array.isArray(obj.result)
      ? (obj.result as unknown[])
      : raw != null
        ? [raw]
        : [];
  const intents: IntentEvent[] = [];
  for (const u of updates) {
    const update = asObj(u);
    const intent = update ? intentFromUpdate(update) : null;
    if (intent) intents.push(intent);
  }
  return intents;
};

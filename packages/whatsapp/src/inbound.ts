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

/** Decodes the `verb:rest` button-id convention shared with other quick-reply channels. */
const intentFromButtonId = (id: string): IntentEvent | null => {
  const idx = id.indexOf(":");
  if (idx < 0) return null;
  const verb = id.slice(0, idx);
  const rest = id.slice(idx + 1);
  if (verb === "approve") return { kind: "decision", decisionRef: rest, choice: "approve" };
  if (verb === "reject") return { kind: "decision", decisionRef: rest, choice: "reject" };
  if (verb === "select") {
    const sep = rest.indexOf(":");
    if (sep < 0) return null;
    return { kind: "select", ref: rest.slice(0, sep), optionId: rest.slice(sep + 1) };
  }
  return null;
};

const fromMessage = (message: Obj): IntentEvent | null => {
  if (message.type === "text") {
    const text = asObj(message.text)?.body;
    return typeof text === "string" ? { kind: "utterance", text } : null;
  }
  if (message.type === "interactive") {
    const reply = asObj(asObj(message.interactive)?.button_reply);
    const id = reply?.id;
    return typeof id === "string" ? intentFromButtonId(id) : null;
  }
  if (message.type === "button") {
    const payload = asObj(message.button)?.payload;
    return typeof payload === "string" ? intentFromButtonId(payload) : null;
  }
  return null;
};

const eachMessage = (raw: unknown, fn: (message: Obj, value: Obj) => void): void => {
  const payload = asObj(raw);
  if (!payload || !Array.isArray(payload.entry)) return;
  for (const entryValue of payload.entry) {
    const changes = asObj(entryValue)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const changeValue of changes) {
      const value = asObj(asObj(changeValue)?.value);
      const messages = value?.messages;
      if (!value || !Array.isArray(messages)) continue;
      for (const messageValue of messages) {
        const message = asObj(messageValue);
        if (message) fn(message, value);
      }
    }
  }
};

/** WhatsApp Cloud API webhook → IntentEvent[]. */
export const parseWhatsappInbound = (raw: unknown): IntentEvent[] => {
  const intents: IntentEvent[] = [];
  eachMessage(raw, (message) => {
    const intent = fromMessage(message);
    if (intent) intents.push(intent);
  });
  return intents;
};

/** The sender's phone as the reply recipient — the worker auto-binds on first contact. */
export const recipientFromWhatsappPayload = (raw: unknown): ChannelRecipient | undefined => {
  let to: string | undefined;
  eachMessage(raw, (message) => {
    if (!to) to = asStr(message.from) ?? undefined;
  });
  return to ? { kind: "whatsapp", to } : undefined;
};

/** CH1: the sending phone (`messages[].from`) + business-number scope + profile name. */
export const senderFromWhatsappPayload = (raw: unknown): ChannelSender | undefined => {
  let sender: ChannelSender | undefined;
  eachMessage(raw, (message, value) => {
    if (sender) return;
    const id = asStr(message.from);
    if (!id) return;
    const workspaceId =
      asStr(asObj(value.metadata)?.phone_number_id) ?? undefined;
    const contacts = Array.isArray(value.contacts) ? value.contacts : [];
    let displayName: string | undefined;
    for (const contactValue of contacts) {
      const contact = asObj(contactValue);
      if (contact && asStr(contact.wa_id) === id) {
        displayName = asStr(asObj(contact.profile)?.name) ?? undefined;
        break;
      }
    }
    sender = {
      id,
      ...(displayName ? { displayName } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };
  });
  return sender;
};

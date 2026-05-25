import { timingSafeEqual } from "node:crypto";
import {
  definePlugin,
  type CapabilityProfile,
  type DeliverParams,
  type DeliverResult,
  type InteractionEvent,
  type ParseInboundParams,
  type ParseInboundResult,
  type VerifyInboundParams,
  type VerifyInboundResult,
} from "@open-neko/plugin-types";
import { parseTelegramInbound } from "./inbound.js";
import { projectTelegram } from "./projection.js";
import { createTelegramClient, type TelegramClient } from "./telegram-client.js";

/**
 * What the Telegram substrate can carry. Kept identical to the manifest's
 * capabilities.channel.profile (package.json) and to @neko/interaction's
 * TELEGRAM_PROFILE — richer than WhatsApp (Markdown, 4096 chars), leaner than
 * web (no cards/charts).
 */
export const TELEGRAM_PROFILE: CapabilityProfile = {
  modalities: ["text"],
  richMedia: { markdown: true, cards: false, charts: false, images: true, interactiveControls: true },
  interaction: { turnTaking: "async", canApproveInline: true, quickReplies: true },
  constraints: { maxOutboundChars: 4096, latencyClass: "interactive", attentionModel: "push" },
  fidelity: "summary",
};

export interface DeliverOptions {
  createClient?: (token: string) => TelegramClient;
}

const resolveChatId = (recipient: DeliverParams["recipient"]): string | number => {
  const chatId = (recipient as { chatId?: unknown }).chatId;
  if (typeof chatId === "string" || typeof chatId === "number") return chatId;
  throw new Error(
    "recipient.chatId is required (the Telegram chat or user id to deliver to)",
  );
};

export async function deliver(
  params: DeliverParams,
  options: DeliverOptions = {},
): Promise<DeliverResult> {
  const events = params.events as InteractionEvent[];
  const messages = projectTelegram(events, params.profile);
  if (messages.length === 0) return { delivered: false };

  const chatId = resolveChatId(params.recipient);
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    // Dry-run: surface the projected payload on stderr (stdout stays the single
    // RPC envelope) so a local harness can show what *would* be sent.
    process.stderr.write(
      `[channel-telegram dry-run] chat=${chatId} ${JSON.stringify(messages)}\n`,
    );
    return { delivered: false, ref: `dry-run:${messages.length}` };
  }

  const make = options.createClient ?? ((t: string) => createTelegramClient({ token: t }));
  const client = make(token);
  let lastId: string | undefined;
  for (const message of messages) {
    const sent = await client.call<{ message_id?: number }>("sendMessage", {
      chat_id: chatId,
      ...message,
    });
    if (typeof sent.message_id === "number") lastId = String(sent.message_id);
  }
  return { delivered: true, ...(lastId ? { ref: lastId } : {}) };
}

export function parseInbound(params: ParseInboundParams): ParseInboundResult {
  return { intents: parseTelegramInbound(params.raw) };
}

export function verifyInbound(params: VerifyInboundParams): VerifyInboundResult {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return { ok: false };
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers)) lower[k.toLowerCase()] = v;
  const header = lower["x-telegram-bot-api-secret-token"];
  if (!header) return { ok: false };
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return { ok: false };
  return { ok: timingSafeEqual(a, b) };
}

export default definePlugin({
  name: "@open-neko/channel-telegram",
  version: "0.1.0",
  capabilities: {
    channel: {
      providerLabel: "Telegram",
      profile: TELEGRAM_PROFILE,
      directions: ["outbound", "inbound"],
      ingress: "webhook",
      deliver,
      parseInbound,
      verifyInbound,
    },
  },
});

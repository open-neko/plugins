import { createHmac, timingSafeEqual } from "node:crypto";
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
import {
  parseWhatsappInbound,
  recipientFromWhatsappPayload,
  senderFromWhatsappPayload,
} from "./inbound.js";
import { projectWhatsapp, type WhatsappButton } from "./projection.js";
import {
  createWhatsappClient,
  type WhatsappClient,
} from "./whatsapp-client.js";

/**
 * CH5 — what the WhatsApp substrate carries. Identical to the manifest's
 * capabilities.channel.profile: plain text clamped to 1024 chars, up to
 * three interactive reply buttons, no markdown/cards/charts.
 */
export const WHATSAPP_PROFILE: CapabilityProfile = {
  modalities: ["text"],
  richMedia: { markdown: false, cards: false, charts: false, images: true, interactiveControls: true },
  interaction: { turnTaking: "async", canApproveInline: true, quickReplies: true },
  constraints: { maxOutboundChars: 1024, latencyClass: "interactive", attentionModel: "push" },
  fidelity: "summary",
};

export interface DeliverOptions {
  createClient?: (token: string, phoneId: string) => WhatsappClient;
}

const resolveTo = (recipient: DeliverParams["recipient"]): string => {
  const to = (recipient as { to?: unknown }).to;
  if (typeof to === "string" && to) return to;
  throw new Error("recipient.to is required (the WhatsApp phone number to deliver to)");
};

const interactivePayload = (to: string, body: string, buttons: WhatsappButton[]) => ({
  to,
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    action: {
      buttons: buttons.map((b) => ({
        type: "reply",
        reply: { id: b.id, title: b.title },
      })),
    },
  },
});

export async function deliver(
  params: DeliverParams,
  options: DeliverOptions = {},
): Promise<DeliverResult> {
  const events = params.events as InteractionEvent[];
  const { body, buttons } = projectWhatsapp(events, params.profile);
  if (!body) return { delivered: false };
  const to = resolveTo(params.recipient);

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) {
    process.stderr.write(
      `[channel-whatsapp dry-run] to=${to} ${JSON.stringify({ body, buttons })}\n`,
    );
    return { delivered: false, ref: "dry-run:1" };
  }

  const make =
    options.createClient ??
    ((t: string, p: string) => createWhatsappClient({ token: t, phoneId: p }));
  const client = make(token, phoneId);
  const payload = buttons?.length
    ? interactivePayload(to, body, buttons)
    : { to, type: "text", text: { body } };
  const sent = await client.sendMessage(payload);
  return { delivered: true, ...(sent.id ? { ref: sent.id } : {}) };
}

export function parseInbound(params: ParseInboundParams): ParseInboundResult {
  const recipient = recipientFromWhatsappPayload(params.raw);
  const sender = senderFromWhatsappPayload(params.raw);
  return {
    intents: parseWhatsappInbound(params.raw),
    ...(recipient ? { recipient } : {}),
    ...(sender ? { sender } : {}),
  };
}

/**
 * Meta webhook signing: hex HMAC-SHA256 of the raw body with the app
 * secret, compared (constant-time) to X-Hub-Signature-256 ("sha256=…").
 * The one-time GET hub.challenge handshake is the ingress route's job.
 */
export function verifyInbound(params: VerifyInboundParams): VerifyInboundResult {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return { ok: false };
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers)) lower[k.toLowerCase()] = v;
  const header = lower["x-hub-signature-256"];
  if (!header) return { ok: false };
  const expected = `sha256=${createHmac("sha256", secret)
    .update(params.body)
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return { ok: false };
  return { ok: timingSafeEqual(a, b) };
}

export default definePlugin({
  name: "@open-neko/channel-whatsapp",
  version: "0.1.0", // x-release-please-version
  capabilities: {
    channel: {
      providerLabel: "WhatsApp",
      profile: WHATSAPP_PROFILE,
      directions: ["outbound", "inbound"],
      ingress: "webhook",
      deliver,
      parseInbound,
      verifyInbound,
    },
  },
});

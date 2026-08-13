import { randomUUID } from "node:crypto";
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
import { projectEvent } from "./projection.js";
import { signBody, signatureIsValid } from "./security.js";

export const HUD_PROFILE: CapabilityProfile = {
  modalities: ["text", "visual"],
  richMedia: {
    markdown: true,
    cards: true,
    charts: true,
    images: true,
    interactiveControls: true,
  },
  interaction: {
    turnTaking: "async",
    canApproveInline: true,
    quickReplies: true,
  },
  constraints: {
    latencyClass: "interactive",
    attentionModel: "push",
  },
  fidelity: "full",
};

const DEFAULT_CHANNEL_URL = "http://demo-channel:443";

function requiredSecret(): string {
  const value = process.env.HUD_CHANNEL_SECRET?.trim();
  if (!value) throw new Error("HUD_CHANNEL_SECRET is required");
  return value;
}

function workspace(): string {
  return process.env.HUD_CHANNEL_WORKSPACE?.trim() || "demo";
}

export interface DeliverOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  randomId?: () => string;
  channelUrl?: string;
}

export async function deliver(
  params: DeliverParams,
  options: DeliverOptions = {},
): Promise<DeliverResult> {
  const events = params.events as InteractionEvent[];
  if (events.length === 0) return { delivered: false };
  const deliveryId = (options.randomId || randomUUID)();
  const envelope = {
    schema: "openneko.hud.delivery.v1",
    deliveryId,
    deliveredAt: (options.now || (() => new Date()))().toISOString(),
    workspace: workspace(),
    recipient: params.recipient,
    projections: events.map((event) => projectEvent(event, params.recipient)),
  };
  const body = JSON.stringify(envelope);
  const request = options.fetch || fetch;
  const response = await request(`${options.channelUrl || DEFAULT_CHANNEL_URL}/api/deliver`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openneko-hud-delivery-id": deliveryId,
      "x-openneko-hud-signature": `sha256=${signBody(body, requiredSecret())}`,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HUD bridge returned ${response.status}: ${detail.slice(0, 240)}`);
  }
  return { delivered: true, ref: deliveryId };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseInbound(params: ParseInboundParams): ParseInboundResult {
  const raw = record(params.raw);
  const kind = string(raw.kind);
  const pack = workspace();
  if (kind === "decision") {
    const decisionRef = string(raw.decisionRef);
    const choice = string(raw.choice);
    if (!decisionRef) throw new Error("decisionRef is required");
    if (choice !== "approve" && choice !== "reject") {
      throw new Error("choice must be approve or reject");
    }
    return {
      intents: [{
        kind: "decision",
        decisionRef,
        choice,
        ...(string(raw.reason) ? { reason: string(raw.reason) } : {}),
      }],
      recipient: { kind: "hud", workspace: pack },
      sender: {
        id: string(raw.operatorId) || `${pack}-operator`,
        ...(string(raw.operatorName) ? { displayName: string(raw.operatorName) } : {}),
        workspaceId: pack,
      },
    };
  }
  if (kind === "utterance") {
    const text = string(raw.text).trim();
    if (!text) throw new Error("text is required");
    return {
      intents: [{ kind: "utterance", text }],
      recipient: { kind: "hud", workspace: pack },
      sender: {
        id: string(raw.operatorId) || `${pack}-operator`,
        ...(string(raw.operatorName) ? { displayName: string(raw.operatorName) } : {}),
        workspaceId: pack,
      },
    };
  }
  throw new Error(`unsupported inbound event kind: ${kind || "missing"}`);
}

export function verifyInbound(params: VerifyInboundParams): VerifyInboundResult {
  const headers = Object.fromEntries(
    Object.entries(params.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: signatureIsValid(
      headers["x-openneko-hud-signature"],
      params.body,
      requiredSecret(),
    ),
  };
}

export default definePlugin({
  name: "@open-neko/channel-hud",
  version: "0.1.0", // x-release-please-version
  capabilities: {
    channel: {
      providerLabel: "HUD surface",
      profile: HUD_PROFILE,
      directions: ["outbound", "inbound"],
      ingress: "webhook",
      deliver,
      parseInbound,
      verifyInbound,
    },
  },
});

import type { CapabilityProfile, InteractionEvent } from "@open-neko/plugin-types";

/**
 * WhatsApp projection: modality-free InteractionEvents → Cloud API text +
 * interactive reply buttons. Pure; branches only on the CapabilityProfile
 * (and the event kind). Approve/Reject ride the shared `verb:rest`
 * button-id convention the inbound parser decodes; the body clamps to
 * the profile's char budget (1024 on WhatsApp).
 */

export interface WhatsappButton {
  id: string;
  title: string;
}

export interface WhatsappProjectionResult {
  body: string;
  buttons?: WhatsappButton[];
}

const clampChars = (text: string, max?: number): string => {
  if (!max || text.length <= max) return text;
  if (max <= 1) return text.slice(0, Math.max(0, max));
  return `${text.slice(0, max - 1)}…`;
};

const firstSentence = (text: string): string => {
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match?.[0] ?? text).trim();
};

const summarizeBody = (body: string, fidelity: CapabilityProfile["fidelity"]): string => {
  if (fidelity === "full") return body;
  if (fidelity === "headline") return "";
  return firstSentence(body);
};

const askButtons = (event: Extract<InteractionEvent, { kind: "ask" }>): WhatsappButton[] => {
  if (event.ask === "choice" && event.options?.length) {
    return event.options.slice(0, 3).map((option) => ({
      id: `select:${event.decisionRef}:${option.id}`,
      title: option.label.slice(0, 20),
    }));
  }
  if (event.ask === "approval") {
    return [
      { id: `approve:${event.decisionRef}`, title: "Approve" },
      { id: `reject:${event.decisionRef}`, title: "Reject" },
    ];
  }
  return [];
};

/** Text + interactive reply buttons; charts/cards dropped; clamped to the char budget. */
export const projectWhatsapp = (
  events: InteractionEvent[],
  profile: CapabilityProfile,
): WhatsappProjectionResult => {
  const parts: string[] = [];
  let buttons: WhatsappButton[] | undefined;
  for (const event of events) {
    if (event.kind === "converse") {
      parts.push(event.text);
    } else if (event.kind === "inform") {
      const body = summarizeBody(event.body, profile.fidelity);
      const metric = event.metric ? `\n${event.metric.label}: ${event.metric.value}` : "";
      parts.push(`*${event.title}*${body ? `\n${body}` : ""}${metric}`);
    } else if (event.kind === "ask") {
      parts.push(event.prompt);
      if (!buttons && profile.interaction.quickReplies) buttons = askButtons(event);
    } else if (event.kind === "resolve") {
      const mark = event.status === "succeeded" ? "✅" : event.status === "rejected" ? "🚫" : "⚠️";
      parts.push(`${mark} ${event.summary}`);
    } else if (event.kind === "offer") {
      parts.push(`📎 ${event.label}`);
    }
  }
  const body = clampChars(parts.join("\n\n"), profile.constraints.maxOutboundChars);
  return buttons?.length ? { body, buttons } : { body };
};

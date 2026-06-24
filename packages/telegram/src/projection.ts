import type { CapabilityProfile, InteractionEvent } from "@open-neko/plugin-types";
import { escapeHtml, mdToTelegramHtml } from "./markdown.js";
import { renderSurface } from "./surface.js";

/**
 * Telegram projection: modality-free InteractionEvents → Telegram sendMessage
 * payloads. Pure; branches only on the CapabilityProfile (and the event kind),
 * never on channel identity. HTML parse mode (forgiving escaping vs MarkdownV2);
 * an `ask` becomes an inline keyboard whose callback_data carries the decision
 * ref in the shared `verb:rest` convention the inbound parser decodes.
 *
 * When an `inform` carries an A2UI surface (`enrichment.surfaces`), the full
 * rich answer (tables, callouts, metric cards, sections) is rendered via
 * `renderSurface`; otherwise we render the modality-free fields. Agent prose is
 * Markdown — `mdToTelegramHtml` converts the subset Telegram renders.
 */

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramMessage {
  text: string;
  parse_mode: "HTML";
  reply_markup?: { inline_keyboard: TelegramInlineButton[][] };
}

const MOOD_ICON: Record<string, string> = { good: "✅", watch: "👀", act: "🚨" };

const summarizeBody = (body: string, fidelity: CapabilityProfile["fidelity"]): string => {
  if (fidelity === "full") return body;
  const firstPara = body.split(/\n\n+/)[0] ?? body;
  if (fidelity === "summary") return firstPara;
  return firstPara.split(/(?<=[.!?])\s/)[0] ?? firstPara; // headline: first sentence
};

const clampChars = (text: string, max?: number): string => {
  if (max == null || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
};

const askButtons = (
  event: Extract<InteractionEvent, { kind: "ask" }>,
): TelegramInlineButton[][] => {
  if (event.ask === "choice" && event.options?.length) {
    return event.options
      .slice(0, 5)
      .map((o) => [{ text: o.label.slice(0, 64), callback_data: `select:${event.decisionRef}:${o.id}` }]);
  }
  if (event.ask === "approval") {
    return [
      [
        { text: "✅ Approve", callback_data: `approve:${event.decisionRef}` },
        { text: "🚫 Reject", callback_data: `reject:${event.decisionRef}` },
      ],
    ];
  }
  return [];
};

export const projectTelegram = (
  events: InteractionEvent[],
  profile: CapabilityProfile,
): TelegramMessage[] => {
  const parts: string[] = [];
  const followups: string[] = [];
  let keyboard: TelegramInlineButton[][] | undefined;

  for (const event of events) {
    switch (event.kind) {
      case "converse": {
        const surfaces = event.enrichment?.surfaces;
        if (surfaces && surfaces.length) {
          const rendered = renderSurface(surfaces, profile);
          if (rendered.html) parts.push(rendered.html);
          followups.push(...rendered.followups);
        } else {
          parts.push(mdToTelegramHtml(event.text));
        }
        break;
      }
      case "inform": {
        const surfaces = event.enrichment?.surfaces;
        if (surfaces && surfaces.length) {
          const rendered = renderSurface(surfaces, profile);
          if (rendered.html) parts.push(rendered.html);
          followups.push(...rendered.followups);
          break;
        }
        const icon = MOOD_ICON[event.mood] ?? "";
        const head = `${icon ? `${icon} ` : ""}<b>${escapeHtml(event.title)}</b>`;
        const body = summarizeBody(event.body, profile.fidelity);
        const metric = event.metric
          ? `\n<b>${escapeHtml(event.metric.label)}:</b> ${escapeHtml(event.metric.value)}`
          : "";
        parts.push(`${head}${body ? `\n${mdToTelegramHtml(body)}` : ""}${metric}`);
        break;
      }
      case "ask":
        parts.push(mdToTelegramHtml(event.prompt));
        if (!keyboard && profile.interaction.quickReplies) {
          const buttons = askButtons(event);
          if (buttons.length) keyboard = buttons;
        }
        break;
      case "resolve": {
        const mark =
          event.status === "succeeded" ? "✅" : event.status === "rejected" ? "🚫" : "⚠️";
        parts.push(`${mark} ${escapeHtml(event.summary)}`);
        break;
      }
      case "offer":
        parts.push(
          /^https?:\/\//.test(event.artifactRef)
            ? `📎 <a href="${escapeHtml(event.artifactRef)}">${escapeHtml(event.label)}</a>`
            : `📎 ${escapeHtml(event.label)}`,
        );
        break;
      // `progress` (tool start/end) isn't delivered as a message on an async push channel
    }
  }

  // A2UI Choice options become suggested follow-ups: Telegram callback_data
  // can't carry a full prompt, so we list them for the user to tap-and-send.
  if (followups.length) {
    const list = followups
      .slice(0, 6)
      .map((f) => `• ${escapeHtml(f)}`)
      .join("\n");
    parts.push(`💡 <b>Ask next</b>\n${list}`);
  }

  const text = clampChars(parts.filter(Boolean).join("\n\n"), profile.constraints.maxOutboundChars);
  if (!text) return [];
  const message: TelegramMessage = { text, parse_mode: "HTML" };
  if (keyboard) message.reply_markup = { inline_keyboard: keyboard };
  return [message];
};

import { describe, it, expect } from "vitest";
import type { InteractionEvent } from "@open-neko/plugin-types";
import { projectTelegram } from "../src/projection";
import { TELEGRAM_PROFILE } from "../src/plugin";

describe("projectTelegram", () => {
  it("renders an inform as HTML with mood icon, bold title, and metric", () => {
    const events: InteractionEvent[] = [
      {
        kind: "inform",
        id: "i1",
        mood: "act",
        title: "Revenue dropped",
        body: "Q3 is down 12%.\n\nDetails follow in the report.",
        metric: { label: "Q3 Revenue", value: "$1.2M" },
      },
    ];
    const msgs = projectTelegram(events, TELEGRAM_PROFILE);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0]!;
    expect(msg.parse_mode).toBe("HTML");
    expect(msg.text).toContain("🚨");
    expect(msg.text).toContain("<b>Revenue dropped</b>");
    expect(msg.text).toContain("<b>Q3 Revenue:</b> $1.2M");
    // summary fidelity keeps only the first paragraph
    expect(msg.text).toContain("Q3 is down 12%.");
    expect(msg.text).not.toContain("Details follow");
    expect(msg.reply_markup).toBeUndefined();
  });

  it("turns an approval ask into an inline keyboard with verb:ref callback_data", () => {
    const events: InteractionEvent[] = [
      { kind: "ask", id: "a1", ask: "approval", prompt: "Approve the refund?", decisionRef: "dr-123" },
    ];
    const msg = projectTelegram(events, TELEGRAM_PROFILE)[0]!;
    expect(msg.text).toContain("Approve the refund?");
    const row = msg.reply_markup?.inline_keyboard[0];
    expect(row?.map((b) => b.callback_data)).toEqual(["approve:dr-123", "reject:dr-123"]);
  });

  it("turns a choice ask into one select button per option", () => {
    const events: InteractionEvent[] = [
      {
        kind: "ask",
        id: "a2",
        ask: "choice",
        prompt: "Pick a tier",
        decisionRef: "dr-9",
        options: [
          { id: "a", label: "Gold" },
          { id: "b", label: "Silver" },
        ],
      },
    ];
    const kb = projectTelegram(events, TELEGRAM_PROFILE)[0]!.reply_markup?.inline_keyboard;
    expect(kb).toHaveLength(2);
    expect(kb?.[0]?.[0]?.callback_data).toBe("select:dr-9:a");
    expect(kb?.[1]?.[0]?.callback_data).toBe("select:dr-9:b");
  });

  it("escapes HTML metacharacters", () => {
    const events: InteractionEvent[] = [
      { kind: "converse", id: "c1", role: "assistant", text: "5 < 10 & rising > expected" },
    ];
    expect(projectTelegram(events, TELEGRAM_PROFILE)[0]!.text).toBe(
      "5 &lt; 10 &amp; rising &gt; expected",
    );
  });

  it("clamps to maxOutboundChars", () => {
    const events: InteractionEvent[] = [
      { kind: "converse", id: "c2", role: "assistant", text: "x".repeat(5000) },
    ];
    const text = projectTelegram(events, TELEGRAM_PROFILE)[0]!.text;
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.endsWith("…")).toBe(true);
  });

  it("drops progress events (not delivered on an async push channel)", () => {
    const events: InteractionEvent[] = [
      { kind: "progress", id: "p1", label: "thinking", phase: "start" },
    ];
    expect(projectTelegram(events, TELEGRAM_PROFILE)).toEqual([]);
  });

  it("combines an inform and its sibling ask into one message with a keyboard", () => {
    const events: InteractionEvent[] = [
      { kind: "inform", id: "i", mood: "watch", title: "Stock low", body: "SKU-1 below reorder." },
      { kind: "ask", id: "a", ask: "approval", prompt: "Reorder now?", decisionRef: "dr-1" },
    ];
    const msgs = projectTelegram(events, TELEGRAM_PROFILE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toContain("<b>Stock low</b>");
    expect(msgs[0]!.text).toContain("Reorder now?");
    expect(msgs[0]!.reply_markup?.inline_keyboard[0]?.[0]?.callback_data).toBe("approve:dr-1");
  });
});

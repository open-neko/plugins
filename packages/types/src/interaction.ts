/**
 * The Interaction Protocol — the modality-free waist between the agent loop
 * and any frontend. These are the event shapes carried opaquely by the channel
 * RPC (channel.ts `DeliverParams.events` / `ParseInboundResult.intents`); a
 * channel author imports them to write a typed projection / inbound parser.
 *
 * Pure types, no zod, no React, no transport. Mirror of the OpenNeko-internal
 * @neko/interaction package — keep the unions in sync with it.
 */

export type Mood = "good" | "watch" | "act";

export type RiskLevel = "low" | "medium" | "high";

export type AskKind = "approval" | "choice" | "freeform";

export type ResolveStatus = "succeeded" | "failed" | "rejected";

export type SeriesKind = "kpi" | "line" | "bar" | "area" | "donut";

export interface Metric {
  label: string;
  value: string;
}

export interface SeriesPoint {
  d: string;
  v: number;
  t?: number;
}

export interface Series {
  kind: SeriesKind;
  points: SeriesPoint[];
}

export interface Evidence {
  label: string;
  detail?: string;
  ref?: string;
}

export interface Freshness {
  observedAt: string;
}

export interface Choice {
  id: string;
  label: string;
}

/**
 * A surface message blob (A2UI v0.9 or any future structured payload).
 * Structural by design — the waist never imports a renderer's catalog.
 */
export type SurfaceMessage = { version: string; [key: string]: unknown };

/**
 * Optional, additive. A rich visual channel reads it; a thin or eyes-free
 * channel ignores it and is still guaranteed a complete experience from the
 * modality-free core of the event. Enrichment is never the payload.
 */
export interface RichEnrichment {
  surfaces?: SurfaceMessage[];
  imageUrl?: string;
}

/** Outbound: agent → human. */
export type InteractionEvent =
  | { kind: "converse"; id: string; role: "assistant"; text: string }
  | { kind: "progress"; id: string; label: string; phase: "start" | "end" }
  | {
      kind: "inform";
      id: string;
      mood: Mood;
      title: string;
      body: string;
      evidence?: Evidence[];
      metric?: Metric;
      series?: Series;
      freshness?: Freshness;
      enrichment?: RichEnrichment;
    }
  | {
      kind: "ask";
      id: string;
      ask: AskKind;
      prompt: string;
      decisionRef: string;
      options?: Choice[];
      risk?: RiskLevel;
    }
  | { kind: "resolve"; id: string; ref: string; status: ResolveStatus; summary: string }
  | { kind: "offer"; id: string; label: string; artifactRef: string; mime: string };

export type InteractionEventKind = InteractionEvent["kind"];

/**
 * Inbound: the mirror of InteractionEvent. A channel normalizes its native
 * input into one of these, and the worker feeds them to the same agent entry
 * points that already exist (utterance → chat turn, decision → action approve).
 */
export type IntentEvent =
  | { kind: "utterance"; threadRef?: string; text: string }
  | { kind: "decision"; decisionRef: string; choice: "approve" | "reject"; reason?: string }
  | { kind: "select"; ref: string; optionId: string }
  | { kind: "invoke"; command: string; args?: Record<string, unknown> };

export type IntentEventKind = IntentEvent["kind"];

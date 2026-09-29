/**
 * @open-neko/plugin-resend: operational email through Resend.
 *
 * Four actions:
 *   - send_email (ask)           : template, Markdown in the house layout, or HTML
 *   - list_email_templates (auto): published templates to pick from
 *   - get_email_template (auto)  : a template's subject and variable keys
 *   - get_email_status (auto)    : delivery status of a sent email
 *
 * The sender is fixed by RESEND_FROM. The host reads send_email's recipients
 * from to, cc, and bcc for approval rules; RESEND_ALLOWED_RECIPIENTS is an
 * optional last check that no rule can override.
 */

import {
  definePlugin,
  type PluginActionOutcome,
  type PluginActionRequest,
} from "@open-neko/plugin-types";
import { renderMarkdownEmail } from "./layout.js";
import { checkAllowedRecipients, recipientList } from "./recipients.js";
import { ResendClient } from "./resend-client.js";

export class ResendPluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResendPluginError";
  }
}

export interface InvokeOptions {
  createClient?: (apiKey: string) => ResendClient;
}

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function client(opts: InvokeOptions): ResendClient {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) {
    throw new ResendPluginError(
      "RESEND_API_KEY is not set. Run `openneko secrets set @open-neko/plugin-resend RESEND_API_KEY …`.",
    );
  }
  return opts.createClient ? opts.createClient(apiKey) : new ResendClient({ apiKey });
}

function payloadOf(request: PluginActionRequest): Record<string, unknown> {
  return (request.payload ?? {}) as Record<string, unknown>;
}

function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ResendPluginError(`${key} must be a string`);
  return value.trim() ? value : undefined;
}

function templateOf(payload: Record<string, unknown>): { id: string; variables?: Record<string, string | number> } | undefined {
  const raw = payload.template;
  if (raw === undefined || raw === null) return undefined;
  const id = typeof raw === "string" ? raw : typeof raw === "object" ? (raw as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || !id.trim()) {
    throw new ResendPluginError("template must be a template id or alias");
  }
  const vars = (typeof raw === "object" ? (raw as { variables?: unknown }).variables : undefined) ?? payload.variables;
  if (vars === undefined || vars === null) return { id: id.trim() };
  if (typeof vars !== "object" || Array.isArray(vars)) {
    throw new ResendPluginError("variables must be an object of variable key to value");
  }
  const variables: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "string" || typeof value === "number") variables[key] = value;
    else if (typeof value === "boolean") variables[key] = String(value);
    else throw new ResendPluginError(`variable ${key} must be a string or a number`);
  }
  return { id: id.trim(), variables };
}

export async function runSendEmail(request: PluginActionRequest, opts: InvokeOptions = {}): Promise<PluginActionOutcome> {
  const payload = payloadOf(request);
  const from = env("RESEND_FROM");
  if (!from) {
    throw new ResendPluginError("RESEND_FROM is not set. Set it to a sender on a domain you verified in Resend.");
  }

  const to = recipientList(payload.to, "to");
  const cc = recipientList(payload.cc, "cc");
  const bcc = recipientList(payload.bcc, "bcc");
  if (to.length === 0) throw new ResendPluginError("to needs at least one email address");
  checkAllowedRecipients([...to, ...cc, ...bcc], env("RESEND_ALLOWED_RECIPIENTS"));

  const template = templateOf(payload);
  const markdown = optionalString(payload, "markdown");
  const html = optionalString(payload, "html");
  const bodies = [template && "template", markdown && "markdown", html && "html"].filter(Boolean);
  if (bodies.length !== 1) {
    throw new ResendPluginError(
      `give exactly one body: template, markdown, or html (got ${bodies.length === 0 ? "none" : bodies.join(", ")})`,
    );
  }

  const subject = optionalString(payload, "subject");
  if (!subject && !template) throw new ResendPluginError("subject is required unless you send a template");

  const replyTo = recipientList(payload.replyTo ?? env("RESEND_REPLY_TO"), "replyTo");
  const rendered = markdown
    ? renderMarkdownEmail(markdown, {
        subject: subject!,
        ...(env("RESEND_LOGO_URL") ? { logoUrl: env("RESEND_LOGO_URL")! } : {}),
        ...(env("RESEND_BRAND_COLOR") ? { brandColor: env("RESEND_BRAND_COLOR")! } : {}),
        ...(env("RESEND_FOOTER_TEXT") ? { footerText: env("RESEND_FOOTER_TEXT")! } : {}),
      })
    : null;
  const text = optionalString(payload, "text");

  const sent = await client(opts).sendEmail({
    from,
    to,
    cc,
    bcc,
    replyTo,
    ...(subject ? { subject } : {}),
    ...(template ? { template } : {}),
    ...(rendered ? { html: rendered.html, text: rendered.text } : {}),
    ...(html ? { html, ...(text ? { text } : {}) } : {}),
    tags: [
      { name: "source", value: "openneko" },
      { name: "openneko_action", value: request.id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) },
    ],
    idempotencyKey: `openneko-action-${request.id}`,
  });

  const count = to.length + cc.length + bcc.length;
  return {
    result: { emailId: sent.id, to, cc, bcc, subject: subject ?? null, body: bodies[0] },
    externalRef: sent.id,
    commandOrOperation: `resend.send_email to ${count} recipient${count === 1 ? "" : "s"}`,
  };
}

export async function runListTemplates(request: PluginActionRequest, opts: InvokeOptions = {}): Promise<PluginActionOutcome> {
  const raw = payloadOf(request).limit;
  const limit = typeof raw === "number" && Number.isFinite(raw) ? Math.min(100, Math.max(1, Math.floor(raw))) : 20;
  const out = await client(opts).listTemplates(limit);
  const templates = out.data.map((t) => ({ id: t.id, alias: t.alias ?? null, name: t.name ?? null, status: t.status ?? null }));
  return {
    result: { templates, hasMore: out.has_more === true },
    externalRef: null,
    commandOrOperation: `resend.list_templates (${templates.length} returned)`,
  };
}

export async function runGetTemplate(request: PluginActionRequest, opts: InvokeOptions = {}): Promise<PluginActionOutcome> {
  const id = optionalString(payloadOf(request), "template");
  if (!id) throw new ResendPluginError("template (id or alias) is required");
  const t = await client(opts).getTemplate(id);
  return {
    result: {
      id: t.id,
      alias: t.alias ?? null,
      name: t.name ?? null,
      status: t.status ?? null,
      subject: t.subject ?? null,
      variables: (t.variables ?? []).map((v) => ({
        key: v.key,
        type: v.type ?? "string",
        ...(v.fallback_value !== undefined && v.fallback_value !== null ? { fallback: v.fallback_value } : {}),
      })),
    },
    externalRef: t.id,
    commandOrOperation: `resend.get_template ${t.alias ?? t.id}`,
  };
}

export async function runGetEmailStatus(request: PluginActionRequest, opts: InvokeOptions = {}): Promise<PluginActionOutcome> {
  const emailId = optionalString(payloadOf(request), "emailId");
  if (!emailId) throw new ResendPluginError("emailId is required");
  const email = await client(opts).getEmail(emailId);
  return {
    result: {
      emailId: email.id,
      status: email.last_event ?? null,
      to: email.to ?? [],
      subject: email.subject ?? null,
      createdAt: email.created_at ?? null,
    },
    externalRef: email.id,
    commandOrOperation: `resend.get_email ${email.id}`,
  };
}

export default definePlugin({
  name: "@open-neko/plugin-resend",
  version: "0.1.0", // x-release-please-version
  capabilities: {
    action: {
      kinds: [
        {
          kind: "send_email",
          description: "Send one email from a template, Markdown, or HTML.",
          handler: (req) => runSendEmail(req),
        },
        {
          kind: "list_email_templates",
          description: "List the Resend templates.",
          handler: (req) => runListTemplates(req),
        },
        {
          kind: "get_email_template",
          description: "Get a template's subject and variable keys.",
          handler: (req) => runGetTemplate(req),
        },
        {
          kind: "get_email_status",
          description: "Get the delivery status of a sent email.",
          handler: (req) => runGetEmailStatus(req),
        },
      ],
    },
  },
});

/**
 * Sign-in email delivery. Three interchangeable HTTPS providers —
 * Resend, Postmark, SendGrid — selected by which API-key env var is
 * set. The VM's egress allowlist covers exactly their API hosts.
 */

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailSender = (message: EmailMessage) => Promise<void>;

export interface ProviderEnv {
  resendApiKey?: string;
  postmarkServerToken?: string;
  sendgridApiKey?: string;
}

export function resolveProvider(env: ProviderEnv): {
  name: "resend" | "postmark" | "sendgrid";
  send: EmailSender;
} {
  const configured = [
    env.resendApiKey && ("resend" as const),
    env.postmarkServerToken && ("postmark" as const),
    env.sendgridApiKey && ("sendgrid" as const),
  ].filter((value): value is "resend" | "postmark" | "sendgrid" =>
    Boolean(value),
  );
  if (configured.length === 0) {
    throw new Error(
      "no email provider configured — set one of RESEND_API_KEY, POSTMARK_SERVER_TOKEN, or SENDGRID_API_KEY",
    );
  }
  if (configured.length > 1) {
    throw new Error(
      `multiple email providers configured (${configured.join(", ")}) — set exactly one API key`,
    );
  }
  if (env.resendApiKey) {
    return { name: "resend", send: resendSender(env.resendApiKey) };
  }
  if (env.postmarkServerToken) {
    return { name: "postmark", send: postmarkSender(env.postmarkServerToken) };
  }
  return { name: "sendgrid", send: sendgridSender(env.sendgridApiKey!) };
}

async function expectOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  // Provider errors can echo the recipient address; truncate and pass
  // through — this surfaces in worker logs only, never to the visitor
  // (the core masks manual-provisioning begin failures).
  throw new Error(
    `${provider} rejected the sign-in email (${res.status}): ${body.slice(0, 300)}`,
  );
}

function resendSender(apiKey: string): EmailSender {
  return async (message) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    await expectOk(res, "Resend");
  };
}

function postmarkSender(serverToken: string): EmailSender {
  return async (message) => {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": serverToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        From: message.from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
        MessageStream: "outbound",
      }),
    });
    await expectOk(res, "Postmark");
  };
}

function sendgridSender(apiKey: string): EmailSender {
  return async (message) => {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: parseFrom(message.from),
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
    });
    await expectOk(res, "SendGrid");
  };
}

/** "Name <addr@x>" → { name, email }; bare address → { email }. */
export function parseFrom(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  const email = match?.[2];
  if (match && email) {
    const name = (match[1] ?? "").replace(/^"|"$/g, "").trim();
    return name ? { email, name } : { email };
  }
  return { email: from.trim() };
}

export function buildSignInEmail(input: {
  from: string;
  to: string;
  link: string;
  ttlMinutes: number;
}): EmailMessage {
  const { to, link, ttlMinutes } = input;
  return {
    from: input.from,
    to,
    subject: "Your OpenNeko sign-in link",
    text: [
      `Sign in to OpenNeko:`,
      ``,
      link,
      ``,
      `The link works once, expires in ${ttlMinutes} minutes, and must be`,
      `opened in the same browser you requested it from.`,
      ``,
      `If you didn't request this, ignore this email — nobody can sign in`,
      `without it.`,
    ].join("\n"),
    html: [
      `<p>Sign in to OpenNeko:</p>`,
      `<p><a href="${escapeHtml(link)}">Sign in</a></p>`,
      `<p>Or paste this link into your browser:<br><code>${escapeHtml(link)}</code></p>`,
      `<p>The link works once, expires in ${ttlMinutes} minutes, and must be opened in the same browser you requested it from.</p>`,
      `<p>If you didn't request this, ignore this email — nobody can sign in without it.</p>`,
    ].join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

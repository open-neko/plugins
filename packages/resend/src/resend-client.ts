export class ResendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ResendError";
  }
}

export interface ResendClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface SendEmailRequest {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  subject?: string;
  html?: string;
  text?: string;
  template?: { id: string; variables?: Record<string, string | number> };
  tags?: Array<{ name: string; value: string }>;
  idempotencyKey: string;
}

export interface ResendEmail {
  id: string;
  to?: string[];
  subject?: string;
  created_at?: string;
  last_event?: string;
}

export interface ResendTemplateSummary {
  id: string;
  alias?: string | null;
  name?: string;
  status?: string;
}

export interface ResendTemplate extends ResendTemplateSummary {
  subject?: string | null;
  variables?: Array<{ key: string; type?: string; fallback_value?: unknown }>;
}

export class ResendClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResendClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.resend.com").replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "User-Agent": "openneko-plugin-resend",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await res.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const message =
        parsed && typeof parsed === "object" && typeof (parsed as { message?: unknown }).message === "string"
          ? (parsed as { message: string }).message
          : raw.slice(0, 300);
      throw new ResendError(`Resend ${method} ${path} failed (${res.status}): ${message}`, res.status);
    }
    return parsed as T;
  }

  sendEmail(input: SendEmailRequest): Promise<{ id: string }> {
    return this.request(
      "POST",
      "/emails",
      {
        from: input.from,
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        ...(input.bcc?.length ? { bcc: input.bcc } : {}),
        ...(input.replyTo?.length ? { reply_to: input.replyTo } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.template ? { template: input.template } : {}),
        ...(input.html !== undefined ? { html: input.html } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
      },
      { "Idempotency-Key": input.idempotencyKey },
    );
  }

  getEmail(id: string): Promise<ResendEmail> {
    return this.request("GET", `/emails/${encodeURIComponent(id)}`);
  }

  listTemplates(limit: number): Promise<{ data: ResendTemplateSummary[]; has_more?: boolean }> {
    return this.request("GET", `/templates?limit=${limit}`);
  }

  getTemplate(idOrAlias: string): Promise<ResendTemplate> {
    return this.request("GET", `/templates/${encodeURIComponent(idOrAlias)}`);
  }
}

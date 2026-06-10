/**
 * Minimal WhatsApp Cloud API client (Meta Graph). One POST per message;
 * Graph errors surface with the API's error message so the worker log
 * says what actually went wrong.
 */
export const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

export class WhatsappApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WhatsappApiError";
  }
}

export interface WhatsappClientOptions {
  token: string;
  phoneId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface WhatsappClient {
  sendMessage(payload: Record<string, unknown>): Promise<{ id?: string }>;
}

export function createWhatsappClient(options: WhatsappClientOptions): WhatsappClient {
  const base = options.baseUrl ?? GRAPH_API_BASE;
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async sendMessage(payload) {
      const res = await doFetch(`${base}/${options.phoneId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new WhatsappApiError(
          data.error?.message ?? `Graph API HTTP ${res.status}`,
          res.status,
        );
      }
      return { id: data.messages?.[0]?.id };
    },
  };
}

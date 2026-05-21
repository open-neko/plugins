/**
 * Thin HTTP wrapper for Shopify's Admin REST API. All network calls
 * go through `fetchImpl` for testability — the production runtime
 * uses globalThis.fetch; tests inject a stub.
 *
 * Shopify's API is per-store; the storeDomain in the config is the
 * canonical *.myshopify.com host (NOT the custom storefront domain
 * the operator may have configured for shoppers).
 *
 * Pinned API version: Shopify rotates quarterly. We default to
 * "2026-01" — operators can override via SHOPIFY_API_VERSION when
 * Shopify deprecates that version.
 */

export const DEFAULT_API_VERSION = "2026-01";

export interface ShopifyClientConfig {
  /** Canonical *.myshopify.com domain — no scheme. */
  storeDomain: string;
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

export interface ShopifyOrderSummary {
  id: number;
  name: string; // "#1234"
  order_number: number;
  email: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  created_at: string;
  updated_at: string;
  tags: string;
  note: string | null;
}

export interface ShopifyOrderDetail extends ShopifyOrderSummary {
  customer: { id: number; email: string | null; first_name: string | null; last_name: string | null } | null;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    sku: string | null;
    price: string;
  }>;
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  refunds: Array<Record<string, unknown>>;
}

export interface ListOrdersParams {
  /** ISO timestamp lower bound on created_at. */
  createdAtMin?: string;
  /** ISO timestamp upper bound on created_at. */
  createdAtMax?: string;
  /** "any" | "authorized" | "pending" | "paid" | "partially_paid" | "refunded" | "voided" | "partially_refunded" | "unpaid" */
  financialStatus?: string;
  /** "shipped" | "partial" | "unshipped" | "any" | "unfulfilled" */
  fulfillmentStatus?: string;
  /** 1-250 (Shopify max). Default 50. */
  limit?: number;
  /** "open" | "closed" | "cancelled" | "any". Default "open". */
  status?: string;
}

export interface UpdateOrderNoteParams {
  orderId: number;
  note: string;
  /** When true, append " — <note>" to the existing note instead of replacing. */
  append?: boolean;
  /** Optional tags to add (comma-joined). */
  addTags?: string[];
}

export class ShopifyClient {
  private readonly fetchImpl: typeof fetch;
  private readonly apiVersion: string;

  constructor(private readonly cfg: ShopifyClientConfig) {
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
    this.apiVersion = cfg.apiVersion ?? DEFAULT_API_VERSION;
  }

  private url(path: string): string {
    return `https://${this.cfg.storeDomain}/admin/api/${this.apiVersion}/${path}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "X-Shopify-Access-Token": this.cfg.accessToken,
      Accept: "application/json",
      ...extra,
    };
  }

  async listOrders(params: ListOrdersParams = {}): Promise<{ orders: ShopifyOrderSummary[] }> {
    const u = new URL(this.url("orders.json"));
    u.searchParams.set("limit", String(clampInt(params.limit ?? 50, 1, 250)));
    u.searchParams.set("status", params.status ?? "open");
    if (params.financialStatus) u.searchParams.set("financial_status", params.financialStatus);
    if (params.fulfillmentStatus) u.searchParams.set("fulfillment_status", params.fulfillmentStatus);
    if (params.createdAtMin) u.searchParams.set("created_at_min", params.createdAtMin);
    if (params.createdAtMax) u.searchParams.set("created_at_max", params.createdAtMax);
    const res = await this.fetchImpl(u.toString(), { headers: this.headers() });
    if (!res.ok) throw await shopifyError(res, "list_shopify_orders");
    return (await res.json()) as { orders: ShopifyOrderSummary[] };
  }

  async getOrder(orderId: number): Promise<{ order: ShopifyOrderDetail }> {
    const res = await this.fetchImpl(this.url(`orders/${orderId}.json`), {
      headers: this.headers(),
    });
    if (!res.ok) throw await shopifyError(res, "get_shopify_order");
    return (await res.json()) as { order: ShopifyOrderDetail };
  }

  /**
   * Append-or-replace the note + optionally add tags. Shopify's PUT
   * order endpoint is field-by-field PATCH semantics: only the keys
   * you pass change.
   */
  async updateOrderNote(params: UpdateOrderNoteParams): Promise<{ order: ShopifyOrderDetail }> {
    let nextNote = params.note;
    let nextTags: string | undefined;

    if (params.append || params.addTags?.length) {
      // Need the current state to append safely. Fetch once.
      const current = await this.getOrder(params.orderId);
      if (params.append) {
        const existing = current.order.note ?? "";
        nextNote = existing ? `${existing} — ${params.note}` : params.note;
      }
      if (params.addTags?.length) {
        const existingTags = (current.order.tags ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const merged = new Set<string>(existingTags);
        for (const t of params.addTags) merged.add(t);
        nextTags = [...merged].join(", ");
      }
    }

    const body: Record<string, unknown> = { id: params.orderId, note: nextNote };
    if (nextTags !== undefined) body.tags = nextTags;
    const res = await this.fetchImpl(this.url(`orders/${params.orderId}.json`), {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ order: body }),
    });
    if (!res.ok) throw await shopifyError(res, "update_shopify_order_note");
    return (await res.json()) as { order: ShopifyOrderDetail };
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

async function shopifyError(res: Response, action: string): Promise<Error> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  return new Error(`${action} failed (HTTP ${res.status}): ${body || res.statusText}`);
}

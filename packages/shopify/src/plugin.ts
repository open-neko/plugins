/**
 * @open-neko/plugin-shopify — Shopify Admin connector for OpenNeko.
 *
 * Three actions:
 *   - list_shopify_orders (auto)         — paginated order listing with filters
 *   - get_shopify_order (auto)           — full order detail
 *   - update_shopify_order_note (ask)    — set or append the internal note
 *
 * Auth: a static Admin API access token bound to one *.myshopify.com
 * store. Every operator on this OpenNeko deployment shares the same
 * token; the store the token belongs to is the only store the agent
 * can reach.
 */

import {
  definePlugin,
  type PluginActionOutcome,
  type PluginActionRequest,
} from "@open-neko/plugin-types";
import { ShopifyClient } from "./shopify-client.js";

export class ShopifyPluginError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "ShopifyPluginError";
  }
}

interface ResolvedEnv {
  storeDomain: string;
  accessToken: string;
  apiVersion?: string;
}

export interface InvokeOptions {
  createClient?: (env: ResolvedEnv) => ShopifyClient;
}

function resolveEnv(): ResolvedEnv {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const missing: string[] = [];
  if (!storeDomain) missing.push("SHOPIFY_STORE_DOMAIN");
  if (!accessToken) missing.push("SHOPIFY_ACCESS_TOKEN");
  if (missing.length > 0) {
    throw new ShopifyPluginError(
      `${missing.join(", ")} not set. Configure in your Shopify admin → Settings → Apps and sales channels → Develop apps, then \`openneko secrets set @open-neko/plugin-shopify ${missing[0]} …\`.`,
    );
  }
  // Strip an accidental https:// prefix the operator might paste.
  const trimmed = storeDomain!.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!trimmed.endsWith(".myshopify.com")) {
    throw new ShopifyPluginError(
      `SHOPIFY_STORE_DOMAIN must be the canonical *.myshopify.com host (got ${trimmed}). Use that even if you have a custom storefront domain — the Admin API only honors the myshopify.com one.`,
    );
  }
  return {
    storeDomain: trimmed,
    accessToken: accessToken!,
    ...(process.env.SHOPIFY_API_VERSION
      ? { apiVersion: process.env.SHOPIFY_API_VERSION }
      : {}),
  };
}

function clientOrDefault(opts: InvokeOptions): ShopifyClient {
  const env = resolveEnv();
  return (opts.createClient ??
    ((e: ResolvedEnv) =>
      new ShopifyClient({
        storeDomain: e.storeDomain,
        accessToken: e.accessToken,
        ...(e.apiVersion ? { apiVersion: e.apiVersion } : {}),
      })))(env);
}

function maybeString(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v ? v : undefined;
}

function maybeInt(payload: Record<string, unknown>, key: string): number | undefined {
  const v = payload[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export async function runListOrders(
  request: PluginActionRequest,
  opts: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const client = clientOrDefault(opts);
  const out = await client.listOrders({
    ...(maybeString(payload, "createdAtMin") !== undefined
      ? { createdAtMin: maybeString(payload, "createdAtMin")! }
      : {}),
    ...(maybeString(payload, "createdAtMax") !== undefined
      ? { createdAtMax: maybeString(payload, "createdAtMax")! }
      : {}),
    ...(maybeString(payload, "financialStatus") !== undefined
      ? { financialStatus: maybeString(payload, "financialStatus")! }
      : {}),
    ...(maybeString(payload, "fulfillmentStatus") !== undefined
      ? { fulfillmentStatus: maybeString(payload, "fulfillmentStatus")! }
      : {}),
    ...(maybeInt(payload, "limit") !== undefined
      ? { limit: maybeInt(payload, "limit")! }
      : {}),
    ...(maybeString(payload, "status") !== undefined
      ? { status: maybeString(payload, "status")! }
      : {}),
  });
  return {
    result: { orders: out.orders },
    externalRef: null,
    commandOrOperation: `shopify.list_orders (${out.orders.length} returned)`,
  };
}

export async function runGetOrder(
  request: PluginActionRequest,
  opts: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const orderId = maybeInt(payload, "orderId");
  if (orderId === undefined) {
    throw new ShopifyPluginError("orderId (number) is required");
  }
  const client = clientOrDefault(opts);
  const out = await client.getOrder(orderId);
  return {
    result: { order: out.order },
    externalRef: String(out.order.id),
    commandOrOperation: `shopify.get_order ${out.order.name}`,
  };
}

export async function runUpdateOrderNote(
  request: PluginActionRequest,
  opts: InvokeOptions = {},
): Promise<PluginActionOutcome> {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const orderId = maybeInt(payload, "orderId");
  const note = maybeString(payload, "note");
  if (orderId === undefined) {
    throw new ShopifyPluginError("orderId (number) is required");
  }
  if (note === undefined) {
    throw new ShopifyPluginError("note (string) is required");
  }
  const client = clientOrDefault(opts);
  const out = await client.updateOrderNote({
    orderId,
    note,
    append: payload.append === true,
    ...(Array.isArray(payload.addTags)
      ? {
          addTags: payload.addTags.filter(
            (t): t is string => typeof t === "string" && t.length > 0,
          ),
        }
      : {}),
  });
  return {
    result: { order: out.order },
    externalRef: String(out.order.id),
    commandOrOperation: `shopify.update_order_note ${out.order.name}`,
  };
}

export default definePlugin({
  name: "@open-neko/plugin-shopify",
  version: "0.1.0",
  capabilities: {
    action: {
      kinds: [
        {
          kind: "list_shopify_orders",
          description: "List recent orders, optionally filtered by status / date.",
          handler: (req) => runListOrders(req),
        },
        {
          kind: "get_shopify_order",
          description: "Fetch full detail for one order.",
          handler: (req) => runGetOrder(req),
        },
        {
          kind: "update_shopify_order_note",
          description: "Set or append the internal note on an order.",
          handler: (req) => runUpdateOrderNote(req),
        },
      ],
    },
  },
});

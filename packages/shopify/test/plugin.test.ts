import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ShopifyPluginError,
  runGetOrder,
  runListOrders,
  runUpdateOrderNote,
} from "../src/plugin";
import { ShopifyClient } from "../src/shopify-client";

function setEnv(): void {
  process.env.SHOPIFY_STORE_DOMAIN = "acme.myshopify.com";
  process.env.SHOPIFY_ACCESS_TOKEN = "shpat_test_token";
  delete process.env.SHOPIFY_API_VERSION;
}

beforeEach(() => {
  setEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ACCESS_TOKEN;
  delete process.env.SHOPIFY_API_VERSION;
});

function fakeFetch(
  fn: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(fn(url, init));
  }) as typeof fetch;
}

function makeClient(fn: Parameters<typeof fakeFetch>[0], apiVersion?: string): ShopifyClient {
  return new ShopifyClient({
    storeDomain: "acme.myshopify.com",
    accessToken: "shpat_test_token",
    ...(apiVersion ? { apiVersion } : {}),
    fetchImpl: fakeFetch(fn),
  });
}

function req(kind: string, payload: Record<string, unknown>) {
  return {
    id: `req-${kind}`,
    orgId: "org-1",
    scope: "external" as const,
    kind,
    target: null,
    summary: kind,
    payload,
    riskLevel: "low" as const,
  };
}

describe("env validation", () => {
  it("throws clearly when SHOPIFY_STORE_DOMAIN is missing", async () => {
    delete process.env.SHOPIFY_STORE_DOMAIN;
    await expect(runListOrders(req("list_shopify_orders", {}))).rejects.toThrow(
      /SHOPIFY_STORE_DOMAIN/,
    );
  });

  it("throws when domain isn't *.myshopify.com", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "acme.com"; // custom storefront, not allowed
    await expect(runListOrders(req("list_shopify_orders", {}))).rejects.toThrow(
      /myshopify\.com/,
    );
  });

  it("strips https:// prefix the operator might paste", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "https://acme.myshopify.com/";
    let observedHost = "";
    await runListOrders(req("list_shopify_orders", {}), {
      createClient: () =>
        makeClient((url) => {
          observedHost = new URL(url).host;
          return new Response(JSON.stringify({ orders: [] }), { status: 200 });
        }),
    });
    expect(observedHost).toBe("acme.myshopify.com");
  });
});

describe("runListOrders", () => {
  it("hits the orders endpoint with default status=open and limit=50", async () => {
    let observedURL = "";
    let observedAuth = "";
    const out = await runListOrders(req("list_shopify_orders", {}), {
      createClient: () =>
        makeClient((url, init) => {
          observedURL = url;
          observedAuth =
            (init?.headers as Record<string, string>)["X-Shopify-Access-Token"] ?? "";
          return new Response(
            JSON.stringify({
              orders: [
                {
                  id: 1,
                  name: "#1001",
                  order_number: 1001,
                  email: "x@y.com",
                  financial_status: "paid",
                  fulfillment_status: null,
                  total_price: "42.00",
                  currency: "USD",
                  created_at: "2026-05-21T10:00:00Z",
                  updated_at: "2026-05-21T10:00:00Z",
                  tags: "",
                  note: null,
                },
              ],
            }),
            { status: 200 },
          );
        }),
    });
    const url = new URL(observedURL);
    expect(url.pathname).toContain("/admin/api/");
    expect(url.pathname).toContain("/orders.json");
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(observedAuth).toBe("shpat_test_token");
    expect((out.result as { orders: unknown[] }).orders).toHaveLength(1);
  });

  it("forwards filter params (financial_status, fulfillment_status, date range)", async () => {
    let observedURL = "";
    await runListOrders(
      req("list_shopify_orders", {
        financialStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        createdAtMin: "2026-05-21T00:00:00Z",
        createdAtMax: "2026-05-22T00:00:00Z",
        limit: 25,
        status: "any",
      }),
      {
        createClient: () =>
          makeClient((url) => {
            observedURL = url;
            return new Response(JSON.stringify({ orders: [] }), { status: 200 });
          }),
      },
    );
    const u = new URL(observedURL);
    expect(u.searchParams.get("financial_status")).toBe("paid");
    expect(u.searchParams.get("fulfillment_status")).toBe("unfulfilled");
    expect(u.searchParams.get("created_at_min")).toBe("2026-05-21T00:00:00Z");
    expect(u.searchParams.get("created_at_max")).toBe("2026-05-22T00:00:00Z");
    expect(u.searchParams.get("limit")).toBe("25");
    expect(u.searchParams.get("status")).toBe("any");
  });

  it("clamps limit to the 1-250 range", async () => {
    let observed = 0;
    await runListOrders(req("list_shopify_orders", { limit: 9999 }), {
      createClient: () =>
        makeClient((url) => {
          observed = Number(new URL(url).searchParams.get("limit"));
          return new Response(JSON.stringify({ orders: [] }), { status: 200 });
        }),
    });
    expect(observed).toBe(250);
  });

  it("surfaces Shopify error bodies on non-2xx", async () => {
    await expect(
      runListOrders(req("list_shopify_orders", {}), {
        createClient: () =>
          makeClient(
            () =>
              new Response(JSON.stringify({ errors: "[API] Invalid API key" }), {
                status: 401,
              }),
          ),
      }),
    ).rejects.toThrow(/list_shopify_orders.*HTTP 401.*Invalid API key/s);
  });
});

describe("runGetOrder", () => {
  it("hits orders/<id>.json and returns the order detail", async () => {
    let observedPath = "";
    const out = await runGetOrder(req("get_shopify_order", { orderId: 12345 }), {
      createClient: () =>
        makeClient((url) => {
          observedPath = new URL(url).pathname;
          return new Response(
            JSON.stringify({
              order: {
                id: 12345,
                name: "#9999",
                order_number: 9999,
                email: "ceo@example.com",
                financial_status: "paid",
                fulfillment_status: "shipped",
                total_price: "199.00",
                currency: "USD",
                created_at: "2026-05-21T10:00:00Z",
                updated_at: "2026-05-21T10:00:00Z",
                tags: "vip",
                note: null,
                customer: { id: 1, email: "ceo@example.com", first_name: null, last_name: null },
                line_items: [],
                shipping_address: null,
                billing_address: null,
                refunds: [],
              },
            }),
            { status: 200 },
          );
        }),
    });
    expect(observedPath).toContain("/orders/12345.json");
    const result = out.result as { order: { id: number; name: string } };
    expect(result.order.id).toBe(12345);
    expect(result.order.name).toBe("#9999");
    expect(out.externalRef).toBe("12345");
  });

  it("rejects when orderId is missing", async () => {
    await expect(
      runGetOrder(req("get_shopify_order", {})),
    ).rejects.toThrow(/orderId/);
  });
});

describe("runUpdateOrderNote", () => {
  it("replaces the note when append is not set", async () => {
    let putBody: Record<string, unknown> | null = null;
    await runUpdateOrderNote(
      req("update_shopify_order_note", {
        orderId: 123,
        note: "New note.",
      }),
      {
        createClient: () =>
          makeClient((url, init) => {
            if (init?.method === "PUT") {
              putBody = JSON.parse(init.body as string) as Record<string, unknown>;
              return new Response(
                JSON.stringify({
                  order: shopifyOrderFixture(123, { note: "New note.", tags: "" }),
                }),
                { status: 200 },
              );
            }
            return new Response("", { status: 405 });
          }),
      },
    );
    expect(putBody).not.toBeNull();
    const order = (putBody as { order: { note: string; tags?: string } }).order;
    expect(order.note).toBe("New note.");
    expect(order.tags).toBeUndefined();
  });

  it("appends to existing note when append=true", async () => {
    let putBody: Record<string, unknown> | null = null;
    await runUpdateOrderNote(
      req("update_shopify_order_note", {
        orderId: 123,
        note: "More context.",
        append: true,
      }),
      {
        createClient: () =>
          makeClient((url, init) => {
            // GET fetches current state so the append can read the
            // existing note + tags.
            if (!init || init.method !== "PUT") {
              return new Response(
                JSON.stringify({
                  order: shopifyOrderFixture(123, {
                    note: "Existing note.",
                    tags: "vip",
                  }),
                }),
                { status: 200 },
              );
            }
            putBody = JSON.parse(init.body as string) as Record<string, unknown>;
            return new Response(
              JSON.stringify({
                order: shopifyOrderFixture(123, {
                  note: "Existing note. — More context.",
                  tags: "vip",
                }),
              }),
              { status: 200 },
            );
          }),
      },
    );
    const order = (putBody as { order: { note: string } }).order;
    expect(order.note).toBe("Existing note. — More context.");
  });

  it("merges addTags with existing tags, de-duplicating", async () => {
    let putBody: Record<string, unknown> | null = null;
    await runUpdateOrderNote(
      req("update_shopify_order_note", {
        orderId: 123,
        note: "ok",
        addTags: ["priority", "vip"], // vip already present
      }),
      {
        createClient: () =>
          makeClient((url, init) => {
            if (!init || init.method !== "PUT") {
              return new Response(
                JSON.stringify({
                  order: shopifyOrderFixture(123, { note: null, tags: "vip, paid" }),
                }),
                { status: 200 },
              );
            }
            putBody = JSON.parse(init.body as string) as Record<string, unknown>;
            return new Response(
              JSON.stringify({
                order: shopifyOrderFixture(123, {
                  note: "ok",
                  tags: "vip, paid, priority",
                }),
              }),
              { status: 200 },
            );
          }),
      },
    );
    const order = (putBody as { order: { tags: string } }).order;
    const tags = order.tags.split(",").map((s) => s.trim());
    expect(new Set(tags)).toEqual(new Set(["vip", "paid", "priority"]));
  });

  it("rejects missing note or orderId", async () => {
    await expect(
      runUpdateOrderNote(req("update_shopify_order_note", { orderId: 1 })),
    ).rejects.toThrow(/note/);
    await expect(
      runUpdateOrderNote(req("update_shopify_order_note", { note: "x" })),
    ).rejects.toThrow(/orderId/);
  });
});

describe("ShopifyPluginError", () => {
  it("carries the expected name", () => {
    const err = new ShopifyPluginError("test");
    expect(err.name).toBe("ShopifyPluginError");
  });
});

// ─── helpers ────────────────────────────────────────────────────────

function shopifyOrderFixture(
  id: number,
  overrides: Partial<{
    note: string | null;
    tags: string;
    name: string;
  }> = {},
): Record<string, unknown> {
  return {
    id,
    name: overrides.name ?? `#${id}`,
    order_number: id,
    email: "x@y.com",
    financial_status: "paid",
    fulfillment_status: null,
    total_price: "42.00",
    currency: "USD",
    created_at: "2026-05-21T10:00:00Z",
    updated_at: "2026-05-21T10:00:00Z",
    tags: overrides.tags ?? "",
    note: overrides.note ?? null,
    customer: null,
    line_items: [],
    shipping_address: null,
    billing_address: null,
    refunds: [],
  };
}

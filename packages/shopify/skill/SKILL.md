---
name: shopify
description: Patterns for the @open-neko/plugin-shopify actions — when to use list_shopify_orders vs get_shopify_order, how to filter for a specific operations question, and how to log internal context via update_shopify_order_note. Use whenever the operator's question is about orders flowing through their Shopify store (revenue checks, fulfillment status, customer service follow-ups, ops tagging). Assumes SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN are configured.
license: Apache-2.0
metadata:
  authoredBy: open-neko
  pairsWith: "@open-neko/plugin-shopify"
---

# Shopify patterns

Shopify is OpenNeko's reference ecommerce connector. Most operator
questions fall into one of three shapes:

| Operator says | Right action | Why |
|---|---|---|
| "What's happened in the last hour?" | `list_shopify_orders` with `createdAtMin` set to T-1h | Bounded read, server-side filter |
| "Pull up order #1234" | `get_shopify_order` with the parsed number | Single-record fetch, full detail |
| "Mark this order as 'priority shipping' and tell ops we noticed" | `update_shopify_order_note` with `append: true` and `addTags: ["priority"]` | One write, preserves prior state |

## Identifying an order from operator input

Operators usually paste either:

- `#1234` — Shopify's display name. The numeric part after `#` is
  `order_number`, NOT `id`. The plugin's actions need `id` (the
  internal numeric identifier).
- `https://acme.myshopify.com/admin/orders/4567890123456` — the
  number in the URL IS `id`. Use it directly.
- A bare integer the operator says is "order 4567890123456" — same.

If the operator gives you `#1234`, run a `list_shopify_orders` with
no filter and `limit: 50`, then match against `order_number`. Don't
guess.

## `list_shopify_orders` patterns

### Filter server-side, always

Default `status: "open"` keeps you off completed/archived orders.
Override only when the operator's question explicitly includes
them ("how many cancellations did we get yesterday?" → `status:
"cancelled"`).

Three commonly useful filter combos:

- **"What's stuck?"** → `fulfillmentStatus: "unfulfilled"`, `financialStatus: "paid"`
- **"What needs payment chasing?"** → `financialStatus: "pending"`
- **"What landed today?"** → `createdAtMin` set to today's midnight in the store's timezone

### Page size

Default 50; cap at 250 (Shopify's max per call). Bigger pages are
slower and ALL of the payload comes through the agent's context. For
"show me the last 10" requests, set `limit: 10`.

### Time zones matter

Shopify returns ISO timestamps in UTC. The operator usually thinks
in their own timezone. If the question is "what happened today?",
the agent should convert the operator's local "today" to a UTC
ISO range before passing to `createdAtMin`/`createdAtMax`. Don't
ask Shopify to filter on a calendar day in the wrong timezone.

## `update_shopify_order_note` patterns

This is the only write action in this plugin, and it's deliberately
low-blast-radius: the `note` field is operator-visible inside the
Shopify admin only, never customer-facing.

### Always prefer `append: true` for ops logging

```
note: "OpenNeko revenue-drop watcher pinged @amit at 14:03"
append: true
```

Operators rely on the note as a running log. Replacing it wipes
their history. The only time to omit `append` is when the operator
explicitly says "replace the note with…".

### Pair with tags for filterable ops state

```
addTags: ["needs-review", "noticed-by-openneko"]
```

Tags ARE searchable in Shopify admin's order list, notes aren't.
Adding a tag like `"noticed-by-openneko"` lets the operator pull
"show me everything OpenNeko flagged this week" later.

## Failure modes the operator should see

- **`401 Unauthorized`** — `SHOPIFY_ACCESS_TOKEN` expired or scope
  insufficient. Prompt the operator to regenerate the token with
  read_orders + write_orders.
- **`404 Not Found`** on an order id — usually the operator gave you
  the `order_number` (#1234) instead of the `id`. Re-run `list` to
  resolve.
- **`429 Too Many Requests`** — Shopify rate limits per app per
  store (2 req/sec leaky bucket on REST). Back off; if the operator
  is waiting, surface the Retry-After header so they know how long.
- **`Invalid SHOPIFY_STORE_DOMAIN`** — the plugin rejects domains
  that aren't `*.myshopify.com`. Custom storefront domains don't
  work on the Admin API.

## What this skill is NOT for

- Storefront product browsing — that's the public Storefront API,
  a different scope set, and this connector doesn't enable it.
- Customer-facing email — Shopify can send transactional emails;
  this connector doesn't trigger them. Use the operator's
  email/Gmail connector for that.
- Bulk migrations — Shopify's REST API caps you at ~2 req/sec.
  For >1000 changes, point the operator at Shopify's bulk operations
  GraphQL endpoint, not this plugin.

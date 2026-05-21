# @open-neko/plugin-shopify

Shopify Admin connector for OpenNeko. List orders, fetch order
detail, and stamp internal notes against your `*.myshopify.com`
store. Network egress is sandbox-restricted to your store's
canonical domain — no other host is reachable from this plugin's
microVM, even if instructed.

## Setup

1. **In Shopify admin** → **Settings** → **Apps and sales channels**
   → **Develop apps** → **Create an app**.
2. **Configuration** → **Admin API access scopes**: enable
   `read_orders` and `write_orders` (the latter is only needed if
   you want to use `update_shopify_order_note`).
3. **Install app**, then copy the Admin API access token shown ONCE
   on the next screen (starts with `shpat_`).
4. Install the connector:
   ```sh
   openneko install @open-neko/plugin-shopify
   ```
   The CLI prompts for:
   - `SHOPIFY_STORE_DOMAIN` — your `*.myshopify.com` host (e.g.
     `acme.myshopify.com`). Use the canonical Shopify subdomain,
     not the custom storefront domain you may have configured.
   - `SHOPIFY_ACCESS_TOKEN` — the `shpat_...` token from step 3.
   - `SHOPIFY_API_VERSION` (optional) — defaults to `2026-01`. Pin
     to a stable version so Shopify's quarterly rotations don't
     surprise you.

## Actions

| Action | Default mode | Notes |
|---|---|---|
| `list_shopify_orders` | `auto` | Filters: `status`, `financialStatus`, `fulfillmentStatus`, `createdAtMin`/`Max`, `limit` (1-250). |
| `get_shopify_order` | `auto` | One order detail by `id` (not `order_number`). |
| `update_shopify_order_note` | `ask` | Set/append the internal note, optionally add tags. Internal-only — never customer-visible. |

## Auth model

Static deployment-wide token. Every operator on this OpenNeko
deployment shares the same Shopify token, which is bound to one
store. If you need multiple stores or per-operator scoping, install
the connector per-deployment (one OpenNeko per store), or wait for
a future OAuth-based variant.

## Sandbox

Network egress restricted to `*.myshopify.com`. The microsandbox
VM enforces this — the plugin cannot reach any other host even if
instructed.

## License

Apache-2.0.

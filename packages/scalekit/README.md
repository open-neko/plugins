# @open-neko/plugin-scalekit

Scalekit SSO + workspace management for [OpenNeko](https://github.com/open-neko/neko). One plugin, four capabilities:

- **`auth`** — OpenNeko's generic OIDC sign-in contract over [Scalekit](https://www.scalekit.com)'s hosted gateway, which fronts Okta, Entra ID, Google Workspace, JumpCloud, Ping, and the rest of the enterprise IdP stack behind one integration.
- **`connect`** — deployment-scoped OAuth consent against Scalekit's workspace MCP server (`https://mcp.scalekit.com/`). One admin consents once; the token bundle lives in OpenNeko's encrypted vault and is refreshed forever.
- **`directory`** — reads the SCIM directory of one Scalekit organization: users, groups and group memberships. OpenNeko syncs it every 6 hours and applies its IdP group rules. It can also create an organization user.
- **`action`** — 35 workspace-management tools surfaced to the OpenNeko agent: environments, organizations, users, connections, roles/scopes, redirect URIs, MCP server registration, and admin portal links.

Install once, get the entire enterprise identity ecosystem — and never visit the Scalekit dashboard again after setup.

## Install

```sh
# From the official OpenNeko marketplace (verified integrity hash):
openneko install @open-neko/plugin-scalekit

# Or, bypassing every marketplace (e.g. while testing a local build):
openneko install @open-neko/plugin-scalekit --unverified
```

The CLI prompts for three sign-in values (`SCALEKIT_ENVIRONMENT_URL`, `SCALEKIT_CLIENT_ID`, `SCALEKIT_CLIENT_SECRET`) and stores them in the per-user secrets file at `~/.config/openneko/secrets.json` (0600 perms). The worker injects them into the plugin's VM at exec time — the secret never lands in `openneko.plugins.json` or anywhere else tracked by git.

Optional env:

- `SCALEKIT_MCP_URL` — Scalekit MCP server URL for workspace management. Defaults to the hosted `https://mcp.scalekit.com/`.
- `SCALEKIT_ORGANIZATION_ID` — the organization whose directory OpenNeko syncs, for example `org_123`. Directory sync needs it. Step 2 on the SSO settings page sets it when you select the environment.

Rotate any value later with:

```sh
openneko secrets set @open-neko/plugin-scalekit SCALEKIT_CLIENT_SECRET
```

## Connect the Scalekit workspace

Open **Admin → Settings → Single sign-on** (`/admin/settings/sso`). The page is a 4-step checklist — each step turns green ✓ once done:

1. **Authorize the Scalekit workspace** — opens a browser consent screen (which names the scopes and the endpoint). Signing in creates the Scalekit account if one doesn't exist, and every workspace gets a **Dev** and a **Prod** environment automatically at creation. The access + refresh tokens land in the encrypted vault under a deployment-level slot; the agent uses them for every workspace tool regardless of which operator triggers the call, and they are refreshed transparently.
2. **Select the environment** — the list loads from your workspace (no id pasting); **Dev** is the default (free trial).
3. **Sign-in credentials** — **Auto-fill from Scalekit** fetches the environment URL + client id via the agent. Paste `SCALEKIT_CLIENT_SECRET` **once** (shown only once in the dashboard — the page links you straight to it) and the gate flips on: sign in at `/signin` and the first user becomes the admin.
4. **Connect the identity provider** (optional for the trial) — `generate_admin_portal_link` hands you a guided portal where you configure your IdP (Okta/Entra/…) — the one step nothing on our side can automate. The agent polls `list_organization_connections` until the connection is `COMPLETED`, then reports SSO live.

Going to production later: use **Change** on step 2, pick **Prod**, paste the Prod secret once, and repeat the portal-link step. Environments are isolated — nothing carries over automatically.

## Directory sync

Complete steps 1 to 3 on the SSO settings page, so the organization and sign-in credentials are set. Then open **Admin → Users → IdP rules** and select **Sync now**.

- The plugin gets a client-credentials token and reads each enabled directory of the organization.
- A group's key is its display name. Sign-in claims carry group names, so one IdP group rule matches both sign-in and sync. Renaming a group in the IdP creates a new IdP group in OpenNeko; update the rule after a rename.
- The plugin does not deactivate users. The identity provider owns user status, and sync marks users that SCIM reports as inactive.

## How the auth flow works

OpenNeko's web app and this plugin implement a standard OIDC authorization-code flow:

1. User clicks **Sign in with Scalekit** on `/signin`.
2. OpenNeko mints a CSRF token, calls `begin_auth` on the plugin, gets back a Scalekit `/oauth/authorize` URL, and redirects the browser.
3. Scalekit routes to the right downstream IdP (Okta / Entra / etc.) using `login_hint` if supplied.

## What data reaches Scalekit

The workspace tools talk to `mcp.scalekit.com` (Scalekit's own service): MCP protocol traffic, tool arguments (your Scalekit workspace configuration — data Scalekit already holds), and the OAuth access token. OpenNeko business data, sessions, and other plugin secrets never leave the sandbox; the plugin's egress is locked to `*.scalekit.com` and `*.scalekit.dev` (development environments).

## Development

```sh
pnpm install
pnpm build       # tsc + esbuild → dist/run.js
pnpm test        # vitest
```

The bundled runner is self-contained (the MCP SDK is bundled in) and executes in the plugin sandbox with no `node_modules` access.

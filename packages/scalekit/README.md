# @open-neko/plugin-scalekit

Scalekit SSO + workspace management for [OpenNeko](https://github.com/open-neko/neko). One plugin, three capabilities:

- **`auth`** — OpenNeko's generic OIDC sign-in contract over [Scalekit](https://www.scalekit.com)'s hosted gateway, which fronts Okta, Entra ID, Google Workspace, JumpCloud, Ping, and the rest of the enterprise IdP stack behind one integration.
- **`connect`** — deployment-scoped OAuth consent against Scalekit's workspace MCP server (`https://mcp.scalekit.com/`). One admin consents once; the token bundle lives in OpenNeko's encrypted vault and is refreshed forever.
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

Rotate any value later with:

```sh
openneko secrets set @open-neko/plugin-scalekit SCALEKIT_CLIENT_SECRET
```

## Connect the Scalekit workspace

On the **Integrations** page, click **Connect** under "Scalekit workspace". This opens a browser consent screen (which names the scopes and the endpoint). Signing in creates the Scalekit account if one doesn't exist — and every workspace gets a **Dev** and a **Prod** environment automatically at creation.

The access + refresh tokens are stored in the encrypted vault under a deployment-level slot; the agent uses them for every workspace tool regardless of which operator triggers the call, and they are refreshed transparently.

## SSO setup (Dev by default)

1. The agent picks the **Dev** environment by default (free; Prod is opt-in when you go live). It fetches `SCALEKIT_ENVIRONMENT_URL` and `SCALEKIT_CLIENT_ID` automatically via `get_environment_credentials`.
2. You paste `SCALEKIT_CLIENT_SECRET` **once** — it is shown only once in the Scalekit dashboard (**API Credentials**) and is intentionally not retrievable via any API.
3. The agent calls `generate_admin_portal_link` and hands you the link. You configure your IdP (Okta/Entra/…) in the guided portal — the one step nothing on our side can automate.
4. The agent polls `list_organization_connections` until the connection is `COMPLETED`, then reports SSO live.

Going to production later: switch the environment to **Prod**, paste the Prod secret once, and repeat the portal-link step. Environments are isolated — nothing carries over automatically.

## How the auth flow works

OpenNeko's web app and this plugin implement a standard OIDC authorization-code flow:

1. User clicks **Sign in with Scalekit** on `/signin`.
2. OpenNeko mints a CSRF token, calls `begin_auth` on the plugin, gets back a Scalekit `/oauth/authorize` URL, and redirects the browser.
3. Scalekit routes to the right downstream IdP (Okta / Entra / etc.) using `login_hint` if supplied.

## What data reaches Scalekit

The workspace tools talk to `mcp.scalekit.com` (Scalekit's own service): MCP protocol traffic, tool arguments (your Scalekit workspace configuration — data Scalekit already holds), and the OAuth access token. OpenNeko business data, sessions, and other plugin secrets never leave the sandbox; the plugin's egress is locked to `*.scalekit.com`.

## Development

```sh
pnpm install
pnpm build       # tsc + esbuild → dist/run.js
pnpm test        # vitest
```

The bundled runner is self-contained (the MCP SDK is bundled in) and executes in the plugin sandbox with no `node_modules` access.

# @open-neko/plugin-scalekit

Scalekit SSO provider for [OpenNeko](https://github.com/open-neko/neko). Implements OpenNeko's generic OIDC auth contract over [Scalekit](https://www.scalekit.com)'s hosted gateway, which fronts Okta, Entra ID, Google Workspace, JumpCloud, Ping, and the rest of the enterprise IdP stack behind one integration.

Install once, get the entire enterprise identity ecosystem.

## Install

```sh
# From the official OpenNeko marketplace (verified integrity hash):
openneko install @open-neko/plugin-scalekit

# Or, bypassing every marketplace (e.g. while testing a local build):
openneko install @open-neko/plugin-scalekit --unverified
```

During install the CLI prompts for three values (`SCALEKIT_ENVIRONMENT_URL`, `SCALEKIT_CLIENT_ID`, `SCALEKIT_CLIENT_SECRET`) and stores them in the per-user secrets file at `~/.config/openneko/secrets.json` (0600 perms). The worker injects them into the plugin's VM at exec time — the secret never lands in `openneko.plugins.json` or anywhere else tracked by git.

Rotate any of them later with:

```sh
openneko secrets set @open-neko/plugin-scalekit SCALEKIT_CLIENT_SECRET
```

## Scalekit setup

1. Create a Scalekit account at <https://www.scalekit.com>. Copy your **environment URL** from the API config screen — looks like `https://your-app.scalekit.com`.
2. Under **Applications → New**, register OpenNeko as an app. Set the **Redirect URI** to your OpenNeko deployment's callback: `https://<your-openneko-host>/api/auth/callback`.
3. Copy the issued **Client ID** and **Client Secret**.
4. Connect at least one IdP (Okta, Entra, Google Workspace, …) to the application from Scalekit's **Connections** screen. Scalekit handles the per-IdP wiring.

That's it — every IdP you ever connect in Scalekit lights up in OpenNeko without code changes.

## How the auth flow works

OpenNeko's web app and this plugin implement a standard OIDC authorization-code flow:

1. User clicks **Sign in with Scalekit** on `/signin`.
2. OpenNeko mints a CSRF token, calls `begin_auth` on the plugin, gets back a Scalekit `/oauth/authorize` URL, and redirects the browser.
3. Scalekit routes to the right downstream IdP (Okta / Entra / etc.) using `login_hint` if supplied.
4. The IdP authenticates the user and bounces back to `/api/auth/callback` with a `code`.
5. OpenNeko verifies the CSRF token, calls `complete_auth`, which exchanges the code for tokens at `/oauth/token` and fetches the user profile from `/userinfo`.
6. OpenNeko upserts the user in `app_user`, sets a session cookie, and redirects to the dashboard.

The plugin only ever sees Scalekit URLs. The plugin **never** sees OpenNeko's session cookie or app DB.

## Capabilities (manifest)

```yaml
network:
  - "*.scalekit.com"
env:
  - SCALEKIT_ENVIRONMENT_URL   # required, not secret (it's the public env URL)
  - SCALEKIT_CLIENT_ID         # required, not secret
  - SCALEKIT_CLIENT_SECRET     # required, secret
provides_auth: true
```

The OpenNeko plugin loader translates `network` into the microsandbox VM's egress policy. Any attempt to reach a non-Scalekit host is blocked at the VM boundary.

## Identity mapping

The plugin's `complete_auth` returns an `AuthIdentity` object with the following fields, derived from Scalekit's `/userinfo` claims:

| OpenNeko field | Source claim | Notes |
|---|---|---|
| `sub` | `sub` | Stable IdP subject. Treated as the primary key. |
| `email` | `email` | Required. If the IdP didn't release email, the plugin errors clearly. |
| `name` | `name`, else `given_name + family_name` | `null` if neither is present. |
| `orgId` | `organization_id` | Scalekit's tenant id. `null` for IdPs that don't supply one. |
| `groups` | union of `groups` + `roles` | Both are passed through — IdPs differ in which they emit. |

OpenNeko's core decides how (or whether) to map `groups` to internal roles; the plugin doesn't impose a mapping.

## Local development

```sh
pnpm install
pnpm test
pnpm build       # → dist/run.js (bundled, single file for the microVM)

# Smoke-test the runner directly:
SCALEKIT_ENVIRONMENT_URL=https://your-app.scalekit.com \
SCALEKIT_CLIENT_ID=… SCALEKIT_CLIENT_SECRET=… \
  node dist/run.js register '{}'
```

## License

Apache-2.0

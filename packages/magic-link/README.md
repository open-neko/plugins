# @open-neko/plugin-magic-link

Passwordless email sign-in for [OpenNeko](https://github.com/open-neko/neko). Implements the generic `auth` contract with **manual provisioning**: an admin creates each user (email + role) in OpenNeko first, and only those users can request a sign-in link. Possession of a mailbox never mints an account — the whole world can know your sign-in URL and still get nowhere.

## How it works

1. An admin provisions users at **Admin → Users** (email + `admin`/`member` role). No invite email is sent — tell people they're in however you like.
2. A user enters their email at `/signin` and clicks **Email me a sign-in link**.
3. OpenNeko's core checks the email against provisioned, non-disabled users **before this plugin is ever called**. Unknown emails get the same "check your email" notice and nothing is sent — no account enumeration, no mailbox spam.
4. For known users, this plugin HMAC-signs `{email, state, expiry}` into a token and emails the link. Clicking it lands on OpenNeko's standard auth callback.
5. `complete_auth` verifies the signature, expiry, and state binding, and returns the identity. The core signs the user in with the role the admin assigned.

Security properties, and where they're enforced:

| Property | Mechanism |
|---|---|
| Only authorized users sign in | Core gate on pre-provisioned users (begin + complete, defense in depth) |
| Single-use links | Core's state cookie is read-and-cleared on first callback; the token is bound to that state |
| Same-browser only | Same state binding — the emailed link only completes where it was requested |
| 10-minute expiry | Token `exp` claim (configurable 60–600s) + the core's state-cookie TTL |
| No self-asserted authorization | Identity always carries `groups: []`; roles come from the admin, never the plugin |

Rotating `MAGIC_LINK_SIGNING_SECRET` invalidates every outstanding link instantly.

## Install

```sh
openneko install @open-neko/plugin-magic-link
```

The CLI prompts for the sign-in values and stores secrets in the per-user secrets file at `~/.config/openneko/secrets.json` (0600 perms):

- `MAGIC_LINK_SIGNING_SECRET` (required, ≥32 chars) — HMAC key for tokens. Generate one: `openssl rand -base64 48`
- `MAGIC_LINK_FROM` (required) — sender, e.g. `OpenNeko <signin@company.com>`. Must be verified with your email provider.
- Exactly one delivery API key: `RESEND_API_KEY`, `POSTMARK_SERVER_TOKEN`, or `SENDGRID_API_KEY` — which one is set selects the provider.
- `MAGIC_LINK_TTL_SECONDS` (optional) — link lifetime, 60–600. Default 600.

Network egress from the plugin VM is locked to `api.resend.com`, `api.postmarkapp.com`, and `api.sendgrid.com`.

## Switching from an SSO plugin

`app_user.sub` is bound to the previous provider's subject. A magic-link sign-in for the same email will refuse to take over a row with a foreign `sub` — clear the `sub` column for affected users and it attaches fresh on their next sign-in.

## Development

```sh
pnpm install
pnpm build       # tsc + esbuild → dist/run.js
pnpm test        # vitest
```

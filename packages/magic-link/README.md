# @open-neko/plugin-magic-link

Passwordless email sign-in for [OpenNeko](https://github.com/open-neko/neko). Implements the generic `auth` contract with **manual provisioning**: an admin creates each user (email + role) in OpenNeko first, and only those users can request a sign-in link. Possession of a mailbox never mints an account — the whole world can know your sign-in URL and still get nowhere.

## Setup — one command, then the browser

```sh
openneko install @open-neko/plugin-magic-link
```

That's the only terminal step. The signing secret is generated and stored by the host automatically (`autogenerate` in the manifest) — you are never prompted for it and never see it.

Everything else happens at **Admin → Settings → Email-link sign-in**, a single page with live status:

1. **Email delivery** — pick a provider (Resend, Postmark, or SendGrid), paste its API key once, and set the From address (must be a sender verified with that provider).
2. **Who can sign in** — add your own email **as admin**, then the rest of your users. There is no invite email; tell people however you like.
3. **Delivery test** — send yourself a real email through the configured provider to confirm delivery. The test email's link is deliberately unusable; real sign-in happens at `/signin`.

The page's status banner lists exactly what is still missing. **The sign-in gate cannot flip on until every required value is set *and* at least one active admin user exists** — a half-finished setup can never lock you out; the deployment simply stays in single-operator mode.

## How sign-in works

1. A user enters their email at `/signin` and clicks **Email me a sign-in link**.
2. OpenNeko's core checks the email against provisioned, non-disabled users **before this plugin is ever called**. Unknown emails get the same "check your email" notice and nothing is sent — no account enumeration, no mailbox spam. Delivery failures are masked identically (diagnose via worker logs, or the delivery test).
3. For known users, the plugin HMAC-signs `{email, state, expiry}` into a token and emails the link. Clicking it lands on OpenNeko's standard auth callback.
4. `complete_auth` verifies the signature, expiry, and state binding, and returns the identity. The core signs the user in with the role the admin assigned.

## Security properties

| Property | Mechanism |
|---|---|
| Only authorized users sign in | Core gate on pre-provisioned users at begin **and** complete (defense in depth) |
| No lockout window | Gate requires ≥1 active provisioned admin before it can flip on |
| Single-use links | Core's state cookie is read-and-cleared on first callback; the token is bound to that state |
| Same-browser only | Same state binding — the emailed link only completes where it was requested |
| 10-minute expiry | Token `exp` claim (configurable 60–600 s via `MAGIC_LINK_TTL_SECONDS`) + the core's state-cookie TTL |
| No self-asserted authorization | Identity always carries `groups: []`; roles come from the admin, never the plugin |
| Instant revocation | Delete the stored `MAGIC_LINK_SIGNING_SECRET` and restart → every outstanding link dies |

## Environment reference

| Key | Required | Set by | Purpose |
|---|---|---|---|
| `MAGIC_LINK_SIGNING_SECRET` | yes | **host (auto-generated)** | HMAC key for sign-in tokens |
| `MAGIC_LINK_FROM` | yes | settings page (or CLI) | From address, e.g. `OpenNeko <signin@company.com>` |
| `RESEND_API_KEY` | one of three | settings page (or CLI) | selects Resend delivery |
| `POSTMARK_SERVER_TOKEN` | one of three | settings page (or CLI) | selects Postmark delivery |
| `SENDGRID_API_KEY` | one of three | settings page (or CLI) | selects SendGrid delivery |
| `MAGIC_LINK_TTL_SECONDS` | no | CLI | link lifetime, 60–600 (default 600) |

Exactly one provider key may be set — the settings page enforces this by clearing the other two when you save. CLI-inclined operators can use `openneko secrets set @open-neko/plugin-magic-link <KEY>` for any of these instead.

Network egress from the plugin VM is locked to `api.resend.com`, `api.postmarkapp.com`, and `api.sendgrid.com`.

## Switching from an SSO plugin

`app_user.sub` is bound to the previous provider's subject. A magic-link sign-in for the same email will refuse to take over a row with a foreign `sub` — clear the `sub` column for affected users and it attaches fresh on their next sign-in.

## Development

```sh
pnpm install
pnpm build       # tsc + esbuild → dist/run.js
pnpm test        # vitest
```

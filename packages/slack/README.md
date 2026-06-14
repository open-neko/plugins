# @open-neko/plugin-slack

Slack for [OpenNeko](https://github.com/open-neko/neko): a bidirectional **channel** (DM the agent, @-mention it in a channel, run `/openneko` slash commands — it replies like the web `/work` UI) **plus actions** (post messages, send DMs, react, look up users/channels). The action handlers run inside a microsandbox microVM whose outbound network is limited to `slack.com`; inbound is carried by the worker over Slack Socket Mode.

## Install

```sh
# From the official OpenNeko marketplace (verified integrity hash):
openneko install @open-neko/plugin-slack

# Or, bypassing every marketplace (e.g. while testing a local build):
openneko install @open-neko/plugin-slack --unverified
```

During install the CLI prompts for `SLACK_BOT_TOKEN` (hidden) and stores it in the per-user secrets file at `~/.config/openneko/secrets.json` (0600 perms). The worker injects it into the plugin's VM at exec time — the token never lands in `openneko.plugins.json` or in `action_request.payload`.

Update the token any time:

```sh
openneko secrets set @open-neko/plugin-slack SLACK_BOT_TOKEN
```

## Slack app setup

Create a Slack app at <https://api.slack.com/apps>. Required bot-token scopes (under **OAuth & Permissions**):

| Scope | Used by |
|---|---|
| `chat:write` | `send_slack_message`, `send_slack_dm` |
| `im:write` | `send_slack_dm` |
| `reactions:write` | `react_slack_message` |
| `users:read` | `lookup_slack_entity` (both modes) |
| `users:read.email` | `lookup_slack_entity` (`user_by_email`) |
| `channels:read` | `lookup_slack_entity` (`channel_by_name`, public channels) |
| `groups:read` | `lookup_slack_entity` (`channel_by_name`, private channels) |

Install the app to your workspace and copy the `xoxb-...` bot token.

## Conversational mode: DMs, @-mentions & slash commands

Beyond actions, the plugin is a **channel** — the agent answers Slack the same way
it answers the web `/work` UI, with per-conversation memory. Inbound arrives over
**Socket Mode**, so no public URL is required (works on laptops and private hosts).

- **1:1 DM** — message the bot; it replies in the DM and remembers the thread.
- **@-mention in a channel** — mention the bot; it replies in a thread. Plain
  channel chatter is ignored — the bot only hears DMs and explicit mentions.
- **Slash commands** — one umbrella command `/openneko`; the first word is the
  sub-command (`/openneko rules-list …`). Replies are ephemeral (invoker-only).

### Slack app setup (one-time)

1. **OAuth & Permissions** → add bot scopes `im:history` and `app_mentions:read`
   (the action scopes above already cover replies; `chat:write` handles ephemerals).
2. **Socket Mode** → enable. **Basic Information → App-Level Tokens** → generate a
   token with `connections:write` (starts `xapp-`).
3. **Event Subscriptions** → enable; subscribe to bot events `message.im` and
   `app_mention`. (Add `message.channels` only if you want the bot to read every
   message in channels it's in — off by default.)
4. **Slash Commands** → create `/openneko` (the Request URL is ignored under Socket
   Mode — any placeholder works).

### Store the tokens

```sh
openneko secrets set @open-neko/plugin-slack SLACK_BOT_TOKEN   # xoxb-…
openneko secrets set @open-neko/plugin-slack SLACK_APP_TOKEN   # xapp-… enables inbound
```

Without `SLACK_APP_TOKEN` the plugin stays outbound/action-only and inbound is
disabled (the worker logs this once). `SLACK_SIGNING_SECRET` is only for the legacy
webhook ingress — Socket Mode doesn't use it.

## Actions

### `send_slack_message`

| Field | Value |
|---|---|
| Payload | `{ channel, text, blocks?, thread_ts? }` |
| Result | `{ channel, ts, permalink: null }` |

`channel` may be a channel id (`C0123…`) or `#name`. Prefer id — name lookups cost an extra API call (use `lookup_slack_entity` to resolve once and cache).

### `send_slack_dm`

| Field | Value |
|---|---|
| Payload | `{ user, text, blocks? }` |
| Result | `{ user, channel, ts }` |

`user` is a user id (e.g. `U0123…`). The plugin opens an IM via `conversations.open` then posts.

### `react_slack_message`

| Field | Value |
|---|---|
| Payload | `{ channel, timestamp, name }` |
| Result | `{ channel, timestamp, name }` |

`name` is the emoji shortcode (`thumbsup`, not `:thumbsup:` — leading/trailing colons are stripped).

### `lookup_slack_entity`

| Field | Value |
|---|---|
| Payload | `{ kind: "user_by_email" \| "channel_by_name", value }` |
| Result | `{ kind, id, name }` |

`user_by_email` calls `users.lookupByEmail`. `channel_by_name` pages through `conversations.list` (up to 10 pages of 1000 channels each = 10k channels max).

## Capabilities (manifest)

```yaml
network:
  - slack.com
env:
  - SLACK_BOT_TOKEN      # required, secret (xoxb-…)
  - SLACK_APP_TOKEN      # optional, secret (xapp-…) — enables inbound over Socket Mode
  - SLACK_SIGNING_SECRET # optional, secret — only for legacy webhook ingress
```

The OpenNeko loader translates the network declaration into the plugin VM's network policy. Any attempt by the plugin to reach a different host is blocked at the VM boundary.

## Local development

```sh
pnpm install
pnpm test
pnpm build           # → dist/run.js (bundled, ~50 KB)
SLACK_BOT_TOKEN=xoxb-... node dist/run.js register '{}'
```

## License

Apache-2.0

# @open-neko/plugin-slack

Slack actions for [OpenNeko](https://github.com/open-neko/neko): post messages, send DMs, react to messages, and look up users/channels. Runs inside a microsandbox microVM whose outbound network is limited to `slack.com`.

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
  - SLACK_BOT_TOKEN  # required, secret
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

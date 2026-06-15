# @open-neko/channel-telegram

A **channel** for OpenNeko — a frontend, like Slack or the built-in web app, but
talking to a [Telegram](https://core.telegram.org/bots/api) chat. It is
**bidirectional**: it *delivers* the agent's Briefing, findings, and approvals
to a chat, and turns replies and inline-button taps back into agent intents.

Unlike an *action* plugin (which the agent calls to do one thing), a channel
sits at the [Interaction Protocol](https://github.com/open-neko/neko) waist: the
agent emits modality-free `InteractionEvent`s for an *audience*, and this plugin
projects them into Telegram's native shape inside its sandbox VM.

## What it does

| RPC | Direction | Behaviour |
|---|---|---|
| `deliver` | OpenNeko → Telegram | Projects `InteractionEvent[]` → `sendMessage` calls (HTML; an `ask` becomes an inline keyboard). |
| `parse_inbound` | Telegram → OpenNeko | Normalizes a Telegram `Update` (button tap / message / `/command`) → `IntentEvent[]`. |
| `verify_inbound` | Telegram → OpenNeko | Constant-time check of the `X-Telegram-Bot-Api-Secret-Token` webhook header. |

The capability profile it declares: `text` modality, Markdown, inline buttons
(`interactiveControls` + `canApproveInline` + `quickReplies`), 4096-char limit,
`push` attention — leaner than the web dashboard.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) → get the **bot token**.
2. Install the channel and set the token:
   ```sh
   openneko install @open-neko/channel-telegram
   openneko secrets set @open-neko/channel-telegram TELEGRAM_BOT_TOKEN 123456789:AA…
   ```
3. **Inbound** — either:
   - **Long-poll** (no public URL): a worker-side poller calls `getUpdates` and feeds each `Update` to `parse_inbound`; or
   - **Webhook**: register `https://<deployment>/channels/@open-neko%2Fchannel-telegram/inbound` with a `secret_token`, and set `TELEGRAM_WEBHOOK_SECRET` to the same value so `verify_inbound` can authenticate it.

## Dry-run

If `TELEGRAM_BOT_TOKEN` is unset at exec time, `deliver` still **projects** the
payload and writes it to stderr, returning `{ delivered: false, ref: "dry-run:N" }`
— so the projection can be exercised locally with no bot and no network.

## Network

Egress is limited to `api.telegram.org` by the manifest; the sandbox blocks
everything else.

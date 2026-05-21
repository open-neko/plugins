---
name: slack-actions
description: Slack action patterns — when to DM vs post to channel, how to draft messages that survive the approval queue, how to use reactions as low-friction status signals. Use when the agent is about to call any of the @open-neko/plugin-slack actions (send_slack_message, send_slack_dm, react_slack_message, lookup_slack_entity). Especially useful when the operator's intent is to alert someone, escalate a finding, acknowledge an event, or chase a stalled item.
license: Apache-2.0
metadata:
  authoredBy: open-neko
  pairsWith: "@open-neko/plugin-slack"
---

# Slack action patterns

The `@open-neko/plugin-slack` plugin contributes four sandboxed actions:

| Action | Visibility | When to use |
|---|---|---|
| `send_slack_message` | Channel-wide | Status updates, public alerts, weekly digests |
| `send_slack_dm` | One-to-one | Stalled task nudges, personal escalations, polite chases |
| `react_slack_message` | Subtle | Acknowledge a thread, show "OpenNeko saw this" without adding noise |
| `lookup_slack_entity` | Auto (read-only) | Resolve usernames / channel IDs before the other three |

## Draft → approve → fire, every time

Every write action defaults to `ask` mode — the agent drafts a payload, the
approval card surfaces in the operator's queue, the operator clicks
**Approve** before anything fires. Do not assume otherwise.

### Drafting rules

1. **Lead with the conclusion.** "Germany hourly revenue down 62% vs baseline."
   not "I noticed an interesting pattern…". Operators skim Slack on
   their phones.
2. **One thing per message.** Don't combine an alert and a follow-up
   question. Split them.
3. **No emoji unless the operator's own messages use them** —
   `lookup_slack_entity` returns the user's profile; if their style is
   plain text, match it.
4. **Format dates as ISO.** Slack-rendering varies; ISO is unambiguous.
5. **Identify yourself once at the top of new threads** ("From the
   OpenNeko Revenue Drop watcher:"). In replies, skip — it's noise.

### Channel vs DM heuristic

- Channel: anything multiple operators need to see. Default.
- DM: when only one operator can act on the finding, AND the channel
  would be inappropriate noise (e.g. "you missed an AR-aging follow-up
  last Friday" — DM their account owner, not #ops).

### Reactions

A `react_slack_message` (✅ ▼ ⚠️ 🔍) is often the right move on a
follow-up — quieter than a reply, still discoverable in the thread's
history. Use ✅ when an action you were tracking completes, ⚠️ when a
finding upgrades from "watch" to "act", 🔍 when you're about to dig
deeper but haven't yet.

## Lookup before write

When the operator references a person or channel by name, call
`lookup_slack_entity` first. The returned `id` is what the write
actions need. Skipping this step is the #1 cause of failed Slack
posts ("channel not found" / "user_not_found").

## Failure modes the operator should see

- **`channel_not_found`** — pass the operator a hint to invite the
  Slack app to the channel first.
- **`token_revoked`** — the bot token expired or was revoked; operator
  needs to re-install with `openneko secrets set @open-neko/plugin-slack
  SLACK_BOT_TOKEN <new>`.
- **`ratelimited`** — exponential backoff is fine; surface the wait if
  it's >5s so the operator knows why the approval is taking.

## What this skill is NOT for

- The actual API call mechanics — the plugin handles that. You just
  draft the payload and ask which action kind to invoke.
- Long-form documents — that's `docx` / `pptx` / Notion territory. A
  Slack post is a sentence-or-three nudge.

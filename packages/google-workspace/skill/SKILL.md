---
name: google-workspace
description: Patterns for using the @open-neko/connector-google-workspace actions — Gmail send, Calendar list, Sheets append — against the currently-connected operator's account. Use whenever the agent needs to send email, look up upcoming meetings, or log a finding to a spreadsheet on the operator's behalf. The operator must have already connected via /integrations; this skill assumes that's done.
license: Apache-2.0
metadata:
  authoredBy: open-neko
  pairsWith: "@open-neko/connector-google-workspace"
---

# Google Workspace patterns

The `@open-neko/connector-google-workspace` plugin contributes three
sandboxed actions, each scoped to the **currently connected operator**:

| Action | Mode | Use when |
|---|---|---|
| `send_gmail` | `ask` | Operator wants OpenNeko to send a real email on their behalf. |
| `list_calendar_events` | `auto` | Operator asks about their schedule, or you need calendar context for a finding. |
| `append_sheet_row` | `ask` | Logging a finding to an external Sheets log the operator maintains. |

## Prerequisites the agent must verify

1. **The operator has connected.** Check the `/integrations` status
   before assuming a Google action is available. If they haven't,
   prompt them: *"Connect Google Workspace at /integrations first."*
2. **The action you need is in scope.** Some operators connect with a
   narrower set of OAuth scopes than the plugin declares. If
   `send_gmail` returns `insufficient_authentication_scopes`, ask the
   operator to reconnect with the gmail.send scope checked.

## `send_gmail` drafting rules

The same `ask`-mode → approval-queue → fire flow as Slack. Draft to be
operator-readable on a phone screen.

1. **Subject lines under 60 chars.** Mobile preview clips at ~60.
2. **One ask per email.** If a finding requires two follow-ups, draft
   two emails. The operator can approve both independently.
3. **Sign off with the operator's name, not "OpenNeko".** You're acting
   on their behalf — the recipient should see the operator as the sender.
4. **Include the source.** "(Detected by your OpenNeko Revenue Drop
   watcher at 14:03 UTC.)" at the bottom of the body. Operators in
   regulated industries need traceability.

## `list_calendar_events` consumption

Returns up to N upcoming events sorted by start time. For "what's on my
calendar tomorrow?" prompts:

- Filter client-side to events whose `start.dateTime` falls in the next
  24-48h — don't ask Google for more than you need.
- Render times in the operator's timezone if known; otherwise use ISO
  with `Z` and let the UI localize.
- Suppress the standing weekly recurring stand-up unless the operator
  asked specifically about it; it's noise.

## `append_sheet_row` patterns

Operators who run "findings logs" in Sheets benefit from this. The
shape that works:

```
spreadsheetId: "1AbC..."   (from the URL of the sheet)
range:         "Findings!A:E"
values:        [
  "2026-05-21T14:03:00Z",  // ISO timestamp
  "germany-revenue-drop",  // watcher slug
  "Germany hourly revenue down 62% vs baseline",  // description
  "approved",              // outcome
  "https://app/work/runs/abc"  // link back
]
```

Use ISO timestamps in the first column; operators sort by it. The
plugin's `range` argument uses A1 notation — `Sheet1!A:E` lets Sheets
auto-find the next empty row.

## Failure modes the operator should see

- **`invalid_grant`** (refresh): the operator's refresh token was
  revoked (account password change, OAuth client deleted, scope
  removed). Prompt: *"Your Google connection expired — reconnect at
  /integrations."*
- **`insufficient_authentication_scopes`** (action): the connected
  scope set doesn't include the one this action needs. Prompt the
  operator to reconnect with the right scope checked.
- **`quotaExceeded`**: Google's daily quota for that API. Surface the
  exact API ("Gmail send quota") so the operator knows which one to
  request an increase for.

## What this skill is NOT for

- One-off email to a person not in Gmail — that's a webhook or the
  built-in `send_webhook` action.
- Long Google Doc authoring — the connector's scopes include `documents`
  but no `create_doc` action is shipped yet. (Coming after M10 ships.)

# @open-neko/connector-google-workspace

Per-operator Google Workspace connector for OpenNeko. Each operator on
your deployment authorizes their own Google account via PKCE OAuth2;
OpenNeko persists their refresh token in the per-operator section of
the secrets file, rotates the access token on demand, and exposes
Gmail / Calendar / Sheets actions back into the agent.

## Setup

1. **Create an OAuth client in Google Cloud Console** at
   <https://console.cloud.google.com/apis/credentials> → **+ Create
   credentials** → **OAuth client ID** → **Web application**.

2. Set the **Authorized redirect URI** to your deployment's callback:

   ```
   https://<your-deployment>/api/integrations/connect/%40open-neko%2Fconnector-google-workspace/callback
   ```

   (The `%40` / `%2F` come from URL-encoding the npm scoped name.)

3. Enable the APIs you intend to use: Gmail API, Google Calendar API,
   Google Sheets API, Google Docs API.

4. Install the connector:

   ```sh
   openneko install @open-neko/connector-google-workspace
   ```

   The CLI will prompt for `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` — paste them from the Cloud Console.

5. Each operator on the deployment then visits **Settings →
   Integrations** in the OpenNeko web app and clicks **Connect Google
   Workspace** on their own. The OAuth dance happens in their browser;
   OpenNeko persists their tokens privately.

## Actions

| Action | Default mode | Notes |
|---|---|---|
| `send_gmail` | `ask` | Sends as the connected operator. `to`, `subject`, `body`, optional `cc`. |
| `list_calendar_events` | `auto` | Returns up to `maxResults` upcoming events on the primary calendar. |
| `append_sheet_row` | `ask` | Append one row to a Sheet the operator can edit. `spreadsheetId`, `range`, `values[]`. |

## Token lifecycle

- **Access tokens** expire after ~1 hour. The connector's
  `refresh_connect` handler exchanges the refresh token for a fresh
  pair on demand.
- **Refresh tokens** are long-lived but can be revoked by the operator
  at any time via <https://myaccount.google.com/permissions>. A revoked
  refresh token surfaces as `invalid_grant` on the next action call —
  the operator must reconnect via /integrations.
- Tokens never leave the worker's microsandbox VM except via the
  worker-mediated writeback path. The plugin does not persist anything
  to disk.

## Scopes

Default scope set (declared in the manifest):

- `openid`, `userinfo.email` — basic identity
- `gmail.send` — send email as the operator
- `calendar.events.readonly` — read upcoming events
- `spreadsheets` — read + write Sheets
- `documents` — read + write Docs (no action handler ships yet)

Operators can opt into a narrower subset on the OAuth consent screen;
actions whose scope wasn't granted will return
`insufficient_authentication_scopes` at call time.

## Sandbox

Network egress is limited to:

- `accounts.google.com` (OAuth consent screen)
- `oauth2.googleapis.com` (token exchange + refresh)
- `gmail.googleapis.com`, `www.googleapis.com`, `sheets.googleapis.com`,
  `docs.googleapis.com` (action APIs)

The microsandbox VM enforces this at the network boundary; the plugin
cannot reach any other host even if instructed.

## License

Apache-2.0.

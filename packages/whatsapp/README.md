# @open-neko/channel-whatsapp

Bidirectional WhatsApp channel for OpenNeko, built on the WhatsApp Cloud
API (Meta Graph). Delivers the agent's Briefing, findings, and approvals
as text + interactive reply buttons, and turns replies and button taps
back into agent intents.

## Setup

1. Create a Meta app with the WhatsApp product and note the **phone
   number id** and a **permanent access token**.
2. Install the plugin, then store the secrets:

   ```sh
   openneko secrets set @open-neko/channel-whatsapp WHATSAPP_TOKEN
   openneko secrets set @open-neko/channel-whatsapp WHATSAPP_PHONE_ID
   openneko secrets set @open-neko/channel-whatsapp WHATSAPP_APP_SECRET
   openneko secrets set @open-neko/channel-whatsapp WHATSAPP_VERIFY_TOKEN
   ```

3. Point the Meta webhook at your OpenNeko inbound URL. Inbound posts
   are verified in-VM against `X-Hub-Signature-256` (HMAC-SHA256 of the
   raw body with the app secret); the one-time GET `hub.challenge`
   handshake is answered by the ingress route using
   `WHATSAPP_VERIFY_TOKEN`.

Without `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` the plugin runs in dry-run
mode: it projects the native payload to stderr and sends nothing.

## Capability profile

Text only, clamped to 1024 characters; up to three quick-reply buttons
(`Approve` / `Reject` ride the shared `verb:rest` button-id convention);
no markdown, cards, or charts — a briefing degrades to a bold title, a
one-line summary, and the headline metric.

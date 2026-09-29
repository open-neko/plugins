# @open-neko/plugin-resend

Operational email for [OpenNeko](https://github.com/open-neko/neko) through [Resend](https://resend.com). A workflow can send an alert every six hours, a daily summary, or a one-off note, from a sender you verified.

## Setup

```sh
openneko install @open-neko/plugin-resend
```

The install asks for these values:

| Setting | Required | What it is |
|---|---|---|
| `RESEND_API_KEY` | Yes | A Resend API key. The gateway holds it; the plugin sandbox never sees it. Give it Full access if you want the agent to list your templates. |
| `RESEND_FROM` | Yes | The sender for every email, e.g. `Acme Ops <ops@mail.acme.com>`. Verify the domain in Resend first. The agent cannot change it. |
| `RESEND_REPLY_TO` | No | The default reply-to address. |
| `RESEND_ALLOWED_RECIPIENTS` | No | Domains the plugin may send to, e.g. `acme.com, *.acme.com, partner.com`. The plugin refuses any other recipient, even on an approved email. |
| `RESEND_LOGO_URL`, `RESEND_BRAND_COLOR`, `RESEND_FOOTER_TEXT` | No | The logo, accent color, and footer line of the house layout. |

The plugin can reach only `api.resend.com`.

## Actions

| Action | Default | What it does |
|---|---|---|
| `send_email` | ask | Sends one email with one body: a Resend template, Markdown in the house layout, or HTML |
| `list_email_templates` | auto | Lists your Resend templates |
| `get_email_template` | auto | Gets a template's subject and variable keys |
| `get_email_status` | auto | Gets the delivery status of a sent email |

## How emails look

Operators describe the email in plain words, for example "email me the SKUs below reorder point every 6 hours". The agent fetches real data, asks how to show it (a table or a list, which columns, what to do when nothing is found, the subject line), shows a preview, and can send a test to you. It then saves the layout in the workflow step that sends the email. Each run fills that layout with new data. To change the look later, ask the agent or edit the step.

The house layout renders Markdown in a 600-pixel, table-based layout with inline styles, so it holds up in Gmail, Outlook, and Apple Mail. Raw HTML in the Markdown is escaped, and links must use `https:`, `http:`, or `mailto:`.

For a fully branded email, design a template in Resend's editor and tell the agent its alias. The agent fills the variables only. A template variable holds one value, so use Markdown for lists whose length changes from run to run.

## Sending without approval

`send_email` asks for approval by default. For a scheduled workflow, an admin can ask the agent for a rule such as "send email without approval when every recipient is at acme.com or partner.com; ask for anything else". OpenNeko reads the recipients from `to`, `cc`, and `bcc` and checks each domain, so an email with one outside recipient waits for approval.

Every send uses the OpenNeko action id as Resend's `Idempotency-Key`, so a retried action does not send twice.

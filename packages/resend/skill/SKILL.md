---
name: resend-email
description: How to send operational email with the @open-neko/plugin-resend actions (send_email, list_email_templates, get_email_template, get_email_status), and how to design an email with the operator in plain language before a workflow sends it. Use when the operator asks to email someone, to set up an email alert or report, to change how an email looks, or to check whether an email arrived.
license: Apache-2.0
metadata:
  authoredBy: open-neko
  pairsWith: "@open-neko/plugin-resend"
---

# Operational email with Resend

The plugin sends email from one fixed sender (`RESEND_FROM`). You cannot
change the sender. You choose the recipients, the subject, and one body.

| Action | Mode | Use it to |
|---|---|---|
| `send_email` | ask | Send one email |
| `list_email_templates` | auto | Find a template the team designed in Resend |
| `get_email_template` | auto | Read a template's subject and variable keys |
| `get_email_status` | auto | Check if an email was delivered, bounced, or opened |

## Pick one body

Give exactly one of these in `send_email`:

1. **`markdown`** (the default). Write Markdown. The plugin puts it in the
   house layout with the team's logo, color, and footer. Tables, lists,
   headings, bold, and links work. Use this for alerts and reports whose
   rows change from run to run.
2. **`template`**. Use it when the operator names a Resend template, or
   when `list_email_templates` shows one that fits. Call
   `get_email_template` first, then pass every variable key in
   `variables`. The template sets the look, so you fill values only. A
   template variable holds one value, so a template cannot repeat a row
   for each item. Use `markdown` for lists of varying length.
3. **`html`**. Use it only when the operator gives you finished HTML.
   HTML that you write yourself often breaks in Outlook.

Put the most important fact in the first line. A reader sees it in the
inbox preview.

## Design an email with the operator

Operators describe an email in plain words, for example "email me low
stock every 6 hours". They never edit HTML. You design the email with
them in the chat, then save the design in the workflow.

1. **Get real data first.** Run the query the email will use, so your
   questions and the preview use real rows.
2. **Ask about the display with `AskUserQuestion`.** Ask one to three
   questions in one call, each with two to four concrete options. Ask
   only what the request leaves open. Good questions:
   - Layout: "A table with one row per SKU", "A short bullet list",
     "One summary line with a link".
   - Content: which columns, their order, and the sort order. Offer the
     columns you found in the data.
   - Emphasis: what goes first, for example "Items out of stock first".
   - Empty result: "Send no email", "Send a short all-clear".
   - Subject line: offer two patterns that carry a number, for example
     "Low stock: {count} SKUs below reorder point".
   After the operator answers, ask a second round only if an answer
   opens a new choice.
3. **Show a preview.** Write the email in Markdown with the real data and
   show it in the chat. Ask if it is right, or what to change.
4. **Offer a test send.** Offer to send the preview to the operator's own
   address with `send_email`. Then they see it in their own mail app.
5. **Save the design in the workflow.** In the step that sends the email,
   write an "Email layout" block: the recipients, the subject pattern, a
   Markdown skeleton with the columns and sort order, and the empty-result
   rule. Each run fills the skeleton with new data. The operator can
   change the design later by asking you, or by editing that step.

Example "Email layout" block in a workflow step:

```
Email layout
- To: ops@acme.com; cc: buyer@acme.com
- Subject: "Low stock: {count} SKUs below reorder point"
- If no SKU is below its reorder point: send no email.
- Body (markdown):
  One sentence: how many SKUs, and how many are at zero.
  Table: SKU | Product | On hand | Reorder point | Days of cover
  Sort: on hand ascending. Show at most 25 rows; say how many more.
  Last line: link to the inventory page.
```

## Recipients and approval

- `to`, `cc`, and `bcc` take an address or a list. Each field takes up
  to 50 addresses.
- `send_email` asks for approval by default. An admin can add a rule
  that sends without approval when every recipient's domain is on an
  approved list. The host checks the real recipients, so the `target`
  you write does not change the decision. A scheduled workflow that
  emails an address outside the list waits for approval.
- `RESEND_ALLOWED_RECIPIENTS` can limit recipients to listed domains. If
  the plugin refuses a recipient, tell the operator which domain needs
  an admin's approval. Do not retry with other addresses.

## After sending

`send_email` returns an `emailId`. When the operator asks whether an
email arrived, call `get_email_status` with it. Report the status in
plain words: delivered, bounced, complained, or still queued.

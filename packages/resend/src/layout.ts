import { Marked, type Tokens } from "marked";

export interface LayoutOptions {
  subject: string;
  logoUrl?: string;
  brandColor?: string;
  footerText?: string;
}

const DEFAULT_BRAND = "#2563eb";
const TEXT = "#1f2328";
const MUTED = "#59636e";
const BORDER = "#d1d9e0";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null;
}

function brand(color: string | undefined): string {
  return color && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color.trim()) ? color.trim() : DEFAULT_BRAND;
}

function markdownRenderer(link: string): Marked {
  const cell = `border:1px solid ${BORDER};padding:6px 10px;text-align:left;vertical-align:top`;
  return new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
      heading({ tokens, depth }: Tokens.Heading) {
        const size = depth <= 1 ? 22 : depth === 2 ? 18 : 16;
        return `<h${depth} style="margin:24px 0 8px;font-size:${size}px;line-height:1.3;color:${TEXT}">${this.parser.parseInline(tokens)}</h${depth}>`;
      },
      paragraph({ tokens }: Tokens.Paragraph) {
        return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${TEXT}">${this.parser.parseInline(tokens)}</p>`;
      },
      link({ href, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        const target = safeHref(href);
        return target ? `<a href="${escapeHtml(target)}" style="color:${link}">${text}</a>` : text;
      },
      image({ href, text }: Tokens.Image) {
        return /^https:/i.test(href.trim())
          ? `<img src="${escapeHtml(href.trim())}" alt="${escapeHtml(text)}" style="max-width:100%;height:auto;border:0">`
          : escapeHtml(text);
      },
      codespan({ text }: Tokens.Codespan) {
        return `<code style="font-family:Menlo,Consolas,monospace;font-size:13px;background:#f6f8fa;padding:1px 4px;border-radius:4px">${escapeHtml(text)}</code>`;
      },
      code({ text }: Tokens.Code) {
        return `<pre style="margin:0 0 14px;padding:12px;background:#f6f8fa;border-radius:6px;overflow:auto;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.45;color:${TEXT}">${escapeHtml(text)}</pre>`;
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        return `<blockquote style="margin:0 0 14px;padding:0 12px;border-left:3px solid ${BORDER};color:${MUTED}">${this.parser.parse(tokens)}</blockquote>`;
      },
      hr() {
        return `<hr style="border:0;border-top:1px solid ${BORDER};margin:20px 0">`;
      },
      list(token: Tokens.List) {
        const tag = token.ordered ? "ol" : "ul";
        const start = token.ordered && token.start !== 1 && token.start !== "" ? ` start="${Number(token.start)}"` : "";
        const items = token.items
          .map((item) => `<li style="margin:0 0 6px">${this.parser.parse(item.tokens)}</li>`)
          .join("");
        return `<${tag}${start} style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.55;color:${TEXT}">${items}</${tag}>`;
      },
      table(token: Tokens.Table) {
        const head = token.header
          .map((c) => `<th style="${cell};background:#f6f8fa">${this.parser.parseInline(c.tokens)}</th>`)
          .join("");
        const rows = token.rows
          .map((row) => `<tr>${row.map((c) => `<td style="${cell}">${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`)
          .join("");
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px;font-size:14px;color:${TEXT}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
      },
    },
  });
}

/** Renders Markdown into one table-based layout that holds up in Gmail, Outlook, and Apple Mail. */
export function renderMarkdownEmail(markdown: string, options: LayoutOptions): { html: string; text: string } {
  const accent = brand(options.brandColor);
  const body = markdownRenderer(accent).parse(markdown) as string;
  const logo =
    options.logoUrl && /^https:/i.test(options.logoUrl.trim())
      ? `<tr><td style="padding:24px 32px 0"><img src="${escapeHtml(options.logoUrl.trim())}" alt="" height="32" style="height:32px;width:auto;border:0;display:block"></td></tr>`
      : "";
  const footer = options.footerText
    ? `<tr><td style="padding:16px 32px 24px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.5;color:${MUTED}">${escapeHtml(options.footerText)}</td></tr>`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(options.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-top:4px solid ${accent};border-radius:6px;font-family:${FONT}">
${logo}<tr><td style="padding:24px 32px 12px">${body}</td></tr>
${footer}</table>
</td></tr>
</table>
</body>
</html>`;
  const text = options.footerText ? `${markdown.trim()}\n\n--\n${options.footerText}\n` : `${markdown.trim()}\n`;
  return { html, text };
}

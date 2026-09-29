import { describe, expect, it } from "vitest";
import { renderMarkdownEmail } from "../src/layout";

const render = (md: string, extra = {}) => renderMarkdownEmail(md, { subject: "Low stock", ...extra });

describe("renderMarkdownEmail", () => {
  it("renders tables, lists, and headings with inline styles", () => {
    const { html } = render("## Low stock\n\n| SKU | On hand |\n|---|---|\n| WB-120 | 4 |\n\n- first\n- second");
    expect(html).toContain("<h2 style=");
    expect(html).toMatch(/<table role="presentation"[^>]*>.*<th style="[^"]*">SKU<\/th>/s);
    expect(html).toContain('<td style="border:1px solid #d1d9e0;padding:6px 10px;text-align:left;vertical-align:top">WB-120</td>');
    expect(html).toMatch(/<ul style="[^"]*"><li style="[^"]*">first<\/li><li style="[^"]*">second<\/li><\/ul>/);
  });

  it("escapes raw HTML and drops unsafe links", () => {
    const { html } = render('<script>alert(1)</script>\n\n[click](javascript:alert(1)) and [ok](https://acme.com/a?b=1&c="x")');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://acme.com/a?b=1&amp;c=&quot;x&quot;"');
  });

  it("uses the brand color, logo, and footer, and ignores unsafe values", () => {
    const branded = render("Hi", { brandColor: "#123456", logoUrl: "https://acme.com/logo.png", footerText: "Sent by <OpenNeko>" });
    expect(branded.html).toContain("border-top:4px solid #123456");
    expect(branded.html).toContain('src="https://acme.com/logo.png"');
    expect(branded.html).toContain("Sent by &lt;OpenNeko&gt;");
    expect(branded.text).toBe("Hi\n\n--\nSent by <OpenNeko>\n");

    const unsafe = render("Hi", { brandColor: "red;background:url(x)", logoUrl: "http://acme.com/logo.png" });
    expect(unsafe.html).toContain("border-top:4px solid #2563eb");
    expect(unsafe.html).not.toContain("acme.com/logo.png");
  });

  it("escapes the subject in the title", () => {
    expect(renderMarkdownEmail("x", { subject: "<b>Q3</b>" }).html).toContain("<title>&lt;b&gt;Q3&lt;/b&gt;</title>");
  });
});

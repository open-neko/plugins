import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — pure-JS module
import { buildSite } from "../scripts/build-site.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIST = path.resolve(__dirname, "..", "site", "dist");

describe("build-site", () => {
  it("emits index.html with a card per plugin and serves raw artifacts", async () => {
    const result = await buildSite();
    expect(result.plugins).toBeGreaterThan(0);
    const html = readFileSync(path.join(SITE_DIST, "index.html"), "utf8");
    expect(html).toContain("@open-neko/plugin-parallel-search");
    expect(html).toContain("search.parallel.ai");
    expect(html).toContain("openneko install @open-neko/plugin-parallel-search");
    expect(html).toContain("OpenNeko Official");
    // Raw marketplace served alongside the HTML so the CLI can fetch it.
    const raw = JSON.parse(
      readFileSync(path.join(SITE_DIST, "marketplace.json"), "utf8"),
    ) as { plugins: { name: string }[] };
    expect(raw.plugins.map((p) => p.name)).toContain(
      "@open-neko/plugin-parallel-search",
    );
    // Schema served at a stable URL.
    const schema = JSON.parse(
      readFileSync(path.join(SITE_DIST, "marketplace.schema.json"), "utf8"),
    );
    expect(schema.$id).toBe(
      "https://open-neko.github.io/plugins/marketplace.schema.json",
    );
  });
});

import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error pure-JS module
import { validateMarketplace } from "../scripts/validate-marketplace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = path.resolve(__dirname, "..");
const VALID_INTEGRITY = "sha512-" + "a".repeat(86) + "==";

function makeFixture(marketplaceJson: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mkt-fix-"));
  mkdirSync(path.join(dir, "schema"));
  cpSync(
    path.join(PLUGINS_ROOT, "schema", "marketplace.schema.json"),
    path.join(dir, "schema", "marketplace.schema.json"),
  );
  writeFileSync(
    path.join(dir, "marketplace.json"),
    JSON.stringify(marketplaceJson, null, 2),
    "utf8",
  );
  return dir;
}

function validPlugin(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: "@open-neko/plugin-good",
    title: "Good Plugin",
    description: "A simple example plugin entry used by the validator test.",
    source: "https://github.com/open-neko/plugins/tree/main/packages/good",
    versions: [
      {
        version: "0.1.0",
        integrity: VALID_INTEGRITY,
        requires_network: [],
        kinds: ["demo"],
        publishedAt: "2026-05-17",
      },
    ],
    ...over,
  };
}

function validMarketplace(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Test Marketplace",
    owner: "test",
    description: "A test marketplace used by the validator suite.",
    plugins: [validPlugin()],
    ...over,
  };
}

describe("validateMarketplace", () => {
  let fixtureDir: string;

  afterEach(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("passes a valid marketplace", async () => {
    fixtureDir = makeFixture(validMarketplace());
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures).toEqual([]);
    expect(result.pluginCount).toBe(1);
  });

  it("rejects a marketplace missing required top-level fields", async () => {
    fixtureDir = makeFixture({ plugins: [] } as Record<string, unknown>);
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("rejects a plugin entry with a semver range version", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "^0.1.0",
                integrity: VALID_INTEGRITY,
                kinds: ["demo"],
                publishedAt: "2026-05-17",
              },
            ],
          }),
        ],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.join("\n")).toMatch(/version/);
  });

  it("rejects a plugin entry with missing integrity", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "0.1.0",
                kinds: ["demo"],
                publishedAt: "2026-05-17",
              },
            ],
          }),
        ],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.join("\n")).toMatch(/integrity/);
  });

  it("rejects a plugin entry with duplicate versions", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                kinds: ["demo"],
                publishedAt: "2026-05-17",
              },
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                kinds: ["demo"],
                publishedAt: "2026-05-18",
              },
            ],
          }),
        ],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.join("\n")).toMatch(/duplicate version 0\.1\.0/);
  });

  it("rejects a source URL not on an allowlisted host", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [validPlugin({ source: "https://example.com/weird" })],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.join("\n")).toMatch(/source/);
  });

  it("rejects a plugin with no action kinds", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                kinds: [],
                publishedAt: "2026-05-17",
              },
            ],
          }),
        ],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.join("\n")).toMatch(/kinds/);
  });

  it("rejects two plugin entries with the same name", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [validPlugin(), validPlugin()],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.join("\n")).toMatch(/duplicate plugin entry/);
  });

  it("validates the actual repo-root marketplace.json against its own schema", async () => {
    const result = await validateMarketplace({ root: PLUGINS_ROOT });
    expect(result.failures).toEqual([]);
  });
});

import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
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

function actionCapability(kinds: Array<{ kind: string; description: string }>) {
  return { action: { kinds } };
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
        permissions: { network: [], env: [] },
        capabilities: actionCapability([
          { kind: "demo", description: "demo action" },
        ]),
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
                permissions: { network: [], env: [] },
                capabilities: actionCapability([
                  { kind: "demo", description: "d" },
                ]),
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
                permissions: { network: [], env: [] },
                capabilities: actionCapability([
                  { kind: "demo", description: "d" },
                ]),
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
                permissions: { network: [], env: [] },
                capabilities: actionCapability([
                  { kind: "demo", description: "d" },
                ]),
                publishedAt: "2026-05-17",
              },
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                permissions: { network: [], env: [] },
                capabilities: actionCapability([
                  { kind: "demo", description: "d" },
                ]),
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

  it("rejects a plugin with no capability declared", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                permissions: { network: [], env: [] },
                capabilities: {},
                publishedAt: "2026-05-17",
              },
            ],
          }),
        ],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.join("\n")).toMatch(/capabilities/);
  });

  it("accepts an auth-only plugin", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                permissions: { network: [], env: [] },
                capabilities: { auth: { providerLabel: "Test" } },
                publishedAt: "2026-05-17",
              },
            ],
          }),
        ],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures).toEqual([]);
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

  // ─── draft + provenanceWaived flags ──────────────────────────────────

  it("accepts a version with draft:true (placeholder integrity, no live checks)", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                draft: true,
                permissions: { network: [], env: [] },
                capabilities: actionCapability([
                  { kind: "demo", description: "d" },
                ]),
                publishedAt: "2026-05-17",
              },
            ],
          }),
        ],
      }),
    );
    const offline = await validateMarketplace({ root: fixtureDir });
    expect(offline.failures).toEqual([]);
    // Live mode must NOT 404-fail for a draft entry — the validator
    // should skip the npm check and pass.
    const live = await validateMarketplace({ root: fixtureDir, live: true });
    expect(live.failures).toEqual([]);
  });

  it("accepts a version with provenanceWaived:true (passes schema)", async () => {
    // We can't unit-test the live-fetch-without-provenance path without
    // network access; this test asserts the schema accepts the flag so
    // existing legacy entries can be marked.
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                provenanceWaived: true,
                permissions: { network: [], env: [] },
                capabilities: actionCapability([
                  { kind: "demo", description: "d" },
                ]),
                publishedAt: "2026-05-17",
              },
            ],
          }),
        ],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures).toEqual([]);
  });

  it("rejects an unknown flag on a version (additionalProperties:false stays enforced)", async () => {
    fixtureDir = makeFixture(
      validMarketplace({
        plugins: [
          validPlugin({
            versions: [
              {
                version: "0.1.0",
                integrity: VALID_INTEGRITY,
                somethingUnknown: true,
                permissions: { network: [], env: [] },
                capabilities: actionCapability([
                  { kind: "demo", description: "d" },
                ]),
                publishedAt: "2026-05-17",
              },
            ],
          }),
        ],
      }),
    );
    const result = await validateMarketplace({ root: fixtureDir });
    expect(result.failures.length).toBeGreaterThan(0);
  });
});

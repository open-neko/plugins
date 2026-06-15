import { describe, expect, it } from "vitest";
// @ts-expect-error pure-JS module
import { syncMarketplace, toCatalogCapabilities } from "../scripts/sync-marketplace.mjs";

const INTEGRITY = "sha512-" + "a".repeat(86) + "==";

type Pkg = {
  name: string;
  version: string;
  private?: boolean;
  openneko?: Record<string, unknown>;
};

const run = (
  plugins: Array<{ name: string; versions: Array<{ version: string }> }>,
  packages: Pkg[],
  integrity: (n: string, v: string) => string | null = () => INTEGRITY,
) =>
  syncMarketplace({
    marketplace: { plugins },
    packages,
    lookupIntegrity: integrity,
    lookupPublishedAt: () => "2026-06-15",
  });

describe("syncMarketplace", () => {
  it("appends a published version missing from the catalog", () => {
    const plugins = [{ name: "@open-neko/plugin-slack", versions: [{ version: "0.3.0" }] }];
    const { added, marketplace } = run(plugins, [
      {
        name: "@open-neko/plugin-slack",
        version: "0.4.0",
        openneko: {
          permissions: { network: ["slack.com"], env: [] },
          capabilities: { action: { kinds: [{ kind: "send_slack_message", description: "d", default_mode: "auto" }] } },
        },
      },
    ]);
    expect(added).toEqual(["@open-neko/plugin-slack@0.4.0"]);
    const v = marketplace.plugins[0].versions.find((x: { version: string }) => x.version === "0.4.0");
    expect(v.integrity).toBe(INTEGRITY);
    expect(v.publishedAt).toBe("2026-06-15");
    expect(v.permissions.network).toEqual(["slack.com"]);
  });

  it("is idempotent — never re-adds an existing version", () => {
    const plugins = [{ name: "p", versions: [{ version: "1.0.0" }] }];
    const { added } = run(plugins, [{ name: "p", version: "1.0.0", openneko: { capabilities: {} } }]);
    expect(added).toEqual([]);
    expect(plugins[0].versions).toHaveLength(1);
  });

  it("skips a version not yet on npm (lookupIntegrity null)", () => {
    const plugins = [{ name: "p", versions: [{ version: "1.0.0" }] }];
    const { added } = run(plugins, [{ name: "p", version: "2.0.0", openneko: { capabilities: {} } }], () => null);
    expect(added).toEqual([]);
    expect(plugins[0].versions).toHaveLength(1);
  });

  it("warns and skips a package that has no marketplace block yet", () => {
    const { added, warnings } = run([], [
      { name: "@open-neko/brand-new", version: "1.0.0", openneko: { capabilities: {} } },
    ]);
    expect(added).toEqual([]);
    expect(warnings.join(" ")).toContain("@open-neko/brand-new");
  });

  it("ignores private packages and the types lib (no openneko block)", () => {
    const plugins = [{ name: "p", versions: [] as Array<{ version: string }> }];
    const { added } = run(plugins, [
      { name: "p", version: "1.0.0", private: true, openneko: { capabilities: {} } },
      { name: "@open-neko/plugin-types", version: "0.5.0" }, // no openneko
    ]);
    expect(added).toEqual([]);
  });

  it("strips action `example` and copies the channel capability", () => {
    const caps = toCatalogCapabilities({
      action: { kinds: [{ kind: "k", description: "d", default_mode: "auto", example: { foo: 1 } }] },
      channel: { providerLabel: "P", directions: ["outbound", "inbound"], ingress: "socket", profile: { x: 1 } },
    });
    expect(caps.action.kinds[0]).toEqual({ kind: "k", description: "d", default_mode: "auto" });
    expect(caps.action.kinds[0]).not.toHaveProperty("example");
    expect(caps.channel.ingress).toBe("socket");
  });
});

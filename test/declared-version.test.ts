import { describe, it, expect } from "vitest";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The version a plugin declares in definePlugin() is what it reports via
// register(); the host rejects the plugin unless it equals the manifest pin,
// which release-please derives from package.json. These two must never drift,
// so assert every plugin's declared version equals its package.json version.
const packagesDir = fileURLToPath(new URL("../packages", import.meta.url));

const pluginPackages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(path.join(packagesDir, name, "src/plugin.ts")));

describe("plugin declared version", () => {
  it("finds plugin packages to check", () => {
    expect(pluginPackages.length).toBeGreaterThan(0);
  });

  for (const name of pluginPackages) {
    it(`${name}: definePlugin version matches package.json`, async () => {
      const pkg = JSON.parse(
        readFileSync(path.join(packagesDir, name, "package.json"), "utf8"),
      ) as { version: string };
      const mod = (await import(
        path.join(packagesDir, name, "src/plugin.ts")
      )) as { default: { version: string } };
      expect(mod.default.version).toBe(pkg.version);
    });
  }
});

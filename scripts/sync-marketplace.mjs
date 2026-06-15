// Keep marketplace.json in sync with what's published on npm, so nobody has to
// hand-edit a version entry per release. For each non-private workspace package
// that declares an `openneko` block, if its package.json version is published on
// npm and missing from the catalog, append an entry — integrity pulled from the
// npm registry (authoritative), capabilities/permissions taken from the package's
// own package.json (the source of truth). Curated top-level fields (title,
// description, source, maintainers) and existing version entries are never
// touched. Idempotent.
//
//   node scripts/sync-marketplace.mjs           # write missing entries
//   node scripts/sync-marketplace.mjs --check   # exit 1 if any are missing (CI guard)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKETPLACE = path.join(ROOT, "marketplace.json");
const PACKAGES_DIR = path.join(ROOT, "packages");

// package.json openneko.capabilities → marketplace capabilities: action kinds
// keep only the catalog's schema fields (drop `example`); channel/connect/auth
// shapes already match the schema, so they're copied straight through.
export function toCatalogCapabilities(caps = {}) {
  const out = {};
  if (caps.action) {
    out.action = {
      kinds: caps.action.kinds.map((k) => ({
        kind: k.kind,
        description: k.description,
        ...(k.default_mode !== undefined ? { default_mode: k.default_mode } : {}),
      })),
    };
  }
  for (const key of ["channel", "connect", "auth"]) {
    if (caps[key]) out[key] = caps[key];
  }
  return out;
}

/**
 * Pure core: append catalog entries for any package whose version is published
 * (lookupIntegrity returns a hash) but absent from `marketplace`. Mutates and
 * returns `marketplace`, plus the list of additions and warnings. No I/O — the
 * caller injects `lookupIntegrity(name, version)` and `lookupPublishedAt(name,
 * version)`.
 */
export function syncMarketplace({ marketplace, packages, lookupIntegrity, lookupPublishedAt }) {
  const byName = new Map(marketplace.plugins.map((p) => [p.name, p]));
  const added = [];
  const warnings = [];

  for (const pkg of packages) {
    if (pkg.private || !pkg.openneko) continue;
    const entry = byName.get(pkg.name);
    if (!entry) {
      warnings.push(`${pkg.name}: not in marketplace.json — add the plugin block (title/description/source) once, then versions sync.`);
      continue;
    }
    if (entry.versions.some((v) => v.version === pkg.version)) continue;
    const integrity = lookupIntegrity(pkg.name, pkg.version);
    if (!integrity) continue; // not on npm yet (e.g. a pre-publish release PR)

    entry.versions.push({
      version: pkg.version,
      integrity,
      permissions: pkg.openneko.permissions ?? { network: [], env: [] },
      capabilities: toCatalogCapabilities(pkg.openneko.capabilities),
      publishedAt: lookupPublishedAt(pkg.name, pkg.version),
    });
    added.push(`${pkg.name}@${pkg.version}`);
  }

  return { marketplace, added, warnings };
}

// ── CLI wiring (real fs + npm) ───────────────────────────────────────────────

const npm = (args) => {
  try {
    return execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

const readPackages = () =>
  readdirSync(PACKAGES_DIR)
    .map((dir) => {
      try {
        return JSON.parse(readFileSync(path.join(PACKAGES_DIR, dir, "package.json"), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

const lookupIntegrity = (name, version) => npm(["view", `${name}@${version}`, "dist.integrity"]) || null;

const lookupPublishedAt = (name, version) => {
  const timeJson = npm(["view", name, "time", "--json"]);
  if (timeJson) {
    try {
      const t = JSON.parse(timeJson)[version];
      if (t) return t.slice(0, 10);
    } catch {
      // fall through to today's date
    }
  }
  return new Date().toISOString().slice(0, 10);
};

function main() {
  const check = process.argv.includes("--check");
  const marketplace = JSON.parse(readFileSync(MARKETPLACE, "utf8"));
  const { added, warnings } = syncMarketplace({
    marketplace,
    packages: readPackages(),
    lookupIntegrity,
    lookupPublishedAt,
  });

  for (const w of warnings) console.warn(`[sync] WARN ${w}`);

  if (added.length === 0) {
    console.log("[sync] marketplace.json already in sync with npm");
    return;
  }
  if (check) {
    console.error(`[sync] marketplace.json is missing published versions:\n  ${added.join("\n  ")}\nRun: pnpm sync:marketplace`);
    process.exit(1);
  }
  writeFileSync(MARKETPLACE, JSON.stringify(marketplace, null, 2) + "\n");
  console.log(`[sync] added ${added.length} entr${added.length === 1 ? "y" : "ies"}:\n  ${added.join("\n  ")}`);
}

// Only run as a CLI — importing the module (e.g. from tests) has no side effects.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

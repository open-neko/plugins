#!/usr/bin/env node
// Validates marketplace.json at the repo root against schema/marketplace.schema.json
// and against the structural rules CONTRIBUTING.md describes. Live npm
// checks (provenance, tarball integrity, lifecycle-script audit,
// package.json openneko.requires_network ↔ marketplace.requires_network)
// only run when --live is passed. PR CI runs with --live; push to main
// runs offline because in-flight entries may not yet have a published
// npm artifact.
//
// Library form:  await validateMarketplace({ root, live }) → { failures }
// CLI form:      node validate-marketplace.mjs [--live]
//
// Exit codes:
//   0 — marketplace.json is valid
//   1 — at least one entry failed schema or rule checks
//   2 — invalid usage / crash
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

const FORBIDDEN_LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "preuninstall",
  "uninstall",
  "postuninstall",
];

export async function validateMarketplace({ root = DEFAULT_ROOT, live = false } = {}) {
  const marketplacePath = path.join(root, "marketplace.json");
  const schemaPath = path.join(root, "schema", "marketplace.schema.json");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats.default(ajv);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const validate = ajv.compile(schema);

  let marketplace;
  try {
    marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
  } catch (err) {
    return { failures: [`marketplace.json: invalid JSON — ${formatError(err)}`], live };
  }

  const failures = [];
  if (!validate(marketplace)) {
    for (const e of validate.errors ?? []) {
      failures.push(`${e.instancePath || "/"}: ${e.message}`);
    }
    return { failures, live };
  }

  const seen = new Map();
  for (const plugin of marketplace.plugins) {
    if (seen.has(plugin.name)) {
      failures.push(`duplicate plugin entry: ${plugin.name}`);
      continue;
    }
    seen.set(plugin.name, true);
    const versionSet = new Set();
    for (const v of plugin.versions) {
      if (versionSet.has(v.version)) {
        failures.push(`${plugin.name}: duplicate version ${v.version}`);
      }
      versionSet.add(v.version);
    }
    if (live) {
      for (const v of plugin.versions) {
        if (v.yanked) continue;
        const liveErrors = await checkLive(plugin.name, v);
        for (const e of liveErrors) failures.push(`${plugin.name}@${v.version}: ${e}`);
      }
    }
  }

  return { failures, live, pluginCount: marketplace.plugins.length };
}

async function checkLive(packageName, versionEntry) {
  const errors = [];
  let info;
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(versionEntry.version)}`,
    );
    if (!res.ok) {
      errors.push(`npm returned ${res.status} for the published version`);
      return errors;
    }
    info = await res.json();
  } catch (err) {
    errors.push(`npm unreachable: ${formatError(err)}`);
    return errors;
  }
  const declaredIntegrity = versionEntry.integrity;
  const actualIntegrity = info.dist?.integrity;
  if (!actualIntegrity) {
    errors.push("npm metadata has no dist.integrity");
  } else if (declaredIntegrity !== actualIntegrity) {
    errors.push(
      `integrity mismatch: declared ${declaredIntegrity} but npm reports ${actualIntegrity}`,
    );
  }
  const scripts = info.scripts ?? {};
  for (const forbidden of FORBIDDEN_LIFECYCLE_SCRIPTS) {
    if (forbidden in scripts) {
      errors.push(`package.json has forbidden lifecycle script "${forbidden}"`);
    }
  }
  if (!hasProvenanceAttestation(info)) {
    errors.push(
      "no npm provenance attestation on this version (publish with --provenance)",
    );
  }
  const meta = info.openneko ?? {};
  if (!Array.isArray(meta.requires_network)) {
    errors.push(
      'package.json must declare openneko.requires_network (array of hosts)',
    );
  } else {
    const declaredHosts = new Set(versionEntry.requires_network ?? []);
    const npmHosts = new Set(meta.requires_network);
    for (const h of npmHosts) {
      if (!declaredHosts.has(h)) {
        errors.push(
          `package.json declares network host "${h}" not present in marketplace entry`,
        );
      }
    }
  }
  return errors;
}

function hasProvenanceAttestation(info) {
  const sigstore = info.dist?.attestations?.provenance;
  if (sigstore) return true;
  const url = info.dist?.attestations?.url;
  return typeof url === "string" && url.length > 0;
}

function formatError(err) {
  return err instanceof Error ? err.message : String(err);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const live = args.includes("--live");
  validateMarketplace({ live })
    .then(({ failures, pluginCount }) => {
      if (failures.length === 0) {
        console.log(
          `marketplace: ${pluginCount ?? 0} plugin(s) valid${live ? " (live checks included)" : ""}`,
        );
        process.exit(0);
      } else {
        console.error(`marketplace: ${failures.length} validation failure(s):`);
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(`marketplace validator crashed: ${formatError(err)}`);
      process.exit(2);
    });
}

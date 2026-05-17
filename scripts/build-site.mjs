#!/usr/bin/env node
// Generates site/dist/ from marketplace.json. Pages serves site/dist/ as
// the registry root at https://open-neko.github.io/plugins/.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MARKETPLACE_PATH = path.join(ROOT, "marketplace.json");
const SCHEMA_PATH = path.join(ROOT, "schema", "marketplace.schema.json");
const SITE_STATIC = path.join(ROOT, "site", "static");
const SITE_DIST = path.join(ROOT, "site", "dist");

const REPO_URL = "https://github.com/open-neko/plugins";

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function pickLatest(versions) {
  const live = versions.filter((v) => !v.yanked);
  return live[live.length - 1] ?? versions[versions.length - 1];
}

function renderCard(plugin) {
  const latest = pickLatest(plugin.versions);
  const hosts = latest.requires_network ?? [];
  const hostChip =
    hosts.length === 0
      ? '<span class="chip network empty">no network</span>'
      : hosts
          .map((h) => `<span class="chip network">${escape(h)}</span>`)
          .join("");
  const kinds = (latest.kinds ?? [])
    .map((k) => `<span class="chip">${escape(k)}</span>`)
    .join("");
  return `
<div class="card">
  <h2>${escape(plugin.title)}</h2>
  <div class="name">${escape(plugin.name)} @ ${escape(latest.version)}</div>
  <p class="desc">${escape(plugin.description)}</p>
  <div class="meta">
    ${kinds}
    ${hostChip}
  </div>
  <div class="install">
    <code>openneko install ${escape(plugin.name)}</code>
    <a href="${escape(plugin.source)}">source</a>
  </div>
</div>`;
}

export async function buildSite() {
  mkdirSync(SITE_DIST, { recursive: true });

  const marketplace = JSON.parse(readFileSync(MARKETPLACE_PATH, "utf8"));

  // Raw artifacts the CLI fetches
  copyFileSync(MARKETPLACE_PATH, path.join(SITE_DIST, "marketplace.json"));
  copyFileSync(SCHEMA_PATH, path.join(SITE_DIST, "marketplace.schema.json"));

  // Static assets
  for (const file of readdirSync(SITE_STATIC)) {
    copyFileSync(path.join(SITE_STATIC, file), path.join(SITE_DIST, file));
  }

  const cards = (marketplace.plugins ?? []).map(renderCard).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(marketplace.name)} — OpenNeko Plugins</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>${escape(marketplace.name)}</h1>
    <p>${escape(marketplace.description)}</p>
  </header>
  <nav>
    <a href="marketplace.json">marketplace.json</a>
    <a href="marketplace.schema.json">schema</a>
    <a href="${REPO_URL}">Source</a>
    <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">Publish your own marketplace</a>
  </nav>
  <main>
    ${cards || "<p>No plugins listed yet.</p>"}
  </main>
  <footer>
    <p>This is the <strong>official</strong> OpenNeko marketplace. Listings here are written, tested, and supported by the OpenNeko team. Third-party marketplaces exist — operators trust them with <code>openneko marketplace add &lt;url&gt;</code>.</p>
    <p>Every plugin installed via OpenNeko — official or not — runs inside a microsandbox microVM with the network egress its manifest declared.</p>
    <p><a href="${REPO_URL}/blob/main/CONTRIBUTING.md">Contributing</a> · <a href="${REPO_URL}/blob/main/SECURITY.md">Security</a></p>
  </footer>
</body>
</html>
`;
  writeFileSync(path.join(SITE_DIST, "index.html"), html, "utf8");
  return { plugins: marketplace.plugins?.length ?? 0, distDir: SITE_DIST };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildSite()
    .then((r) => {
      console.log(`plugins site: built ${r.plugins} plugin card(s) → ${r.distDir}`);
    })
    .catch((err) => {
      console.error(`plugins site build failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}

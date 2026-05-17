#!/usr/bin/env node
// Generates site/dist/ from marketplace.json. Pages serves site/dist/ as
// the registry root at https://open-neko.github.io/plugins/.
//
// Aesthetic matches getneko.app: warm off-white background, near-black
// ink, signature green accent, Archivo display + Manrope body, sticky
// pill header, soft green gradient wash, hairline-bordered cards.
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
const NEKO_URL = "https://github.com/open-neko/neko";
const SITE_URL = "https://open-neko.github.io/plugins/";
const MARKETPLACE_URL = "https://open-neko.github.io/plugins/marketplace.json";

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function pickLatest(versions) {
  const live = versions.filter((v) => !v.yanked);
  return live[live.length - 1] ?? versions[versions.length - 1];
}

function renderPluginCard(plugin, index) {
  const latest = pickLatest(plugin.versions);
  const hosts = latest.requires_network ?? [];
  const networkChips =
    hosts.length === 0
      ? '<span class="chip chip-network empty">no network</span>'
      : hosts
          .map((h) => `<span class="chip chip-network">${escape(h)}</span>`)
          .join("");
  const kindChips = (latest.kinds ?? [])
    .map((k) => `<span class="chip chip-kind">${escape(k)}</span>`)
    .join("");
  const delayClass = index < 3 ? ` reveal reveal-delay-${index + 1}` : "";
  return `
        <article class="plugin-card${delayClass}">
          <header class="plugin-card-head">
            <h3 class="plugin-title">${escape(plugin.title)}</h3>
            <div class="plugin-meta-row">
              <span class="plugin-name">${escape(plugin.name)}</span>
              <span class="plugin-version">v${escape(latest.version)}</span>
            </div>
          </header>
          <p class="plugin-desc">${escape(plugin.description)}</p>
          <div class="plugin-chips">${kindChips}${networkChips}</div>
          <div class="plugin-install">
            <code>openneko install ${escape(plugin.name)}</code>
            <a class="plugin-install-link" href="${escape(plugin.source)}">view source ↗</a>
          </div>
        </article>`;
}

function shortHost(url) {
  try {
    return new URL(url).host + new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function buildSite() {
  mkdirSync(SITE_DIST, { recursive: true });

  const marketplace = JSON.parse(readFileSync(MARKETPLACE_PATH, "utf8"));

  // Raw artifacts the CLI fetches
  copyFileSync(MARKETPLACE_PATH, path.join(SITE_DIST, "marketplace.json"));
  copyFileSync(SCHEMA_PATH, path.join(SITE_DIST, "marketplace.schema.json"));

  // Static assets (style.css, cat.png)
  for (const file of readdirSync(SITE_STATIC)) {
    copyFileSync(path.join(SITE_STATIC, file), path.join(SITE_DIST, file));
  }

  const pluginCount = marketplace.plugins?.length ?? 0;
  const cards = (marketplace.plugins ?? [])
    .map((p, i) => renderPluginCard(p, i))
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(marketplace.name)} — OpenNeko Plugins</title>
  <meta name="description" content="${escape(marketplace.description)}">
  <link rel="icon" href="cat.png" type="image/png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
  <meta property="og:title" content="${escape(marketplace.name)} — OpenNeko Plugins">
  <meta property="og:description" content="${escape(marketplace.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE_URL}">
</head>
<body>
  <header class="site-header">
    <a href="${SITE_URL}" class="brand" aria-label="OpenNeko plugins home">
      <span class="brand-mark"><img src="cat.png" alt="" width="56" height="56"></span>
      <span class="brand-lockup">
        <span class="brand-name">OpenNeko Plugins</span>
        <span class="brand-tag">Sandboxed extensions for the OpenNeko worker</span>
      </span>
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="#plugins" class="nav-link">Plugins</a>
      <a href="#trust" class="nav-link">Trust model</a>
      <a href="${REPO_URL}/blob/main/CONTRIBUTING.md" class="nav-link">Publish</a>
      <a href="${REPO_URL}" class="nav-link">GitHub</a>
    </nav>
    <a class="button button-primary" href="${NEKO_URL}">Get OpenNeko</a>
  </header>

  <main class="page-shell">
    <section class="page hero-band">
      <p class="eyebrow reveal">${escape(marketplace.owner)} · ${pluginCount} plugin${pluginCount === 1 ? "" : "s"}</p>
      <h1 class="hero-title reveal reveal-delay-1">${escape(marketplace.name)}</h1>
      <p class="hero-subtitle reveal reveal-delay-2">${escape(marketplace.description)}</p>
      <div class="hero-actions reveal reveal-delay-3">
        <a class="button button-primary" href="#plugins">Browse plugins</a>
        <a class="nav-link" href="marketplace.json">marketplace.json ↗</a>
        <a class="nav-link" href="marketplace.schema.json">schema ↗</a>
      </div>

      <div class="support-rail reveal reveal-delay-3">
        <div class="support-intro">
          <p class="support-kicker">How operators install</p>
          <p class="support-summary"><code>openneko install &lt;name&gt;</code> — pulls from npm, verifies the integrity hash, boots in a microsandbox VM.</p>
        </div>
        <div class="support-item">
          <p class="support-label">Marketplace URL</p>
          <p class="support-value">${escape(shortHost(MARKETPLACE_URL))}</p>
        </div>
        <div class="support-item">
          <p class="support-label">Plugins listed</p>
          <p class="support-value">${pluginCount}</p>
        </div>
        <div class="support-item">
          <p class="support-label">Schema</p>
          <p class="support-value"><a href="marketplace.schema.json">draft 2020-12</a></p>
        </div>
      </div>
    </section>

    <section class="page section" id="plugins">
      <header class="section-heading">
        <h2 class="section-title">Plugins</h2>
        <p class="section-copy">Click <em>view source</em> for each plugin's repository. Every plugin runs inside a microsandbox microVM with outbound network limited to the hosts shown on the card — the manifest declaration is enforced at the VM boundary.</p>
      </header>
      <div class="plugin-grid">
        ${cards || '<p class="section-copy">No plugins listed yet.</p>'}
      </div>
    </section>

    <section class="trust-band" id="trust">
      <div class="page section">
        <header class="section-heading">
          <h2 class="section-title">Trust model</h2>
          <p>This is the <strong style="color: var(--accent);">official</strong> OpenNeko marketplace — written, tested, and supported by the OpenNeko team. Anyone else who ships plugins to OpenNeko users publishes their own marketplace.json. Operators trust each one explicitly.</p>
        </header>
        <div class="trust-columns">
          <div class="trust-column">
            <p class="trust-label">First-party</p>
            <h3>Listed here</h3>
            <p>The OpenNeko maintainers write these. Code lives in <a style="color: var(--accent);" href="${REPO_URL}">open-neko/plugins</a>; we yank a version if it ever turns malicious.</p>
          </div>
          <div class="trust-column">
            <p class="trust-label">Third-party</p>
            <h3>Add your own</h3>
            <p>Publish your <code>marketplace.json</code> at any HTTPS URL, then operators trust it with <code>openneko marketplace add &lt;url&gt;</code>. OpenNeko makes no representation about non-official marketplaces.</p>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="page site-footer">
    <div class="footer-main">
      <div class="footer-brand">
        <span class="brand-mark"><img src="cat.png" alt="" width="56" height="56"></span>
        <div class="footer-brand-text">
          <p class="footer-title">OpenNeko Plugins</p>
          <p class="footer-tagline">Sandboxed. Federated. Apache-2.0.</p>
        </div>
      </div>
      <nav class="footer-nav" aria-label="Footer">
        <a href="${REPO_URL}">Source ↗</a>
        <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">Contribute ↗</a>
        <a href="${NEKO_URL}">OpenNeko ↗</a>
      </nav>
    </div>
    <p class="footer-legal">Every plugin runs inside a microsandbox microVM with manifest-declared network egress. Curation is on top of that floor, not in place of it.</p>
  </footer>
</body>
</html>
`;
  writeFileSync(path.join(SITE_DIST, "index.html"), html, "utf8");
  return { plugins: pluginCount, distDir: SITE_DIST };
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

# Contributing

Two contribution paths, depending on what you want to do.

## Path A: Submit a plugin to the official marketplace

This list (`marketplace.json` in this repo) is intentionally narrow. The OpenNeko team writes, tests, and supports the plugins it endorses. We don't currently accept community submissions to the official marketplace.

If you'd like a plugin you wrote to be considered for the official list down the line, open an issue describing the plugin and the use case. We may invite a follow-up PR; we may also point you at Path B.

## Path B: Publish your own marketplace

This is how third parties ship plugins to OpenNeko users without going through us. The process:

### 1. Write the plugin

- Publish to npm under your own scope (e.g. `@acme/openneko-plugin-foo`).
- Publish with `npm publish --provenance` — operators' CLIs verify the sigstore attestation.
- `package.json` must NOT have `preinstall / install / postinstall / prepare / prepublish / prepublishOnly` scripts.
- `package.json` must have an `openneko` block:
  ```json
  "openneko": {
    "runner": "./dist/run.js",
    "kinds": ["..."],
    "requires_network": ["..."]
  }
  ```
- The runner is a single bundled file (e.g. esbuild --bundle, all deps inlined except node built-ins). The microsandbox VM does not see your npm dependencies.
- Each declared host in `requires_network` is the narrowest legitimate domain (no `*` unless necessary; never `0.0.0.0` or metadata-service IPs).

### 2. Author your `marketplace.json`

It must match `schema/marketplace.schema.json` in this repo:

```json
{
  "$schema": "https://open-neko.github.io/plugins/marketplace.schema.json",
  "name": "Acme Plugins",
  "owner": "acme",
  "description": "Plugins maintained by Acme Corp.",
  "plugins": [
    {
      "name": "@acme/openneko-plugin-foo",
      "title": "Acme Foo",
      "description": "Does the foo thing.",
      "source": "https://github.com/acme/openneko-plugin-foo",
      "versions": [
        {
          "version": "0.1.0",
          "integrity": "sha512-<base64>",
          "requires_network": ["api.acme.com"],
          "kinds": ["acme_foo"],
          "publishedAt": "2026-05-17"
        }
      ]
    }
  ]
}
```

Compute the integrity hash from the published tarball:

```sh
npm pack @acme/openneko-plugin-foo@0.1.0 --silent \
  | xargs cat \
  | openssl dgst -sha512 -binary \
  | openssl base64 -A
# prefix with `sha512-`
```

### 3. Host it at a stable URL

GitHub Pages, S3, your own server — anywhere that serves the file over HTTPS without rewriting. Don't change the URL once published; operators have pinned it in their `~/.config/openneko/marketplaces.json`.

### 4. Tell operators about it

A README, a blog post, word of mouth. Operators add it with:

```sh
openneko marketplace add https://your.site/marketplace.json
openneko install @acme/openneko-plugin-foo
```

## Yanking a version

If a published version turns out to be malicious or broken, mark it yanked in your `marketplace.json`:

```json
{
  "version": "0.1.0",
  "integrity": "sha512-...",
  "...": "...",
  "yanked": true,
  "yanked_reason": "RCE via crafted query payload (fixed in 0.1.1)"
}
```

The CLI refuses to install yanked versions.

## What our CI checks (`pnpm validate`)

Offline (every push + every PR):
- marketplace.json matches the schema
- Each `version` is a pinned semver — no ranges, no `latest`
- Each `integrity` matches the `sha512-<base64>` format
- No duplicate plugin entries; no duplicate versions within an entry
- `source` URL is hosted on github / gitlab / codeberg

Live (PRs only — pulls from npm):
- The published tarball's actual SHA-512 matches `integrity`
- The published version has npm provenance attestation
- The published `package.json` has no forbidden lifecycle scripts
- The published `package.json` declares the same `requires_network` hosts as the marketplace entry

## Two escape hatches: `draft` and `provenanceWaived`

Real life is messier than the strict CI gate. Two per-version flags let
the marketplace honestly represent the in-flight state without
permanently weakening the floor.

### `draft: true` — first publish hasn't fired yet

Use when you're adding a brand-new package whose first npm publish
hasn't happened. Common chicken-and-egg case: the publish workflow
fires off a `v*` tag push, but the marketplace.json entry has to land
first so the tag has something to publish from. Without the flag, the
PR fails `validate-live` (npm 404s on the version that doesn't exist
yet).

```json
{
  "version": "0.1.0",
  "integrity": "sha512-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa==",
  "draft": true,
  "permissions": { "...": "..." },
  "capabilities": { "...": "..." },
  "publishedAt": "2026-05-21"
}
```

The validator skips every live check for a draft entry and emits a
warning. Flip `draft: false` and pin the real integrity hash in a
follow-up PR once the publish has landed on npm.

### `provenanceWaived: true` — legacy publish without `--provenance`

Use for already-published versions that were pushed before the publish
workflow started using `--provenance`. The validator still enforces
integrity matches the npm tarball; it just skips the provenance
attestation check and emits a warning. Don't use on new versions —
bump and re-publish with provenance instead.

```json
{
  "version": "0.1.0",
  "integrity": "sha512-<real-hash-from-npm>",
  "provenanceWaived": true,
  "...": "..."
}
```

Both flags are intentionally noisy on the CI log: warnings name the
entry so a reviewer can ask "is this still the right state?" each
time the validator runs.

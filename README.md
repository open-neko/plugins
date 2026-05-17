# open-neko/plugins

Two things in one repo:

1. **First-party plugin source code** under `packages/` — `@open-neko/plugin-types` (the public contract) and `@open-neko/plugin-parallel-search` (web search via Parallel.ai's MCP). These are written, tested, and supported by the OpenNeko team and published to npm under `@open-neko/*`.

2. **The official OpenNeko marketplace** at `marketplace.json` — the catalog the `openneko` CLI consults by default when an operator runs `openneko install <name>`. It lists only the first-party plugins above. Browse it at <https://open-neko.github.io/plugins/>.

## Why both?

Federated trust. Listing a plugin in `marketplace.json` is OpenNeko's endorsement: we wrote it, we'll fix bugs in it, we'll yank a version that turns malicious. Anyone else who wants to ship plugins to OpenNeko users publishes their own `marketplace.json` somewhere stable (their own repo, a CDN, a Pages site) and tells operators to add it:

```sh
openneko marketplace add https://example.com/marketplace.json
openneko install @example/plugin-foo
```

OpenNeko has nothing to say about whether a third-party marketplace is trustworthy — that's between the operator and the publisher. What OpenNeko guarantees is that **every plugin, official or not, runs inside a microsandbox microVM whose outbound network is limited to what the plugin's manifest declared**. That's the floor; curation is on top of it.

If you want to publish your own marketplace, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Layout

```
.
├── marketplace.json                ← the official catalog (the file)
├── schema/marketplace.schema.json  ← JSON Schema every marketplace.json must match
├── scripts/
│   ├── validate-marketplace.mjs    ← offline schema check + --live npm round-trip
│   └── build-site.mjs              ← renders site/dist/ for GitHub Pages
├── site/
│   ├── static/                     ← stylesheet, assets
│   └── dist/                       ← Pages artifact (gitignored)
├── packages/
│   ├── types/                      ← @open-neko/plugin-types
│   └── parallel-search/            ← @open-neko/plugin-parallel-search
└── test/                           ← marketplace + site-build tests
```

## Local development

```sh
pnpm install
pnpm build
pnpm test
pnpm validate
pnpm site:build && open site/dist/index.html
```

## License

Apache-2.0.

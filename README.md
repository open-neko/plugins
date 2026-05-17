# open-neko/plugins

First-party plugins for [OpenNeko](https://github.com/open-neko/neko).

Every plugin runs inside a microsandbox microVM with declared-only network egress. Install via:

```
openneko plugin install <name>
```

## Packages

| Package | Purpose |
|---|---|
| `@open-neko/plugin-types` | Public types + RPC schema; depended on by every plugin and by the OpenNeko worker's plugin loader. |
| `@open-neko/plugin-parallel-search` | Web search via [Parallel.ai](https://docs.parallel.ai/integrations/mcp/search-mcp). |

## Local development

```
pnpm install
pnpm build
pnpm test
```

# Changelog

## [0.4.0](https://github.com/open-neko/plugins/compare/plugin-scalekit-v0.3.0...plugin-scalekit-v0.4.0) (2026-08-13)


### Features

* **scalekit:** v1.0.0 — deployment-scoped MCP-OAuth workspace connect + workspace tool actions ([681293a](https://github.com/open-neko/plugins/commit/681293afdfe1afa752e85673eab75ee2a1c25883))
* **scalekit:** v1.0.0 — MCP-OAuth workspace connect + workspace tool actions ([bed2f32](https://github.com/open-neko/plugins/commit/bed2f3281de979de6594735712fcd4d07e6c4251))

## [1.0.0](https://github.com/open-neko/plugins/compare/plugin-scalekit-v0.3.0...plugin-scalekit-v1.0.0) (2026-08-13)


### Features

* **scalekit:** deployment-scoped MCP-OAuth workspace connect + all Scalekit workspace tools as agent actions; SSO setup flow (environment picker, credential auto-fill, portal-link + connection polling)


### Bug Fixes

* **scalekit:** request discovered OAuth scopes (wks/env/org) instead of declared names
* **scalekit:** fetch AS metadata at /.well-known/oauth-authorization-server per RFC 9728
* **scalekit:** allow egress to *.scalekit.dev (development environments)


## [0.3.0](https://github.com/open-neko/plugins/compare/plugin-scalekit-v0.2.1...plugin-scalekit-v0.3.0) (2026-08-13)


### Features

* **scalekit,types:** add mcp-oauth deployment-scoped workspace connect + 35 MCP tool actions ([b30640e](https://github.com/open-neko/plugins/commit/b30640ecab882e5b2096f7614c06e2e63b41b443))
* **scalekit:** mcp-oauth workspace connect + MCP tool actions ([92cfe22](https://github.com/open-neko/plugins/commit/92cfe2247c574a4deedfa2c5fb1982976153980b))

## [0.4.0](https://github.com/open-neko/plugins/compare/plugin-scalekit-v0.3.0...plugin-scalekit-v0.4.0) (2026-08-13)


### Features

* **scalekit:** add deployment-scoped MCP-OAuth workspace connect (mcp-oauth flow + credentialScope) and 35 workspace-management tool actions over the hosted Scalekit MCP server; drop the thin client_credentials management actions

## [0.3.0](https://github.com/open-neko/plugins/compare/plugin-scalekit-v0.2.1...plugin-scalekit-v0.3.0) (2026-08-13)


### Features

* **scalekit:** add admin-setup actions (organization, portal link, connection state) over the Scalekit management API

## [0.2.1](https://github.com/open-neko/plugins/compare/plugin-scalekit-v0.2.0...plugin-scalekit-v0.2.1) (2026-06-02)


### Bug Fixes

* sync plugin declared version with package.json ([37831de](https://github.com/open-neko/plugins/commit/37831dea0aa3aea26f71f68483e78f18ef9baee6))

## [0.2.0](https://github.com/open-neko/plugins/compare/plugin-scalekit-v0.1.0...plugin-scalekit-v0.2.0) (2026-05-24)


### Features

* **scalekit,types,schema:** add SSO plugin contract + Scalekit provider ([b9f45e8](https://github.com/open-neko/plugins/commit/b9f45e8971973ebced012ffafde297ae1ccfb760))
* SSO plugin contract + capabilities-keyed manifest + per-scope action modes ([f71f675](https://github.com/open-neko/plugins/commit/f71f675c9585933fc693c950449e8c6f53e3df70))

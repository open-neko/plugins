# `@open-neko/channel-hud`

The reusable bidirectional channel between OpenNeko and an installed visual
demo pack. It projects modality-free OpenNeko interaction events into a signed,
versioned HUD envelope and turns signed operator decisions or utterances back
into normal OpenNeko intents.

This package is deliberately domain-neutral. It does not contain Cesium,
GraphJin configuration, demo data, scenario events, or oil/factory/defence
terminology. Those belong to the selected demo pack.

## Runtime contract

Every pack exposes its bridge on the shared Docker network as
`http://demo-channel:443`. Only one demo pack may own that alias at a time.
The pack installer writes these plugin settings:

- `HUD_CHANNEL_SECRET` — generated HMAC secret shared with the pack bridge.
- `HUD_CHANNEL_WORKSPACE` — selected pack id, such as `fujairah-live`.

Outbound deliveries use `openneko.hud.delivery.v1` and the
`X-OpenNeko-HUD-Signature` header. Inbound webhook bodies use the same header.

## Development

```sh
pnpm --filter @open-neko/channel-hud build
pnpm --filter @open-neko/channel-hud test
pnpm --filter @open-neko/channel-hud typecheck
```

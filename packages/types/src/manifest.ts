import { z } from "zod";

export const HostPattern = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^[a-z0-9*]([a-z0-9-.*])*[a-z0-9*]$/i,
    "host pattern must be a hostname (subdomains allowed via leading *.)",
  );

export const PluginCapabilities = z
  .object({
    network: z.array(HostPattern).default([]),
  })
  .default({ network: [] });

export type PluginCapabilities = z.infer<typeof PluginCapabilities>;

export const PluginManifestEntry = z.object({
  name: z
    .string()
    .min(3)
    .regex(
      /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9-_]*$/,
      "package name must be a valid npm package name",
    ),
  version: z
    .string()
    .regex(
      /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/,
      "version must be a pinned semver (no ranges)",
    ),
  integrity: z
    .string()
    .regex(/^sha512-[A-Za-z0-9+/=]+$/, "integrity must be sha512-<base64>"),
  capabilities: PluginCapabilities,
  env: z.record(z.string(), z.string()).optional(),
  /** Display name of the marketplace this plugin came from (traceability). */
  marketplace: z.string().optional(),
});

export type PluginManifestEntry = z.infer<typeof PluginManifestEntry>;

export const PluginManifest = z.object({
  schema: z.literal("https://open-neko.github.io/plugins/manifest.schema.json"),
  plugins: z.array(PluginManifestEntry),
});

export type PluginManifest = z.infer<typeof PluginManifest>;

export const PLUGIN_MANIFEST_FILE = "openneko.plugins.json";

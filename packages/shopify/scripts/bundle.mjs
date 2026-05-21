import { build } from "esbuild";

await build({
  entryPoints: ["src/run.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/run.js",
  external: [],
  banner: { js: "// @open-neko/plugin-shopify — bundled runner. Do not edit.\n" },
  logLevel: "info",
});

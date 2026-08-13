import { build } from "esbuild";

await build({
  entryPoints: ["src/run.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/run.js",
  external: [],
  banner: {
    js: "// @open-neko/channel-hud — bundled runner. Do not edit.\n",
  },
  logLevel: "info",
});

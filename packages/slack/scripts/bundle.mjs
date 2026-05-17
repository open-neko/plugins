// Bundles src/run.ts (plus its imports) into a single dist/run.js for
// execution inside the microsandbox VM. No external deps survive — the
// VM has no node_modules access.
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
    js: "// @open-neko/plugin-slack — bundled runner. Do not edit.\n",
  },
  logLevel: "info",
});

// Bundles src/run.ts (plus its imports) into a single dist/run.js.
// Why bundling: the plugin runs inside a microsandbox VM that bind-
// mounts only the workspace dir containing this file. The VM does NOT
// have access to the host's node_modules, so every import must be
// resolved at build time and inlined here. Node built-ins are kept
// external — they exist inside the VM's node runtime.
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
    js: "// @open-neko/plugin-parallel-search — bundled runner. Do not edit.\n",
  },
  logLevel: "info",
});

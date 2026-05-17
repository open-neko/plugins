import { defineConfig } from "vitest/config";

// Root-level config for tests against marketplace.json / scripts/ that
// aren't tied to any packages/* package. Per-package tests run via
// `pnpm -r test`.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 5_000,
  },
});

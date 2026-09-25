// Unit tests only: a plugin's pure parts run under node, `.test.ts` and
// `.test.tsx` alike, so neither is skipped for its extension. Two kinds
// run from a Daydream checkout instead (`pnpm test:kernel`, README.md):
// its browser tests (*.browser.test.ts[x]), which run in a browser and
// most mount Daydream's own shell harness, and its kernel tests
// (*.kernel.test.ts[x]), which run under node but need the kernel's own
// code (plugin-testing's `coreApi()`), which reaches into its src/.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["plugins/*/**/*.test.{ts,tsx}", "scripts/*.test.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.browser.test.*",
      "**/*.kernel.test.*",
    ],
  },
});

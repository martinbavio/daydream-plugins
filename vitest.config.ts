// Unit tests only: a plugin's pure parts run under node, `.test.ts` and
// `.test.tsx` alike, so neither is skipped for its extension. Its browser
// tests (*.browser.test.tsx) need Daydream's own shell harness, which
// lives in the Daydream checkout and reaches into its src/; see README.md.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["plugins/*/**/*.test.{ts,tsx}", "scripts/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.test.*"],
  },
});

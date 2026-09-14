// Unit tests only: a plugin's pure parts run under node. Its browser tests
// (*.browser.test.tsx) need Daydream's own shell harness, which lives in
// the Daydream checkout and reaches into its src/; see README.md.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["plugins/*/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.browser.test.*",
      // These build a test kernel through Daydream's harness too.
      "plugins/mbavio.html-editor/{edit,parse,reconcile,serialize}.test.ts",
    ],
  },
});

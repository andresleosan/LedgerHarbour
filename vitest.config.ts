import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["tests/setup.ts"],
    exclude: ["tests/e2e/**"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.spec.ts"],
    passWithNoTests: true,
  },
});

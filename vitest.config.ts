import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps jsx: "preserve" for Next; unit tests of client components need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    setupFiles: ["tests/setup.ts"],
    exclude: ["tests/e2e/**"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.spec.ts"],
    passWithNoTests: true,
  },
});

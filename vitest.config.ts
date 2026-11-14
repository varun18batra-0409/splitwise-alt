import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Pages are .tsx and tsconfig keeps JSX as-is for Next; the tests that call a page need it turned into plain calls.
  esbuild: { jsx: "automatic" },
  // Database tests share one SQLite file, so run test files one at a time.
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});

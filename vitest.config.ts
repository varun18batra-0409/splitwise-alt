import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Database tests share one SQLite file, so run test files one at a time.
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});

import { defineConfig, devices } from "@playwright/test";

// Loopin's end-to-end tests (see e2e/README.md).
// - One test at a time (workers: 1), so tests never trip over each other's data.
// - On failure: a screenshot, the browser's console log and a Playwright trace
//   are kept and linked from the HTML report.
// - Where it runs is set by E2E_BASE_URL (default: a server on this machine).
//   It refuses the live app; see e2e/env.ts.
export default defineConfig({
  testDir: "e2e/tests",
  outputDir: "e2e-results",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0, // a flaky test should be fixed, not hidden
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "e2e-report", open: "never" }], ["json", { outputFile: "e2e-results/results.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    ...devices["Pixel 7"], // a phone: most people use Loopin on one
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "phone", use: { browserName: "chromium" } }],
});

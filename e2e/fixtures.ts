// The tests' own `test`: Playwright's, plus the browser's console messages and
// page errors attached to the report whenever a test fails.
import { test as base, expect } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";

const lines: string[] = [];
const watched = new WeakSet<BrowserContext>();

export function watchConsole(ctx: BrowserContext) {
  if (watched.has(ctx)) return;
  watched.add(ctx);
  // The one-time group-type sheet stays out of the way of tests (the sheet's own test turns it back on).
  void ctx.addInitScript(() => {
    try {
      localStorage.setItem("lp-type-sheet-off", "1");
    } catch {
      /* storage blocked */
    }
  });
  ctx.on("console", (m) => lines.push(`[${new Date().toISOString()}] ${m.type()}: ${m.text()}`));
  ctx.on("weberror", (e) => lines.push(`[${new Date().toISOString()}] page error: ${e.error().message}`));
  // "Are you sure?" boxes (ConfirmButton) are answered Yes, as a person would.
  ctx.on("dialog", (d) => void d.accept().catch(() => undefined));
}

export const test = base.extend<{ browserLogs: void }>({
  browserLogs: [
    async ({ context, browser }, use, testInfo) => {
      watchConsole(context);
      lines.length = 0;
      // Written to the run log so a slow browser start-up can be traced to windows left open by earlier tests (iPhone, 18 Nov).
      const before = browser.contexts().length;
      if (before > 1) console.log(`open browser windows at the start of "${testInfo.title}": ${before - 1} left over`);
      await use();
      // Windows a test opened itself are closed here, as soon as the test is over, instead of waiting for the end-of-test clean-up
      // (a failed test keeps them, so its screenshots and trace still show everything). Nothing the test checks is touched.
      if (testInfo.status === testInfo.expectedStatus) {
        await Promise.all(browser.contexts().filter((c) => c !== context).map((c) => Promise.race([c.close().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))])));
      }
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("browser-console.txt", { body: lines.join("\n") || "(no console messages)", contentType: "text/plain" });
      }
    },
    { auto: true },
  ],
});

export { expect };

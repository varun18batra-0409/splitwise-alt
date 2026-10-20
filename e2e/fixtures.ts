// The tests' own `test`: Playwright's, plus the browser's console messages and
// page errors attached to the report whenever a test fails.
import { test as base, expect } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";

const lines: string[] = [];
const watched = new WeakSet<BrowserContext>();

export function watchConsole(ctx: BrowserContext) {
  if (watched.has(ctx)) return;
  watched.add(ctx);
  ctx.on("console", (m) => lines.push(`[${new Date().toISOString()}] ${m.type()}: ${m.text()}`));
  ctx.on("weberror", (e) => lines.push(`[${new Date().toISOString()}] page error: ${e.error().message}`));
  // "Are you sure?" boxes (ConfirmButton) are answered Yes, as a person would.
  ctx.on("dialog", (d) => void d.accept().catch(() => undefined));
}

export const test = base.extend<{ browserLogs: void }>({
  browserLogs: [
    async ({ context }, use, testInfo) => {
      watchConsole(context);
      lines.length = 0;
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("browser-console.txt", { body: lines.join("\n") || "(no console messages)", contentType: "text/plain" });
      }
    },
    { auto: true },
  ],
});

export { expect };

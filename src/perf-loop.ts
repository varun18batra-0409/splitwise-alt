import { monitorEventLoopDelay } from "perf_hooks";

// Speed measurement only (LOOPIN_PERF=1, the CI load-test server): how long the server's single
// thread is held up, once a second, as p99 and max milliseconds. Not used on the live app.
export function startPerfLoop() {
  if (process.env.LOOPIN_PERF !== "1") return;
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  setInterval(() => {
    console.log(`LOOPIN_PERF_LOOP ${JSON.stringify({ t: Date.now(), p99: Math.round(h.percentile(99) / 1e4) / 100, max: Math.round(h.max / 1e4) / 100 })}`);
    h.reset();
  }, 1000).unref();
}

// Runs the job one at a time: while one is still going, a new call is ignored (returns false) instead of starting a second one.
// Used for "Scan a bill": a second photo picked while the first is being read must not send a second upload.
export function singleFlight<A extends unknown[]>(job: (...args: A) => Promise<void>): (...args: A) => Promise<boolean> {
  let busy = false;
  return async (...args: A) => {
    if (busy) return false;
    busy = true;
    try {
      await job(...args);
    } finally {
      busy = false;
    }
    return true;
  };
}

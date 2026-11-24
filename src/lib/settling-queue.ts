// History lines that must be written right AFTER the line of the step that caused them (the "is square again, so C is moved out again" line
// comes after the payment's own line, not before it). The step that makes someone square (createPayment, restorePayments, an expense delete)
// can only write its own line later, so the moved-out-again line is queued against the transaction and written by logEvent right after the
// caller's line (events.ts), or by runQueued at the end of a step that writes no line of its own.

type Writer = () => Promise<unknown>;
const waiting = new WeakMap<object, Writer[]>();

export function queueAfterEvent(tx: object, write: Writer): void {
  const list = waiting.get(tx) ?? [];
  list.push(write);
  waiting.set(tx, list);
}

export async function runQueued(tx: object): Promise<void> {
  const list = waiting.get(tx);
  if (!list?.length) return;
  waiting.delete(tx); // taken first: a queued line is itself written with logEvent, which must not run it again
  for (const write of list) await write();
}

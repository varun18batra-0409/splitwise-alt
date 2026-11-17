import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// CA-10 (busy search), CB-10 (share without waiting) and B1/B2: checked in the source, since each needs a phone or a browser to run for real.
// The e2e specs (e2e/tests/51-b5-forms.spec.ts) drive the real screens; these keep the key lines from drifting.
const read = (p: string) => readFileSync(p, "utf8");

describe("B5 source checks", () => {
  it("CA-10: the people search answers 429 when busy, after checking membership, and the screen never remembers a failure", () => {
    const api = read("src/app/api/people/route.ts");
    expect(api.indexOf("if (!member) return none()")).toBeGreaterThan(-1);
    expect(api.indexOf("if (!member) return none()")).toBeLessThan(api.indexOf("status: 429"));
    const ui = read("src/components/AddPeople.tsx");
    expect(ui).toContain("if (r.ok) cache.current.set");
    expect(ui).toContain("Search is busy. Try again in a minute.");
  });
  it("CB-10: when the picture is ready, share() awaits nothing before navigator.share", () => {
    const src = read("src/components/TripShare.tsx");
    const body = src.slice(src.indexOf("async function share()"), src.indexOf("async function copy()"));
    const before = body.slice(0, body.indexOf("await navigator.share"));
    expect(before).toContain("ready.current ?? (await picture())"); // only awaits when the picture is not ready yet
    expect(before.replace("ready.current ?? (await picture())", "")).not.toContain("await");
  });
  it("CA-5: both Save buttons wait for the bill photo, and Enter says why it did not save", () => {
    const src = read("src/components/AddExpenseForm.tsx");
    expect(src.match(/disabled=\{saving \|\| scanBusy \|\| rateState\.status === "loading"\}/g)?.length).toBe(2);
    expect(src).toContain("Wait a moment: the bill photo is still being added.");
  });
  it("CA-4: the payment form lets go of the double-tap guard when it stops its own send", () => {
    expect(read("src/components/RecordPaymentForm.tsx")).toContain("releaseSubmit(e.currentTarget)");
    expect(read("src/components/DoubleTapGuard.tsx")).toContain("loopin:submit-cancelled");
    expect(read("src/components/NavProgress.tsx")).toContain("loopin:submit-cancelled");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { selectWholeAmount } from "@/lib/select-amount";

// The amount box selects its whole text on focus-in, straight away and again on the next frame and tick (iOS Safari sets the caret late).
function fakeInput(value: string) {
  const calls: string[] = [];
  return { value, calls, select: () => calls.push("select"), setSelectionRange: (a: number, b: number) => calls.push(`range ${a}-${b}`) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selectWholeAmount", () => {
  it("selects at once, then again on the next frame and the next tick while the box still has focus", () => {
    vi.useFakeTimers();
    const el = fakeInput("1500");
    const frames: (() => void)[] = [];
    vi.stubGlobal("document", { activeElement: el });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => frames.push(f));
    selectWholeAmount(el as unknown as HTMLInputElement);
    expect(el.calls).toEqual(["select", "range 0-4"]); // immediately
    frames.forEach((f) => f());
    expect(el.calls).toHaveLength(4); // the next frame
    vi.runAllTimers();
    expect(el.calls).toHaveLength(6); // the next tick
    expect(el.calls.filter((c) => c === "range 0-4")).toHaveLength(3);
  });

  it("leaves things alone when focus has moved on before the later tries", () => {
    vi.useFakeTimers();
    const el = fakeInput("1500");
    const doc = { activeElement: el as unknown };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 16));
    selectWholeAmount(el as unknown as HTMLInputElement);
    doc.activeElement = {}; // tapped elsewhere
    vi.runAllTimers();
    expect(el.calls).toEqual(["select", "range 0-4"]); // only the immediate one
  });

  it("does nothing for a missing box", () => {
    expect(() => selectWholeAmount(null)).not.toThrow();
  });
});

describe("the forms use it only on focus-in", () => {
  it("both amount boxes call it from the focus effect and never from a keystroke handler", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/components/AddExpenseForm.tsx", "src/components/RecordPaymentForm.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("selectWholeAmount(amountRef.current)");
      expect(src.match(/selectWholeAmount\(/g)?.length, f).toBe(1);
      expect(src, f).toMatch(/useLayoutEffect\(\(\) => \{\s*if \((amountFocused|focused)\) selectWholeAmount/);
    }
  });
});

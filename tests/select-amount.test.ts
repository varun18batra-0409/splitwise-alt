import { afterEach, describe, expect, it, vi } from "vitest";
import { selectWholeAmount } from "@/lib/select-amount";

// The amount box selects its whole text on focus-in, straight away and again on the next frame and tick (iOS Safari sets the caret late).
// A mouse's mouseup right after focus can collapse that selection, so the first one selects again; typing fast must never be selected over.
function fakeInput(value: string) {
  const calls: string[] = [];
  const handlers = new Map<string, Set<() => void>>();
  const el = {
    value,
    calls,
    selectionStart: 0,
    selectionEnd: value.length,
    select() {
      calls.push("select");
      el.selectionStart = 0;
      el.selectionEnd = el.value.length;
    },
    setSelectionRange(a: number, b: number) {
      calls.push(`range ${a}-${b}`);
      el.selectionStart = a;
      el.selectionEnd = b;
    },
    addEventListener: (t: string, f: () => void) => void (handlers.get(t) ?? handlers.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: () => void) => void handlers.get(t)?.delete(f),
    fire: (t: string) => [...(handlers.get(t) ?? [])].forEach((f) => f()),
    listeners: () => [...handlers.values()].reduce((n, set) => n + set.size, 0),
    collapse: () => {
      el.selectionStart = el.selectionEnd = el.value.length; // what a mouseup can do
    },
  };
  return el;
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
    vi.advanceTimersByTime(1);
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

  it("fast typing: once the text has changed, the delayed re-selects are skipped (2000 can't become 000)", () => {
    vi.useFakeTimers();
    const el = fakeInput("1500");
    const frames: (() => void)[] = [];
    vi.stubGlobal("document", { activeElement: el });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => frames.push(f));
    selectWholeAmount(el as unknown as HTMLInputElement);
    // "2" replaces the selection before the next frame, then the caret sits after it.
    el.value = "2";
    el.selectionStart = el.selectionEnd = 1;
    frames.forEach((f) => f());
    vi.runAllTimers();
    expect(el.calls).toEqual(["select", "range 0-4"]); // nothing after the first
    expect([el.selectionStart, el.selectionEnd]).toEqual([1, 1]); // caret untouched
  });

  it("desktop mouse: the first mouseup after focus selects everything again if it was collapsed; later clicks place the caret", () => {
    vi.useFakeTimers();
    const el = fakeInput("1500");
    vi.stubGlobal("document", { activeElement: el });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 16));
    selectWholeAmount(el as unknown as HTMLInputElement);
    vi.advanceTimersByTime(20); // the three selects ran while the button was held
    el.calls.length = 0;
    el.collapse(); // mouseup collapses the selection
    el.fire("pointerup");
    expect(el.calls).toEqual(["select", "range 0-4"]);
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 4]);
    expect(el.listeners()).toBe(0); // the flag is cleared
    // A later click puts the caret where it was tapped: nothing selects again.
    el.calls.length = 0;
    el.collapse();
    el.fire("mouseup");
    el.fire("pointerup");
    expect(el.calls).toEqual([]);
  });

  it("a mouseup that left the selection alone does nothing, and still clears the flag", () => {
    vi.useFakeTimers();
    const el = fakeInput("1500");
    vi.stubGlobal("document", { activeElement: el });
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 16));
    selectWholeAmount(el as unknown as HTMLInputElement);
    vi.advanceTimersByTime(20);
    el.calls.length = 0;
    el.fire("mouseup");
    expect(el.calls).toEqual([]);
    expect(el.listeners()).toBe(0);
  });

  it("a keystroke, a blur or 800 ms clears the flag, so a later click is never taken over", () => {
    for (const how of ["keydown", "input", "blur", "timeout"]) {
      vi.useFakeTimers();
      const el = fakeInput("1500");
      vi.stubGlobal("document", { activeElement: el });
      vi.stubGlobal("requestAnimationFrame", (f: () => void) => setTimeout(f, 16));
      selectWholeAmount(el as unknown as HTMLInputElement);
      vi.advanceTimersByTime(20);
      if (how === "timeout") vi.advanceTimersByTime(800);
      else el.fire(how);
      expect(el.listeners(), how).toBe(0);
      el.calls.length = 0;
      el.collapse();
      el.fire("mouseup");
      expect(el.calls, how).toEqual([]);
      vi.useRealTimers();
    }
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

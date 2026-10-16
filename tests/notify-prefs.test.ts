import { describe, expect, it } from "vitest";
import { kindGroup, parseNotify, wantsPush } from "@/lib/notify-prefs";

// Phone notifications per group: all on by default; each kind can be switched off.

describe("notification preferences", () => {
  it("everything is on by default, and broken data means the default", () => {
    expect(parseNotify("")).toEqual({ off: false, expenses: true, edits: true, payments: true, people: true });
    expect(parseNotify("{not json")).toEqual({ off: false, expenses: true, edits: true, payments: true, people: true });
    expect(parseNotify(JSON.stringify({ payments: false }))).toEqual({ off: false, expenses: true, edits: true, payments: false, people: true });
  });
  it("sorts each change into a kind", () => {
    expect(kindGroup("expense_added")).toBe("expenses");
    expect(kindGroup("expense_edited")).toBe("edits");
    expect(kindGroup("expense_deleted")).toBe("edits");
    expect(kindGroup("expense_restored")).toBe("edits");
    expect(kindGroup("payment_recorded")).toBe("payments");
    expect(kindGroup("payment_deleted")).toBe("payments");
    expect(kindGroup("members_added")).toBe("people");
    expect(kindGroup("member_left")).toBe("people");
    expect(kindGroup("group_renamed")).toBeNull();
  });
  it("respects each switch, and 'all off' blocks everything", () => {
    const p = parseNotify(JSON.stringify({ payments: false }));
    expect(wantsPush(p, "payment_recorded")).toBe(false);
    expect(wantsPush(p, "expense_added")).toBe(true);
    expect(wantsPush(p, "group_renamed")).toBe(true);
    const off = parseNotify(JSON.stringify({ off: true }));
    expect(wantsPush(off, "expense_added")).toBe(false);
    expect(wantsPush(off, "group_renamed")).toBe(false);
  });
});

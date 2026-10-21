import { describe, expect, it } from "vitest";
import { monthNumbers, seasonNow } from "@/lib/home/banner";

// The sliding cards on Home: your month in numbers, and a seasonal idea.
const IST = "Asia/Kolkata";
const exp = (day: string, amount: number, mine: number, category = "food", kind = "expense") => ({
  amount,
  kind,
  category,
  spentAt: new Date(`${day}T12:00:00.000Z`),
  createdAt: new Date(`${day}T12:00:00.000Z`),
  shares: [
    { memberId: "me", amount: mine },
    { memberId: "x", amount: amount - mine },
  ],
});

describe("your month in numbers", () => {
  const groups = [
    {
      currency: "INR",
      myId: "me",
      expenses: [
        exp("2026-10-04", 300000, 150000, "accommodation"),
        exp("2026-10-12", 80000, 40000, "food"),
        exp("2026-10-13", 20000, 10000, "food", "refund"),
        exp("2026-09-30", 999900, 500000, "food"), // last month: left out
      ],
    },
    { currency: "THB", myId: "me", expenses: [exp("2026-10-15", 100000, 50000, "transport")] },
  ];
  const toCommon = (a: number, c: string) => (c === "THB" ? Math.round(a * 2.5) : null);

  it("adds up your part this month, money back taken off, other currencies converted", () => {
    const m = monthNumbers(groups, toCommon, "INR", new Date("2026-10-20T10:00:00Z"), IST)!;
    expect(m).toMatchObject({ month: "2026-10", name: "October", wrapped: false, count: 3, currency: "INR", converted: true, top: "Stay" });
    expect(m.share).toBe(150000 + 40000 - 10000 + 125000);
  });
  it("looks back at last month in the first three days", () => {
    const m = monthNumbers(groups, toCommon, "INR", new Date("2026-11-02T10:00:00Z"), IST)!;
    expect(m).toMatchObject({ month: "2026-10", name: "October", wrapped: true });
    const s = monthNumbers(groups, toCommon, "INR", new Date("2026-10-02T10:00:00Z"), IST)!;
    expect(s).toMatchObject({ month: "2026-09", name: "September", count: 1 });
  });
  it("shows nothing for an empty month", () => {
    expect(monthNumbers(groups, toCommon, "INR", new Date("2026-12-20T10:00:00Z"), IST)).toBeNull();
  });
  it("leaves out amounts it can't convert yet, without failing", () => {
    const m = monthNumbers(groups, () => null, "INR", new Date("2026-10-20T10:00:00Z"), IST)!;
    expect(m.share).toBe(180000);
    expect(m.converted).toBe(false);
  });
});

describe("seasonal card", () => {
  it("Diwali until the day itself, then nothing until New Year plans", () => {
    expect(seasonNow(new Date("2026-10-20T10:00:00Z"), IST)).toMatchObject({ id: "diwali-2026", cover: "diwali" });
    expect(seasonNow(new Date("2026-10-20T10:00:00Z"), IST)!.href).toBe("/groups/new?name=Diwali&type=other&cover=diwali");
    expect(seasonNow(new Date("2026-11-08T19:00:00Z"), IST, "IN")).toBeNull(); // 12:30 am on 9 Nov in India
    expect(seasonNow(new Date("2026-11-20T10:00:00Z"), IST, "IN")).toBeNull();
    expect(seasonNow(new Date("2026-12-15T10:00:00Z"), IST)).toMatchObject({ id: "christmas" });
    expect(seasonNow(new Date("2026-12-28T10:00:00Z"), IST)).toMatchObject({ id: "new-year", cover: "mountain" });
    expect(seasonNow(new Date("2027-12-28T10:00:00Z"), IST)).toMatchObject({ id: "new-year" });
  });
  it("festivals show where they're celebrated", () => {
    const oct20 = new Date("2026-10-20T10:00:00Z");
    expect(seasonNow(oct20, IST, "IN")).toMatchObject({ id: "diwali-2026" });
    expect(seasonNow(oct20, "America/New_York", "US")).toBeNull();
    expect(seasonNow(new Date("2026-11-20T15:00:00Z"), "America/New_York", "US")).toMatchObject({ id: "thanksgiving-2026", cover: "dinner" });
    expect(seasonNow(new Date("2026-11-20T15:00:00Z"), IST, "IN")).toBeNull();
    expect(seasonNow(new Date("2026-12-15T15:00:00Z"), "Europe/London", null)).toMatchObject({ id: "christmas" });
  });
});

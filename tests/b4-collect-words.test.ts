import { describe, expect, it } from "vitest";
import { progress } from "@/lib/collect-rules";
import { buildStories } from "@/lib/home/stories";

// Batch B4 (D3-6, D1-5): a collection never says "everyone's in" before the organiser has checked the payments, the story's big
// number is the checked count (like the paper stamp), and the three boxes (confirmed / reported / not reported) add up to the target.
const now = new Date("2026-11-16T06:00:00Z");
const base = { now, trips: [], games: [], squared: [], collections: [], memories: [], wrapped: [] };
const entries = (n: number, per: number, statuses: string[]) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, amount: per, status: statuses[i] ?? "due" }));

function story(statuses: string[], n = statuses.length, per = 50000) {
  const p = progress(entries(n, per, statuses), per);
  const notReported = Math.max(0, p.target - p.confirmedAmount - p.reportedAmount); // the page's third box
  const [s] = buildStories({ ...base, collections: [{ id: "c1", code: "abc", title: "Gift", paid: p.paidCount, checked: p.checked, people: p.people }] });
  return { p, boxes: [p.confirmedAmount, p.reportedAmount, notReported], s };
}

describe("collection stories", () => {
  it("3 x 50,000, all reported, none checked: 0 / 150,000 / 0, 'says paid' and 0/3", () => {
    const { p, boxes, s } = story(["paid", "paid", "paid"]);
    expect(boxes).toEqual([0, 150000, 0]);
    expect(boxes.reduce((t, x) => t + x, 0)).toBe(p.target);
    expect(p.target).toBe(150000);
    expect(s.headline).toBe("Gift: 3 of 3 say they've paid");
    expect(s.big).toBe("0/3");
  });
  it("same, 2 checked: 100,000 / 50,000 / 0, '· 2 checked' and 2/3", () => {
    const { p, boxes, s } = story(["confirmed", "confirmed", "paid"]);
    expect(boxes).toEqual([100000, 50000, 0]);
    expect(boxes.reduce((t, x) => t + x, 0)).toBe(p.target);
    expect(s.headline).toBe("Gift: 3 of 3 say they've paid · 2 checked");
    expect(s.big).toBe("2/3");
  });
  it("all 3 checked: 'everyone’s in' and 3/3", () => {
    const { s } = story(["confirmed", "confirmed", "confirmed"]);
    expect(s.headline).toBe("Gift: everyone’s in");
    expect(s.big).toBe("3/3");
  });
  it("4 x 50,000, 2 reported: 0 / 100,000 / 100,000 and '2 of 4 say they've paid'", () => {
    const { p, boxes, s } = story(["paid", "paid", "due", "due"]);
    expect(boxes).toEqual([0, 100000, 100000]);
    expect(boxes.reduce((t, x) => t + x, 0)).toBe(200000);
    expect(p.target).toBe(200000);
    expect(s.headline).toBe("Gift: 2 of 4 say they've paid");
    expect(s.big).toBe("0/4");
  });
  it("the story id changes when the checked count changes (so a newly checked payment lights it up)", () => {
    expect(story(["paid", "paid", "paid"]).s.id).toBe("collect-c1-3-0");
    expect(story(["confirmed", "paid", "paid"]).s.id).toBe("collect-c1-3-1");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailParts, keepDots } from "../src/lib/format";
import { peekFix } from "../src/lib/reveal-selected";

const src = (p: string) => readFileSync(p, "utf8");
const NB = " ";

describe("round 2: pure helpers", () => {
  it("keepDots: ' · ' is glued to the words on both sides, so a line never starts or ends with the dot", () => {
    expect(keepDots("Monthly · 1st · you pay")).toBe(`Monthly${NB}·${NB}1st${NB}·${NB}you pay`);
    expect(keepDots("Rent")).toBe("Rent");
    expect(keepDots("10 Dec · Flat 402")).toBe(`10 Dec${NB}·${NB}Flat 402`);
  });
  it("emailParts: a long email can only break after '@' or '.', never inside a name or number", () => {
    expect(emailParts("bhagyalakshmi.venkataraman2026@example.co.in")).toEqual(["bhagyalakshmi.", "venkataraman2026@", "example.", "co.", "in"]);
    expect(emailParts("a@b.c").join("")).toBe("a@b.c");
  });
  // Hand-worked: the row's right edge is at 300. A chip spanning 280..380 is 100 wide with 20 showing (20%): under 40%, so it moves
  // forward until 40 show: ceil(0.4*100 - 20) + 1 = 21.
  it("peekFix: a chip sliced to a sliver is nudged until 40% of it shows; whole, hidden or well-peeking chips stay put", () => {
    expect(peekFix([[0, 100], [110, 200], [210, 270], [280, 380]], 300)).toBe(21);
    expect(peekFix([[0, 100], [110, 200], [210, 270], [280, 380]], 320)).toBe(0); // 40 of 100 show: exactly 40%
    expect(peekFix([[0, 100], [110, 200], [210, 290]], 300)).toBe(0); // the last chip is whole
    expect(peekFix([[0, 100], [110, 200], [310, 400]], 300)).toBe(0); // the next chip is fully hidden
    expect(peekFix([[0, 100], [200, 400]], 300)).toBe(0); // 50% shows
  });
});

describe("round 2: stamps only fit their words (no new words, no new shape)", () => {
  const s = src("src/components/stamps/StampArt.tsx");
  it("a long country on a trip stamp keeps its whole name (no '…')", () => {
    expect(s).not.toContain("name.slice(0, 15)");
    expect(s).toContain("{name}</div>");
  });
  it("the round stamp's name shrinks to sit inside the ring, and the waves sit below the month", () => {
    expect(s).toContain("labelPx");
    expect(s).toContain("(size * 0.6) / (label.length * 0.68)");
    expect(s).toContain("round ? 0.16 : 0.1");
  });
  it("the stamp words themselves are unchanged", () => {
    for (const w of ["BEEN THERE", "VISITED", "ARRIVED"]) expect(s).toContain(w);
  });
  it("the share picture sizes stamps by the wider boxed ones so neighbours never touch", () => {
    expect(src("src/app/passport/image/route.tsx")).toContain("cellW / 1.16");
  });
});

describe("round 2: narrow-phone rules are in place", () => {
  it("the tour tightens its spacing on short screens and balances its headlines", () => {
    const t = src("src/components/IntroTour.tsx");
    expect(t).toContain("[@media(max-height:700px)]:py-2");
    expect(t).toContain("text-balance font-display text-[32px]");
  });
  it("badges never wrap; the Games subtitle wraps instead of cutting an amount", () => {
    expect(src("src/app/groups/[id]/_components/BalancesTab.tsx")).toContain("whitespace-nowrap rounded-full border border-fg/15");
    const g = src("src/app/groups/[id]/_components/GamesTab.tsx");
    expect(g).toContain("data-game-sub");
    expect(g).not.toMatch(/block truncate text-xs text-gray-500">\s*\{potGameLabel/);
  });
  it("the weather card hangs from the whole line so it stays inside the screen", () => {
    const h = src("src/app/groups/[id]/_components/GroupHeader.tsx");
    expect(h).toContain('<details className="group/wx" data-trip-weather>');
    expect(h).toContain("w-72 max-w-full");
  });
  it("Hide details has its own row; the fee keeps its amount; Sign in stays whole", () => {
    expect(src("src/components/AddExpenseForm.tsx")).toContain('<div className="flex justify-end">\n            <button type="button" onClick={() => setShowFx(false)}');
    expect(src("src/app/groups/[id]/_components/WhyPanel.tsx")).toContain("(fee\\u00a0${money(l.fee)})");
    expect(src("src/app/(home)/page.tsx")).toContain('{"Sign\\u00a0in"}');
  });
  it("pot live: 'chips in' stays with its amount", () => {
    expect(src("src/app/groups/[id]/pot/[gameId]/page.tsx")).toContain("chips\\u00a0in\\u00a0${money(took)}");
  });
  it("Collect payer stats stack on narrow phones and the organiser's title leaves room for the sticker", () => {
    const c = src("src/app/c/[code]/page.tsx");
    expect(c).toContain("flex min-w-0 flex-col text-fg/70 min-[390px]:block");
    expect(c).toContain("break-words pr-20 font-display");
  });
  it("trip dates: Clear goes under the box so the whole date shows; country box gets its own row below 480px", () => {
    expect(src("src/components/TripDates.tsx")).toContain("clearBelow");
    expect(src("src/components/WhereTo.tsx")).toContain("grid-cols-1 gap-2 min-[480px]:grid-cols-[minmax(0,1fr)_12rem]");
  });
  it("the page leaves room under the floating bar, including the phone's bottom edge", () => {
    expect(src("src/app/layout.tsx")).toContain("pb-[calc(8rem+env(safe-area-inset-bottom))]");
  });
});

describe("round 2: the US Home slim November slide", () => {
  // The slim slide sits in a carousel whose height is the tallest slide. Its row wraps (line, then "See November"), and a wrapped
  // flex row stretches its lines to fill the tall box: the link was pushed under the floating bar. `content-center` keeps both lines
  // together in the middle.
  it("keeps the line and 'See November' together in the middle of a tall slide", () => {
    const p = src("src/app/(home)/page.tsx");
    expect(p).toContain("flex flex-1 flex-wrap content-center items-center justify-between");
    expect(p).toContain("data-month-slim");
  });
});

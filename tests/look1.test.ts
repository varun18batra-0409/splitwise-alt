import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeHighlights } from "@/lib/home/highlights";
import { homePersonLines } from "@/lib/home/money-card";
import { skipAsk } from "@/lib/home/bill-skip-words";
import { wheelMove } from "@/lib/row-wheel";
import { planSettleRow } from "@/lib/settle-row";

// Look changes, set 1 (mockups). The numbers are worked out by hand beside each test; the pages are read as text to prove the markup is there.
const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");

describe("1. Mark received is a visible button (VA3-1, VA4-1)", () => {
  it("the card draws a Mark received button beside Remind that opens the same sheet; the ⋮ menu no longer holds it", () => {
    const card = src("src/components/SettleUp.tsx");
    expect(card).toContain("markReceived?: string");
    expect(card).toContain('data-mark-received=""');
    expect(card).toContain("onClick={() => setSheetOpen(true)}");
    const page = src("src/app/settle/page.tsx");
    expect(page).toContain('markReceived={way === "in" && biggest ? "Mark received" : undefined}');
    expect(page).toContain('markReceived={iOwe ? undefined : "Mark received"}');
    expect(page).not.toContain('key: "received"');
    expect(page).toContain("settleAcrossGroups"); // the action is the same one
  });
  it("on a group's Settle up, the person being paid sees 'Mark received'; the payer still 'I’ve paid'; two other people 'Mark paid'", () => {
    const base = { closed: false, iLeft: false, payApps: 0 };
    expect(planSettleRow({ ...base, iPay: false, iAmPaid: true }).actionLabel).toBe("Mark received");
    expect(planSettleRow({ ...base, iPay: true, iAmPaid: false }).actionLabel).toBe("I’ve paid");
    expect(planSettleRow({ ...base, iPay: false, iAmPaid: false }).actionLabel).toBe("Mark paid");
  });
});

describe("2. Settle across groups: calm labels and plain amounts", () => {
  const page = src("src/app/settle/page.tsx");
  it("Remind is an outline button, labels are sentence case, no .00 forced on whole amounts", () => {
    expect(page).not.toMatch(/data-remind className=\{BIG_CREAM\}/);
    expect(page).toContain("data-remind className={BIG_OUTLINE}");
    for (const old of ["TO PAY", "TO RECEIVE", "EVEN ACROSS GROUPS", "TOTAL YOU OWE", "IN GROUPS", "YOU OWE\"", "OWE YOU\"", "SETTLED\""]) expect(page).not.toContain(old);
    expect(page).not.toContain("listMoney");
    expect(page).not.toContain("tracking-[0.14em]");
  });
});

describe("3. A finished card game has one main action (VA4-9, VD-15)", () => {
  const pot = src("src/app/groups/[id]/pot/[gameId]/page.tsx");
  it("Settle up is the one main button; Mark paid and Mark all paid sit under 'Paid at the table?'", () => {
    expect(pot).toContain("data-pot-settle");
    expect(pot).toContain("Paid at the table?");
    expect(pot.indexOf("data-pot-mark-paid")).toBeGreaterThan(pot.indexOf("data-pot-settle")); // the fold comes after the main button
    expect(pot).toContain("markGamePaidAction");
    expect(pot).toContain("recordCustomPayment");
    expect(pot).not.toContain("secondaryButtonClass"); // the old second Settle up link is gone
  });
  it("the amount is said once: when what is still owed is just the winner's result, the line under it doesn't repeat it", () => {
    expect(pot).toContain('"Not settled yet."');
    expect(pot).toContain("data-still-owed={stillOwed}");
  });
});

describe("4. Record a payment: the suggestions", () => {
  const pay = src("src/app/groups/[id]/pay/page.tsx");
  it("titled 'Suggested payments for everyone', your own first, the symbol glued to the number", () => {
    expect(pay).toContain("Suggested payments for everyone");
    expect(pay).not.toContain("Smart Settle suggests");
    expect(pay).toContain("t.from === myId || t.to === myId ? 0 : 1");
    expect(pay).toContain("glueAmounts(money(t.amount))");
  });
});

describe("5. The month card fits its content", () => {
  it("no fixed 268px height on the month card, and the row is as tall as the card showing", () => {
    expect(src("src/app/(home)/page.tsx")).not.toContain("min-h-[268px] flex-1 flex-col overflow-hidden bg-[linear-gradient");
    const banner = src("src/components/HomeBanner.tsx");
    expect(banner).toContain("items-start");
    expect(banner).toContain("slide.offsetHeight");
  });
});

describe("6. Home for someone with only one-to-one expenses (VA3-3)", () => {
  it("one named line per person, biggest first: Rohan owes 60000 (₹600), you owe Meera 25000 (₹250)", () => {
    const r = homePersonLines([
      { key: "a", name: "Meera", currency: "INR", net: -25000 },
      { key: "b", name: "Rohan", currency: "INR", net: 60000 },
    ]);
    expect(r.lines.map((l) => l.text)).toEqual(["With Rohan: owes you ₹600", "With Meera: you owe ₹250"]);
    expect(r.lines.map((l) => l.tone)).toEqual(["owed", "owe"]);
    expect(r.more).toBe(0);
  });
  it("up to three, then 'and N more'; settled people are left out", () => {
    const people = [500, 400, 300, 200, 100].map((n, i) => ({ key: `k${i}`, name: `P${i}`, currency: "INR", net: n * 100 }));
    const r = homePersonLines([...people, { key: "z", name: "Zed", currency: "INR", net: 0 }]);
    expect(r.lines).toHaveLength(3);
    expect(r.more).toBe(2); // five open people, three shown
    expect(r.aria).toContain("and 2 more");
  });
  it("Create one is a real link to a new group", () => {
    expect(src("src/app/(home)/page.tsx")).toContain('<Link href="/groups/new" className="font-medium text-fg underline underline-offset-4">Create one</Link>');
  });
});

describe("7. Guests: postcards and passport say they need sign-in (F21, VA4-13, VA1-17)", () => {
  const base = { hasMonth: false, postcardsNew: 0, billsDue: [] };
  const cards = (signedIn?: boolean) => homeHighlights({ ...base, signedIn }).flatMap((h) => (h.kind === "card" ? [h] : []));
  it("signed out: the two buttons say so and lead to sign-in, coming back to the same place", () => {
    const [postcard, passport] = cards(false).filter((h) => h.id === "fill-postcard" || h.id === "fill-passport");
    expect(postcard.button).toBe("Sign in to send postcards");
    expect(postcard.href).toBe("/signin?back=%2Fpostcards%2Fnew");
    expect(passport.button).toBe("Sign in to keep your passport");
    expect(passport.href).toBe("/signin?back=%2Fpassport");
  });
  it("signed in (or not said): exactly as before", () => {
    for (const s of [true, undefined]) {
      const [postcard, passport] = cards(s).filter((h) => h.id === "fill-postcard" || h.id === "fill-passport");
      expect([postcard.button, postcard.href, passport.button, passport.href]).toEqual(["Write one", "/postcards/new", "Open your passport", "/passport"]);
    }
  });
  it("'All square' is on the square card once", () => {
    const m = src("src/lib/home/money-card.ts");
    expect(m).toContain('label: "All square", text: "Nothing to settle"');
  });
});

describe("8. Your own avatar is your initial", () => {
  it("Avatar never draws a Y for you", () => {
    const ui = src("src/components/ui.tsx");
    expect(ui).not.toContain('you ? "Y"');
    expect(ui).toContain('(name.trim().charAt(0) || "?").toUpperCase()');
    expect(src("src/app/groups/[id]/pot/[gameId]/page.tsx")).toContain("avatarName={nameOf(t.from)}");
  });
});

describe("9. Collect page at 320: the counts never sit over the bar", () => {
  it("the counts and amounts can wrap onto their own line; no nowrap squeeze; the three organiser figures stack under 360", () => {
    const c = src("src/app/c/[code]/page.tsx");
    expect(c).toContain("flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm");
    expect(c).not.toContain('<span className="whitespace-nowrap">{lines.confirmed}</span>');
    expect(c).toContain("grid grid-cols-1 gap-2 text-center min-[360px]:grid-cols-3");
  });
});

describe("10 and 11. Postcard composer", () => {
  it("Flip and Next are pinned to the bottom (sticky) and the tool row fades at the edge with room around the labels", () => {
    const comp = src("src/app/postcards/new/Composer.tsx");
    expect(comp).toContain("data-composer-actions");
    expect(comp).toContain("sticky bottom-0");
    const row = src("src/app/postcards/new/editor/ToolRow.tsx");
    expect(row).toContain("px-2.5 text-[11px]");
    expect(row).toContain("maskImage: fade");
  });
});

describe("13. Moments at 320", () => {
  it("smaller thumbnails under 360, captions limited to two lines, the name can wrap", () => {
    const f = src("src/components/MomentsFeed.tsx");
    expect(f).toContain("max-[359px]:h-[60px] max-[359px]:w-[72px]");
    expect(f).toContain("line-clamp-2");
  });
});

describe("14. Join page", () => {
  it("the app card comes before one grouped block of small print", () => {
    const j = src("src/app/join/[code]/page.tsx");
    expect(j.indexOf("<GetAppButton")).toBeLessThan(j.indexOf("data-join-footnote"));
    expect(j).toContain("data-join-footnote");
    expect(j).toContain("Loopin keeps count. It never touches your money.");
  });
});

describe("15. Sideways rows on a computer (VD-1)", () => {
  it("wheel: a vertical turn of 120 moves a row at 0 of 500 to 120; at the end or the start it lets the page scroll", () => {
    expect(wheelMove({ deltaX: 0, deltaY: 120, scrollLeft: 0, max: 500 })).toBe(120);
    expect(wheelMove({ deltaX: 0, deltaY: 120, scrollLeft: 450, max: 500 })).toBe(500); // clamped to the end
    expect(wheelMove({ deltaX: 0, deltaY: 120, scrollLeft: 500, max: 500 })).toBeNull();
    expect(wheelMove({ deltaX: 0, deltaY: -120, scrollLeft: 0, max: 500 })).toBeNull();
    expect(wheelMove({ deltaX: 0, deltaY: -120, scrollLeft: 50, max: 500 })).toBe(0);
    expect(wheelMove({ deltaX: 80, deltaY: 10, scrollLeft: 50, max: 500 })).toBeNull(); // already sideways
    expect(wheelMove({ deltaX: 0, deltaY: 120, scrollLeft: 0, max: 0 })).toBeNull(); // nothing to scroll
  });
  it("the five rows are wrapped and marked", () => {
    for (const f of ["ChipRow", "CoverPicker", "HomeGroups", "SideRow", "TripRow"]) {
      const s = src(`src/components/${f}.tsx`);
      expect(s, f).toContain("<RowControls");
      expect(s, f).toContain("data-row-scroller");
    }
  });
});

describe("16. Mouse-only hover and cursor (VD-2)", () => {
  it("all of it sits inside @media (hover: hover) and (pointer: fine)", () => {
    const css = src("src/app/globals.css");
    const at = css.indexOf("Mouse and trackpad only");
    expect(at).toBeGreaterThan(0);
    const tail = css.slice(at);
    expect(tail).toContain("@media (hover: hover) and (pointer: fine)");
    expect(tail.indexOf("cursor: pointer")).toBeGreaterThan(tail.indexOf("@media (hover: hover) and (pointer: fine)"));
    expect(tail.indexOf(".row-arrow {\n    display: none;")).toBeGreaterThan(0); // hidden unless the media query says a mouse is here
  });
});

describe("17. iPhone bottom bar is solid", () => {
  it("no see-through colour and no blur on the bar", () => {
    const css = src("src/app/globals.css");
    const bar = css.slice(css.indexOf(".glass-bar {"), css.indexOf("}", css.indexOf(".glass-bar {")));
    expect(bar).toContain("background: #1f1f24;");
    expect(bar).not.toContain("backdrop-filter");
    expect(bar).not.toContain("rgb(31 31 36 / 0.94)");
  });
});

describe("18. Skip this time asks first (batch 6)", () => {
  it("names the bill and the month, in the founder's words", () => {
    expect(skipAsk("Rent", "2026-10")).toBe("Skip Rent for October 2026? It won’t be added for that month.");
    expect(skipAsk("Wi-Fi", "2027-01")).toBe("Skip Wi-Fi for January 2027? It won’t be added for that month.");
    expect(skipAsk("Rent", "")).toBe("Skip Rent this time?"); // no month to name: the plain question, never "that month"
  });
  it("the bill page keeps the hidden month field and the same changeBill action, and only the confirm button submits", () => {
    const page = src("src/app/groups/[id]/bills/[billId]/page.tsx");
    expect(page).toContain('<input type="hidden" name="period" value={skipPeriod} />');
    expect(page).toContain('<input type="hidden" name="command" value="skip" />');
    expect(page).toContain("<AskFirstButton");
    const ask = src("src/components/AskFirstButton.tsx");
    expect(ask).toContain('type="submit"');
    expect(ask).not.toContain("window.confirm");
  });
});

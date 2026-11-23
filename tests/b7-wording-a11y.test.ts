import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { settlePaymentsHeadline } from "@/lib/settle-ui";
import { cardWord } from "@/lib/home/group-card";
import { countdownCard, placeOf } from "@/lib/countdown";
import { opensLine } from "@/lib/postcards/opens";
import { viewerEventText } from "@/lib/left-view";
import { blockText, unblockText, BLOCK_LIST } from "@/lib/block-text";
import { progressLines } from "@/lib/collect-rules";
import { resultSentence } from "@/lib/add-expense-sentence";
import { rateDateLabel } from "@/lib/conversion";

// Batch B7 (one name per thing, plain words) and B9 (screen readers, keyboard). Pure functions are called; screens are read as text
// (the way batch-c-static.test.ts does), so a later edit that brings an old phrase back fails here and says where.

const root = path.resolve(__dirname, "..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" || name === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const src = ["src/app", "src/components", "src/lib"].flatMap((d) => walk(path.join(root, d))).map(rel);
const offenders = (needle: string | RegExp, only: (f: string) => boolean = () => true) =>
  src.filter(only).filter((f) => (typeof needle === "string" ? read(f).includes(needle) : needle.test(read(f))));

describe("Settle up headline: 'you’re all square' only when every payment is yours", () => {
  const me = "me";
  it("3 payments, only 1 involves me: everyone’s square", () => {
    const t = [{ from: "r", to: me }, { from: "a", to: "k" }, { from: "k", to: "z" }];
    expect(settlePaymentsHeadline(t, me)).toBe("3 payments and everyone’s square");
  });
  it("every payment is mine (I pay or get paid): you’re all square", () => {
    expect(settlePaymentsHeadline([{ from: me, to: "a" }, { from: "r", to: me }], me)).toBe("2 payments and you’re all square");
  });
  it("one payment, not mine: 'One payment and everyone’s square'; one of mine: 'One payment and you’re all square'", () => {
    expect(settlePaymentsHeadline([{ from: "a", to: "r" }], me)).toBe("One payment and everyone’s square");
    expect(settlePaymentsHeadline([{ from: me, to: "r" }], me)).toBe("One payment and you’re all square");
  });
  it("the Settle page uses it, and no longer says 'you’re all square' by itself", () => {
    const page = read("src/app/groups/[id]/settle/page.tsx");
    expect(page).toContain("settlePaymentsHeadline(transfers, myId)");
    expect(page).not.toContain("and you’re all square`");
  });
});

describe("banned phrases (old wording that must not come back)", () => {
  it("'Coming back to you' is not on any screen (Home says 'Net · you’re owed')", () => {
    expect(offenders("Coming back to you", (f) => f.startsWith("src/app") || f.startsWith("src/components"))).toEqual([]);
  });
  it("'plus any later change to your own share' is gone (a leaver’s share can’t change after they left)", () => {
    expect(offenders(/plus any later change to (your|their) own share/i)).toEqual([]);
    expect(read("src/app/groups/[id]/_components/LeftBanner.tsx")).toContain("Your share can’t change after that.");
  });
  it("'my cut' (first person, slang) is gone: it is 'your share'", () => {
    expect(offenders(/\bmy cut\b/i)).toEqual([]);
  });
  it("nothing tells people to 'Tap App' on Home (the install button moved to You)", () => {
    expect(offenders(/tap App on the Home/i)).toEqual([]);
    expect(offenders(/Tap App\b/)).toEqual([]);
  });
  it("the FAQ no longer answers 'Do my friends need to sign up?' with a plain Yes", () => {
    const faq = read("src/app/faq/page.tsx");
    const m = /q: "Do my friends need to sign up\?", a: "([^"]*)"/.exec(faq);
    expect(m).not.toBeNull();
    expect(m![1].startsWith("Yes")).toBe(false);
    expect(m![1]).toContain("no sign-up is needed");
    // 23 Nov: friends join with just a name; signing in is optional (it keeps groups across devices; postcards and the passport need it).
    expect(m![1].startsWith("No.")).toBe(true);
    expect(m![1]).toContain("with just a name");
    expect(m![1]).toContain("postcards and the passport");
  });
  it("no amount is written with a space after ₹, and no 'Anything Goes' in capitals", () => {
    // (comment lines may quote "₹ 99" as an example of what people type; only real text counts)
    expect(src.filter((f) => read(f).split("\n").some((l) => !/^\s*\/\//.test(l) && /₹ \d/.test(l)))).toEqual([]);
    expect(offenders("Anything Goes")).toEqual([]);
  });
  it("the two old 'doesn’t move money' sentences are one: PAYMENT_LINE", () => {
    expect(offenders("No money will be transferred")).toEqual([]);
    expect(offenders("doesn’t transfer money")).toEqual([]);
    expect(offenders("Loopin doesn't move money")).toEqual([]);
  });
  it("Collect uses two words for its two states: 'Says paid' and 'Checked' (no 'Reported, awaiting check')", () => {
    expect(offenders("Reported, awaiting check")).toEqual([]);
    expect(offenders(/>\s*Confirmed\s*\{/)).toEqual([]);
    expect(progressLines({ confirmedAmount: 60000, reportedAmount: 30000 } as never, "INR")).toEqual({ confirmed: "Checked ₹600", reported: "Says paid ₹300" });
    expect(progressLines({ confirmedAmount: 0, reportedAmount: 0 } as never, "INR")).toEqual({ confirmed: "Checked ₹0", reported: null });
  });
  it("one name for the add-expense choice: 'Only some' (never 'Selected people'); the report is 'Trip report' / 'Group report'", () => {
    expect(offenders("Selected people")).toEqual([]);
    expect(read("src/app/groups/[id]/_components/GroupSummary.tsx")).toContain('"Group report"');
  });
  it("games say 'Balances' (the tab’s real name), not 'Money owed'", () => {
    expect(offenders("Money owed", (f) => !f.startsWith("src/lib/settle-row") && f !== "src/lib/foreign-part.ts")).toEqual([]);
  });
  it("People: the greyed button keeps its own name and one line says what to settle first", () => {
    const page = read("src/app/groups/[id]/people/page.tsx");
    expect(page).not.toMatch(/>\s*Settle up first\s*</);
    expect(page).toContain("To remove ${m.name}, settle up first.");
    expect(page).toContain("To leave, settle up first.");
  });
  it("the tour: no 'paisa or cent' for everyone, no 'Three steps' for a seven-slide tour", () => {
    expect(read("src/components/IntroTour.tsx")).not.toContain("paisa or cent");
    expect(offenders("Three steps, one minute")).toEqual([]);
  });
});

describe("the new words, worked by hand", () => {
  it("a group nobody has spent in is 'No expenses yet', never 'Settled'", () => {
    expect(cardWord(0, 0)).toEqual({ text: "No expenses yet", tone: "square" });
    expect(cardWord(0, 3)).toEqual({ text: "Settled", tone: "square" });
    expect(cardWord(0)).toEqual({ text: "Settled", tone: "square" }); // unknown count keeps the old word
    expect(cardWord(500, 0).text).toBe("You’re owed"); // money wins over the count
    expect(cardWord(-500, 2).text).toBe("You owe");
  });

  it("'Pack tonight' only on the last night (1 day to go); 3 days to go says something else", () => {
    const kickers = (days: number) => Array.from({ length: 14 }, (_, slot) => countdownCard("Goa trip", { kind: "before", days }, slot)!.kicker);
    for (const days of [2, 3, 4, 5, 7, 8, 14, 30, 60, 90]) expect(kickers(days), `${days} days to go`).not.toContain("Pack tonight");
    expect(kickers(1)).toContain("Pack tonight");
    expect(kickers(3)).toContain("Time to pack");
  });

  it("a group named 'Phuket, trip over' is the place Phuket", () => {
    expect(placeOf("Phuket, trip over")).toBe("Phuket");
    expect(placeOf("Goa trip 2026")).toBe("Goa");
    expect(placeOf("Weekend in Pune")).toBe("Weekend in Pune");
  });

  it("a sealed postcard says the date once; a time only when it is not midnight for the reader", () => {
    const midnightIst = new Date("2026-12-31T18:30:00Z"); // 00:00 on 1 January in India
    expect(opensLine(midnightIst, "Asia/Kolkata")).toBe("Opens 1 January 2027");
    expect(opensLine(midnightIst, "Europe/London")).toBe("Opens 31 December 2026 at 18:30 your time");
  });

  it("a payment to the viewer reads 'paid you' in their own list; nothing else is touched", () => {
    expect(viewerEventText("paid Varun ₹5,000", "Varun")).toBe("paid you ₹5,000");
    expect(viewerEventText("paid Asha ₹5,000", "Varun")).toBe("paid Asha ₹5,000");
    expect(viewerEventText("added Varun’s dinner", "Varun")).toBe("added Varun’s dinner");
    expect(viewerEventText("paid Varun ₹5,000", "")).toBe("paid Varun ₹5,000");
  });

  it("block and unblock list the same things", () => {
    for (const word of ["postcards", "passports", "nudges", "moments", "notifications", "Want to go"]) expect(BLOCK_LIST).toContain(word);
    expect(blockText("Meera")).toContain(BLOCK_LIST);
    expect(unblockText("Meera")).toBe(`Unblock Meera? These work between you again: ${BLOCK_LIST}.`);
  });

  it("no full stop after the last amount in the Add expense result line", () => {
    const inr = (m: number) => `₹${m / 100}`;
    const parts = resultSentence({ payers: [{ memberId: "me", amount: 240000 }], total: 240000, pairs: [{ from: "a", to: "me", amount: 180000 }], myId: "me", myShare: 60000, inShares: true, justMe: false, refund: false, name: (id) => (id === "me" ? "You" : id), money: inr });
    expect(parts).toEqual([
      { text: "You paid ₹2400.", amount: "", tone: "plain" },
      { text: "You get back", amount: "₹1800", tone: "owed" },
    ]);
  });

  it("the saved-rate note reads 'Rate of 14 Oct 2026, taken when it was saved'", () => {
    const nice = (d: string) => (d === "2026-10-14" ? "14 Oct 2026" : d);
    expect(rateDateLabel({ rateDate: "2026-10-14", expenseDay: "2026-10-13", saved: true }, nice)).toBe("Rate of 14 Oct 2026, taken when it was saved");
  });
});

describe("accessibility (B9): nothing changes on screen", () => {
  it("SA-3: a postcard's message is in the page's text, outside the turn-over button", () => {
    const f = read("src/components/postcards/PostcardView.tsx");
    expect(f).toContain("data-postcard-text");
    expect(f).toContain("{back.message}");
    expect(f).toContain('className="sr-only"');
  });
  it("CA-9: the Add expense, bill and join errors are announced; the chip rows have names", () => {
    const form = read("src/components/AddExpenseForm.tsx");
    expect(form).toContain('<p role="alert" className="rounded-xl bg-red-50');
    expect(form).toContain('role="group" aria-labelledby="who-paid-label"');
    expect(form).toContain('id="who-paid-label"');
    expect(form).toContain('role="group" aria-labelledby="how-split-label"');
    expect(read("src/components/BillForm.tsx")).toContain('<p role="alert"');
    expect(read("src/components/JoinByLink.tsx")).toContain('<p role="alert"');
  });
  it("CB-13: the story viewer moves focus to Close, traps Tab, and says each slide aloud", () => {
    const f = read("src/components/Stories.tsx");
    expect(f).toContain("useFocusTrap(true, { start: () => closeBtn.current })");
    expect(f).toContain("ref={closeBtn}");
    expect(f).toContain('aria-live="polite" data-story-live');
  });
  it("CB-14: the ⋮ menu is a plain disclosure (no menu roles it does not honour), and the route arrow is not read", () => {
    const f = read("src/components/SettleUp.tsx");
    expect(f).not.toContain('role="menu"');
    expect(f).not.toContain('role="menuitem"');
    expect(f).not.toContain('aria-haspopup="menu"');
    expect(f).toContain("<span aria-hidden>{sheet.from} → {sheet.to}</span>");
  });
  it("CB-15: a friend's passport is not called 'your passport' for a screen reader", () => {
    const f = read("src/components/PassportBook.tsx");
    expect(f).toContain('own ? "Open your passport"');
    expect(f).toContain('own ? "Your details"');
  });
  it("CB-17 / VA2-37 (already in place): small buttons are 44 px tall and the avatar letter is hidden from readers", () => {
    expect(read("src/components/PotBuyIn.tsx")).toContain("min-h-11");
    expect(read("src/components/ui.tsx")).toMatch(/aria-hidden className=\{`flex h-9 w-9/);
    expect(read("src/app/c/[code]/page.tsx")).toContain("const chip = \"inline-flex min-h-11");
  });
});

describe("the CI screenshot steps fail when the script itself fails (not only on '✗' lines)", () => {
  const ci = read(".github/workflows/ci.yml");
  const step = (id: string) => {
    const i = ci.indexOf(`id: ${id}`);
    const run = ci.indexOf("run: |\n", i) + "run: |\n".length;
    const end = ci.indexOf("\n      - name:", run);
    return ci.slice(run, end).replace(/^ {10}/gm, "");
  };
  it("both steps keep the script's own exit code and treat a non-zero one as a failure", () => {
    for (const id of ["shots_ios", "shots_desktop"]) {
      const s = step(id);
      expect(s, id).toContain("code=${PIPESTATUS[0]}");
      expect(s, id).toContain('[ "${code:-0}" -ne 0 ]');
      expect(s, id).not.toMatch(/screenshots\.ts[^\n]*\|\| true/);
    }
  });
});

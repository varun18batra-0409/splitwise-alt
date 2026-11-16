import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CLEAR_BOTH_NOTE, CLEAR_BOTH_SUBTITLE, evenCaption, isEvenItem, type CrossItem } from "@/lib/cross-settle";
import { skippedLine } from "@/lib/insights";
import { cardFeeLabel } from "@/lib/activity";
import { leaverDepositRows, leaverGoalTotal, wellDoneWords } from "@/lib/leaver-rows";
import { TONE } from "@/lib/settle-ui";

const src = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");

const even: CrossItem = {
  key: "acc:a", name: "Asha", net: 0, converted: false,
  parts: [
    { groupId: "g1", groupName: "Thailand trip", currency: "INR", fromId: "me1", toId: "a1", amount: 420000, iPay: true },
    { groupId: "g2", groupName: "Flat 402", currency: "INR", fromId: "a2", toId: "me2", amount: 420000, iPay: false },
  ],
};

describe("1. Even across groups", () => {
  it("is recognised by net 0 and worded as nothing to pay (owed side first)", () => {
    expect(isEvenItem(even)).toBe(true);
    expect(isEvenItem({ net: -1 })).toBe(false);
    expect(evenCaption(even)).toBe("Owed ₹4,200 in Flat 402, owe ₹4,200 in Thailand trip. Nothing to pay.");
    expect(CLEAR_BOTH_SUBTITLE).toMatch(/Nothing is paid/);
    expect(CLEAR_BOTH_NOTE).toMatch(/No money moves/);
    expect(TONE.even).toBe("text-fg");
  });
  it("the page: To pay is only net < 0, Even has its own section, Clear both uses settleAcrossGroups, no Payment details for net 0", () => {
    const page = src("src/app/settle/page.tsx");
    expect(page).toContain("settleItems.filter((it) => it.net < 0)");
    expect(page).toContain('sectionHead("EVEN ACROSS GROUPS"');
    expect(page).toContain('label: even ? "Clear both"');
    expect(page).toContain("action={settleAcrossGroups}");
    expect(page).toContain('way === "out" && it.net < 0');
    expect(page).not.toMatch(/it\.net <= 0/);
  });
});

describe("2. Together line and Recap", () => {
  it("Together is shown only with two or more groups", () => {
    const page = src("src/app/settle/page.tsx");
    expect(page).toMatch(/parts\.length > 1 && \(\s*<p[^>]*data-cross-total/);
  });
  it("Recap line has singular and plural", () => {
    expect(skippedLine(0)).toBe("");
    expect(skippedLine(1)).toBe("1 expense in another currency isn’t counted yet");
    expect(skippedLine(2)).toBe("2 expenses in other currencies aren’t counted yet");
    expect(src("src/app/search/page.tsx")).toContain("skipped: ins.skipped");
  });
});

describe("3. Card fee, People colours, Y", () => {
  it("card fee label uses the real percentage", () => {
    expect(cardFeeLabel(300)).toBe("incl. 3% card fee");
    expect(cardFeeLabel(350)).toBe("incl. 3.5% card fee");
    expect(cardFeeLabel(0)).toBe("");
  });
  it("People: amounts coloured, words stay grey; own avatar is Y", () => {
    const people = src("src/app/groups/[id]/people/page.tsx");
    expect(people).toContain('<span className="text-owed">{money(bal)}</span>');
    expect(people).toContain('<span className="text-owe">{money(-bal)}</span>');
    expect(people).toContain("<Avatar name={m.name} you={me} />");
    expect(src("src/components/ui.tsx")).toContain('you ? "Y"');
  });
});

describe("4. Leaver rows", () => {
  const members = [{ id: "a", name: "Asha" }, { id: "d", name: "Dev", leftAt: new Date() }];
  it("deposit: only held shares of people who left, so rows add up to the total (hand: 42,000 + 30,000)", () => {
    const shares = [
      { memberId: "a", amount: 4200000, status: "held" },
      { memberId: "d", amount: 3000000, status: "held" },
      { memberId: "d", amount: 99, status: "returned" },
    ];
    expect(leaverDepositRows(shares, members)).toEqual([{ memberId: "d", name: "Dev", amount: 3000000 }]);
    expect(leaverDepositRows([], members)).toEqual([]);
  });
  it("goal: the tile total is what leavers set aside (hand: 3,000 + 2,000)", () => {
    expect(leaverGoalTotal([{ memberId: "d", amount: 300000 }, { memberId: "a", amount: 900000 }, { memberId: "d", amount: 200000 }], members)).toBe(500000);
    expect(leaverGoalTotal([{ memberId: "a", amount: 1 }], members)).toBe(0);
  });
  it("wording follows the count", () => {
    expect(wellDoneWords(1)).toBe("Well done, you.");
    expect(wellDoneWords(2)).toBe("Well done, both of you.");
    expect(wellDoneWords(3)).toBe("Well done, all of you.");
    expect(src("src/app/groups/[id]/goals/[goalId]/page.tsx")).not.toContain("both of you.</>");
  });
});

describe("5. Money colours only for money", () => {
  it("countdown is off-white with no glow", () => {
    const f = src("src/components/TripCountdown.tsx");
    expect(f).toContain('const bigColor = "text-fg"');
    expect(f).toContain('const glow = ""');
    expect(f).not.toContain("255,171,107");
  });
  it("payer's recorded amount and Paid stamp are neutral; the person paid stays green", () => {
    const f = src("src/components/PayScreens.tsx");
    expect(f).toContain('const paidByMe = from === "You"');
    expect(f).toContain('paidByMe ? "text-fg" : "text-owed"');
  });
  it("labels, status lines, icons and errors carry no money colour", () => {
    for (const [file, bad] of [
      ["src/components/PrivacySafety.tsx", "emerald"],
      ["src/components/AddPeople.tsx", "text-owed"],
      ["src/components/BillForm.tsx", 'text-owed" : "text-gray-500'],
      ["src/components/GroupTypeSheet.tsx", "text-owed"],
      ["src/components/NewGroupForm.tsx", "text-owed"],
      ["src/components/JoinByLink.tsx", "text-owe"],
    ] as const) expect(src(file), file).not.toContain(bad);
    expect(src("src/components/AddExpenseForm.tsx")).not.toContain('font-medium text-owed"');
  });
  it("the Collect coin has no rupee sign", () => {
    expect(src("src/components/StoryArt.tsx")).not.toMatch(/<text[^>]*>\s*₹\s*<\/text>/);
  });
});

describe("6. Screenshots", () => {
  it("are taken at 390 and 320", () => {
    const f = src("scripts/screenshots.ts");
    const at = f.indexOf("This batch's screens");
    expect(at).toBeGreaterThan(0);
    const block = f.slice(at);
    expect(block).toContain("for (const w of [390, 320] as const)");
    for (const n of ["settle-even", "people", "expenses-card-fee", "deposit-left", "goal-left", "recap"]) expect(block).toContain(`["${n}"`);
    expect(block).toContain("b11b${w}-${n}");
  });
});

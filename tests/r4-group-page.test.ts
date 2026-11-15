import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// R4, read as text: the group page's money ticket and the Settle up cards are Home's boarding pass (one component, not a second design),
// the Memories tab has no money, and the header is mockup 03. (The screens themselves are checked by the e2e and UAT runs.)
const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");

describe("one boarding pass everywhere money is a ticket (rule A4)", () => {
  const home = src("src/components/HomeMoney.tsx");
  const group = src("src/app/groups/[id]/_components/GroupSummary.tsx");
  const pay = src("src/components/PayScreens.tsx");
  it("the group's money box is the card from before the mockups (founder, 15 Nov): You're owed, the amount, one Settle up, the line with Why?", () => {
    for (const s of ["You’re owed", "You owe", "Your balance", "Settle up", "data-summary-line", "Why?", "payments clear", "glass rounded-[26px]"]) expect(group).toContain(s);
    // No boarding pass on the group page: none of the pass pieces.
    for (const s of ["TicketShell", "PassRoute", "PassFields", "PassStack", "data-notch", "data-barcode", "border-dashed"]) expect(group).not.toContain(s);
  });
  it("Settle up cards (group and all groups) are drawn by PayTicket, which is the same pass: From and To codes, barcode, notches, fields", () => {
    expect(pay).toContain("<TicketShell");
    expect(pay).toContain("<PassRoute from={endCode(from)} to={endCode(to)} />");
    expect(pay).toContain("barcode>");
    expect(pay).toContain("<PassFields");
    expect(pay).toContain("<Amount");
    expect(pay).not.toContain("border-l-2 border-dashed"); // its own perforation is gone: TicketShell draws it
    expect(src("src/app/settle/page.tsx")).toContain("<PayTicket");
    expect(src("src/app/groups/[id]/settle/page.tsx")).toContain("<PayTicket");
  });
  it("the pass has sentence-case labels and one plane taking off: From, To, never capitals forced by CSS", () => {
    expect(home).toContain(">From</span>");
    expect(home).toContain(">To</span>");
    expect(home).not.toContain("uppercase");
    expect(group).not.toContain("uppercase");
    expect(pay).not.toContain("uppercase");
  });
  it("one cream button on the Overview: Add expense is outline, the money box's Settle up is cream", () => {
    const o = src("src/app/groups/[id]/_components/OverviewTab.tsx");
    expect(o).toContain("OUTLINE");
    expect(o).not.toContain("CREAM");
  });
  it("exact amounts: the money box formats with exactMoney (formatMoney), not the rounding helper", () => {
    expect(group).toContain("exactMoney(Math.abs(mine), group.currency)");
    expect(group).not.toContain("overviewMoney");
  });
});

describe("Memories", () => {
  const mem = src("src/app/groups/[id]/_components/MemoriesTab.tsx");
  it("shows no money: no currency formatter, no balance, no ticket", () => {
    for (const s of ["formatMoney", "exactMoney", "overviewMoney", "data-group-balance", "data-net-balance", "MoneyTicket", "₹"]) expect(mem).not.toContain(s);
  });
  it("one main button, Add a moment, only when you can add; Relive trip is an outline", () => {
    expect(mem).toContain("Add a moment");
    expect(mem).toContain("trip && canAdd");
    // The trip stamp is the passport's own StampCard; its one button is an outline link, and the "Relive trip" label comes from passport-cards.
    expect(mem).toContain("<StampCard");
    const been = src("src/components/BeenCard.tsx");
    expect(been).toContain("border border-fg/25");
    expect(been).not.toContain("${CREAM}");
    expect(src("src/lib/passport-cards.ts")).toContain('label: "Relive trip"');
    expect(mem.match(/\$\{CREAM\}/g)?.length).toBe(1);
  });
  it("postcards: only the ones loaded for you, sealed ones say only when they open", () => {
    expect(mem).toContain("Sealed until");
    expect(mem).toContain("p.row ? ");
    expect(src("src/lib/group-memories.ts")).toContain("OR: [{ fromId: accountId }, { toId: accountId }]");
  });
  it("moments photos are plain <img> (private), through MomentsFeed", () => {
    expect(src("src/components/MomentsFeed.tsx")).not.toContain("next/image");
    expect(mem).toContain("<MomentsFeed");
  });
  it("the small strip stays on Overview and opens Memories; deleting a moment returns to Memories", () => {
    expect(src("src/app/groups/[id]/_components/OverviewTab.tsx")).toContain("<MomentsStrip");
    expect(src("src/app/groups/[id]/_components/MomentsStrip.tsx")).toContain("?tab=memories");
    expect(src("src/app/moment-actions.ts")).toContain("?tab=memories&removed=1");
  });
});

describe("header (mockup 03) and the tabs", () => {
  const head = src("src/app/groups/[id]/_components/GroupHeader.tsx");
  it("trips: back, name with the switcher, a more menu, a rounded photo card, people and countdown line, faces, a labelled Invite pill", () => {
    for (const s of ["data-group-photo", "rounded-[20px]", "More about this group", 'aria-label="Add people"', "data-invite-pill", "data-group-line", "Invite"]) expect(head).toContain(s);
    expect(head).toContain("Group settings");
  });
  it("tap targets are 44px (back, menu, faces, Invite) and the group name is never cut to one line", () => {
    expect(head).toContain("h-11 w-11");
    expect(head).toContain("min-h-11");
    expect(head).toContain("line-clamp-2 text-[24px]");
    expect(head).not.toContain("truncate text-[24px]");
  });
  it("the page's tab bar has four equal columns that fit 320 px, with a 44px target", () => {
    const page = src("src/app/groups/[id]/page.tsx");
    expect(page).toContain("repeat(${tabs.length}, minmax(0, 1fr))");
    expect(page).toContain("min-h-11");
  });
  it("flats keep their Bills and List behind the Overview tiles, with ‹ Overview to come back", () => {
    expect(src("src/app/groups/[id]/page.tsx")).toContain("‹ Overview");
    expect(src("src/app/groups/[id]/_components/ThisMonthTab.tsx")).toContain("?tab=bills");
  });
  it("People keeps Manage people and the hooks its tests read; the People page goes back to it", () => {
    expect(src("src/app/groups/[id]/_components/PeopleTab.tsx")).toContain("Manage people");
    expect(src("src/app/groups/[id]/people/page.tsx")).toContain('back={`/groups/${group.id}?tab=balances`}');
  });
});

describe("no boarding pass inside a group (founder, 15 Nov)", () => {
  it("the group's Settle up draws every card plain (initial, who pays whom, the amount); Home's all-groups Settle up keeps the pass", () => {
    const g = src("src/app/groups/[id]/settle/page.tsx");
    const tickets = g.match(/<PayTicket\n\s+plain\n/g) ?? [];
    expect(tickets.length).toBe((g.match(/<PayTicket\b/g) ?? []).length);
    expect(src("src/app/settle/page.tsx")).not.toMatch(/<PayTicket\n\s+plain/);
    const pay = src("src/components/PayScreens.tsx");
    expect(pay).toContain("data-plain-card");
    expect(pay).toContain("if (plain) {");
  });
});

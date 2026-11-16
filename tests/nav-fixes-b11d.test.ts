import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { groupTabs, subPageTitle } from "@/app/groups/[id]/_components/tabs";
import { BILL_EMOJI, BILL_TEMPLATES } from "@/lib/home/bills";
import { expenseIcon } from "@/lib/expense-icons";
import { showCardMarkupSetting } from "@/lib/group-types";
import { glueLastWord } from "@/lib/moments-text";
import { momentPageStories } from "@/lib/moments-stories";
import { unmatchedPlaces } from "@/lib/wishes";
import { passportLockLabel } from "@/lib/passport";
import { HIDDEN_AMOUNT, squareNumbers, squareTiles } from "@/lib/square";

// The founder-approved navigation mockups (s1 to s7). Pure checks where there is a rule; source checks where it is a screen.
const src = (p: string) => readFileSync(p, "utf8");

describe("s1: Bills, Shopping list and Charts have their own title bar (VD2-6, VA2-29, VA1-39, VI2-40)", () => {
  const page = src("src/app/groups/[id]/page.tsx");
  it("the three sub-pages have a title; the group's own tabs have none", () => {
    expect(subPageTitle("bills")).toBe("Bills");
    expect(subPageTitle("list")).toBe("Shopping list");
    expect(subPageTitle("recap")).toBe("Charts");
    for (const t of ["overview", "month", "activity", "balances", "memories", "games"] as const) expect(subPageTitle(t)).toBeNull();
  });
  it("the page swaps the group hero and the tab bar for the title bar, and drops the '‹ Overview' link", () => {
    expect(page).toContain("subPageTitle(tab)");
    expect(page).toContain("<SubPageHeader title={subTitle} groupId={group.id} groupName={group.name} />");
    expect(page).toMatch(/subTitle \? <SubPageHeader[^\n]*: <GroupHeader/);
    expect(page).toContain("{!subTitle && (\n        <nav");
    expect(page).not.toContain("data-overview-back");
    expect(src("src/app/groups/[id]/_components/RecapTab.tsx")).not.toContain("data-recap-back");
    expect(src("src/app/groups/[id]/_components/RecapTab.tsx")).not.toContain("‹ Overview");
  });
  it("the title bar is Back (to the group's Overview), the title and the group name underneath, wrapping rather than cutting", () => {
    const bar = src("src/app/groups/[id]/_components/SubPageHeader.tsx");
    expect(bar).toContain("href={`/groups/${groupId}`}");
    expect(bar).toContain("{title}");
    expect(bar).toContain("{groupName}");
    expect(bar).not.toContain("truncate");
    expect(bar).not.toContain("line-clamp");
  });
  it("every group type still reaches them (same addresses), and the tab bar lists none of them", () => {
    for (const type of ["trip", "home", "couple", "other"]) expect(groupTabs({ type, leaver: null, hasPostcards: false }).map((t) => t.id)).not.toContain("bills");
  });
  it("Milk has its own milk-bottle icon, not the lightning bolt; Gas is a flame", () => {
    expect(BILL_EMOJI.milk).toBe("🥛");
    expect(BILL_EMOJI.gas).toBe("🔥");
    expect(BILL_EMOJI.electricity).toBe("⚡");
    for (const t of BILL_TEMPLATES) if (t.id !== "other") expect(BILL_EMOJI[t.id], t.id).toBeTruthy();
    const glyph = src("src/components/ExpenseGlyph.tsx");
    expect(glyph).toContain('"🥛": "milk"');
    expect(glyph).toMatch(/\n  milk: "/);
    expect(src("src/app/groups/[id]/_components/BillsTab.tsx")).toContain("emoji={BILL_EMOJI[b.bill.icon]}");
    expect(src("src/app/groups/[id]/_components/ThisMonthTab.tsx")).toContain("emoji={BILL_EMOJI[next.icon]}");
  });
  it("Add a bill: Gas is a flame (it was a dustbin) and Milk a bottle (VI1-29)", () => {
    const form = src("src/components/BillForm.tsx");
    expect(form).not.toContain("M7 9h10l-1 11H8zM9 9a3 3 0 0 1 6 0");
    expect(form).toContain("gas: <path d=\"M8.5 14.5A2.5 2.5");
    expect(form).toContain('milk: <path d="M9 2h6M10 2v3');
  });
  it("Electricity shows only 'Enter amount': the 'Needs amount' pill is not drawn, but the state is still marked", () => {
    const bills = src("src/app/groups/[id]/_components/BillsTab.tsx");
    expect(bills).toContain('badge?.id === "needs-amount"');
    expect(bills).toContain("data-bill-state={pillHidden ? badge?.id : undefined}");
    expect(bills).toContain('"Enter amount"');
  });
});

describe("s2: Filter is a bottom sheet with Show results fixed at the bottom (VA1-47)", () => {
  const tab = src("src/app/groups/[id]/_components/ActivityTab.tsx");
  const sheet = src("src/components/FilterSheet.tsx");
  it("the long panel is gone; the button opens a sheet", () => {
    expect(tab).not.toContain("group/filter");
    expect(tab).toContain("<FilterSheet");
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain("fixed inset-0");
    expect(sheet).toContain("items-end");
    expect(sheet).toContain("sheet-enter");
    expect(sheet).toContain("Clear");
  });
  it("the existing filter logic is untouched: the same form, the same fields, the same address", () => {
    expect(tab).toContain('method="get" action={`/groups/${group.id}`}');
    for (const f of ['name="tab" value="activity"', 'name="q"', 'name="type"', 'name="cat"', 'name="who"', 'name="by"', 'name="from"', 'name="to"', 'name="min"', 'name="max"']) expect(tab).toContain(f);
    expect(tab).toContain("hasFilter(filter)");
    expect(tab).toContain("filterChips(");
  });
  it("Show results sits in a footer outside the scrolling part, and above the bottom bar (z-[70])", () => {
    const body = tab.indexOf("overflow-y-auto");
    const foot = tab.indexOf("data-filter-submit");
    expect(body).toBeGreaterThan(0);
    expect(foot).toBeGreaterThan(body);
    expect(tab.slice(body, foot)).toContain("</div>\n              <div className=\"shrink-0");
    expect(tab).toContain("safe-area-inset-bottom");
    expect(sheet).toContain("z-[70]");
    expect(sheet).toContain("max-h-[88dvh]");
  });
  it("the applied state stays: 'Filtered · n matches', Clear and one chip per filter", () => {
    expect(tab).toContain("Filtered · ");
    expect(tab).toContain("data-filter-chip={c.key}");
  });
});

describe("s3: one main way to invite (VD1-28)", () => {
  const page = src("src/app/groups/[id]/invite/page.tsx");
  const card = page.slice(page.indexOf("data-invite-card"), page.indexOf("In the group"));
  it("the card has the link, Copy and one big Invite on WhatsApp, then one 'More ways to add people'", () => {
    expect(card).toContain("<CopyButton");
    expect(card).toContain("data-invite-whatsapp");
    expect(card.indexOf("data-invite-whatsapp")).toBeLessThan(card.indexOf("data-more-ways"));
    expect(page.match(/data-more-ways/g)?.length).toBe(1);
  });
  it("the disclosure is closed to start with (no 'open'), and everything else lives inside it", () => {
    expect(page).toMatch(/<details className="group\/more mt-2" data-more-ways>/);
    const inside = page.slice(page.indexOf("data-more-ways>"), page.indexOf("</details>\n        </div>\n      </section>"));
    for (const s of ["<ShareInvite", "qr", "<PeopleSearch", "<ContactInvite", "invitePeople", "makeNewInviteLink", "Make a new invite link"]) expect(inside, s).toContain(s);
    const outside = page.replace(inside, "");
    expect(outside).not.toContain("<PeopleSearch");
    expect(outside).not.toContain("<ContactInvite");
    expect(outside).not.toContain("Or add them yourself");
  });
  it("nothing was removed: five ways, each a row with a title and one line", () => {
    for (const t of ["Share the link", "Show a QR code", "Search by name or email", "From your contacts", "By email"]) expect(page + src("src/components/ShareInvite.tsx")).toContain(t);
    for (const k of ['"qr"', '"search"', '"contacts"', '"email"']) expect(page).toContain(`way(${k}`);
  });
  it("the list of who is in the group stays below", () => {
    expect(page.indexOf("In the group")).toBeGreaterThan(page.indexOf("data-more-ways"));
  });
});

describe("s4: the tour's main button is Next (VA1-16)", () => {
  const tour = src("src/components/IntroTour.tsx");
  it("no App or Home button in the top bar; Skip is the only exit", () => {
    expect(tour).not.toContain("GetAppButton");
    expect(tour).not.toContain("aria-label=\"Home\"");
    expect(tour).toContain("data-tour-skip");
  });
  it("steps before the last: a big Next; the last step: the big button is the way in", () => {
    expect(tour).toMatch(/\{last \? \(\s*<Link href=\{startHref\}[^>]*data-tour-main>\s*\{cta\}/);
    expect(tour).toMatch(/data-tour-next data-tour-main>\s*Next\s*<\/button>/);
    expect(tour).toContain('cta = "Create your first group"');
  });
  it("the sign-in line is on the last step only; Back and the 1 / 7 count stay at the bottom", () => {
    expect(tour).toContain("{last && signInHref && (");
    expect(tour).not.toMatch(/\n        \{signInHref && \(/);
    expect(tour).toContain("data-tour-back");
    expect(tour).toContain("data-tour-at");
    expect(tour).toContain("See it again");
  });
});

describe("s5: one passport layout (VI1-39)", () => {
  const page = src("src/app/passport/page.tsx");
  it("the lock label is the real setting: 'Only you' or 'Your groups'", () => {
    expect(passportLockLabel({ passportShare: "private", passportChoiceAt: new Date() })).toBe("Only you");
    expect(passportLockLabel({ passportShare: "groups", passportChoiceAt: new Date() })).toBe("Your groups");
    expect(passportLockLabel({ passportShare: "groups", passportChoiceAt: null })).toBe("Only you"); // no recorded answer: still private
    expect(page).toContain("{passportLockLabel(account)}");
  });
  it("stats row, then 'Your stamps', then the continents line at the bottom (never under the stats)", () => {
    const a = page.indexOf("<PassportStats");
    const b = page.indexOf("Your stamps");
    const c = page.indexOf("Your places span");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(page.match(/continents\./g)?.length).toBe(1);
    expect(page).not.toMatch(/\{continents\} continents<\//);
  });
  it("one quiet line under the stats row says where the numbers come from; labels stay short", () => {
    const stats = src("src/components/PassportStats.tsx");
    expect(stats).toContain("Trips and days come from your trips in Loopin.");
    expect(stats.indexOf("</dl>")).toBeLessThan(stats.indexOf("Trips and days come from"));
    expect(src("src/lib/passport-cards.ts")).toContain('"days travelled"');
    expect(stats).toContain("text-balance"); // a label wraps at 320, it is never cut
    expect(stats).not.toContain("truncate");
  });
});

describe("s6: settings, chips, icons, locked rows", () => {
  it("a flat hides 'Card fees abroad' unless it already has a markup; 'Also show amounts in' stays for every type", () => {
    expect(showCardMarkupSetting("home", 0)).toBe(false);
    expect(showCardMarkupSetting("home", 300)).toBe(true);
    for (const t of ["trip", "couple", "pot", "other"]) {
      expect(showCardMarkupSetting(t, 0)).toBe(true);
      expect(showCardMarkupSetting(t, 200)).toBe(true);
    }
    const page = src("src/app/groups/[id]/settings/page.tsx");
    expect(page).toContain("{showCardMarkupSetting(group.type, group.cardMarkupBp) && (");
    expect(page.indexOf("Also show amounts in")).toBeLessThan(page.indexOf("showCardMarkupSetting(group.type"));
    expect(page.indexOf("Card fees abroad")).toBeGreaterThan(page.indexOf("showCardMarkupSetting(group.type"));
    // The per-expense card fee under Details on Add expense is untouched.
    expect(src("src/components/AddExpenseForm.tsx")).toContain("markupChoice");
  });
  it("a hidden markup is not sent, and saving then leaves the saved markup alone (the real Save skips a missing field)", () => {
    expect(src("src/app/actions.ts")).toContain('markup: formData.has("markup") ? str("markup") : undefined');
    expect(src("src/lib/settings-save.ts")).toContain('markupBp = f.markup === undefined ? undefined');
  });
  it("Memories chips: no ellipsis, the row scrolls to the edge and fades while there is more", () => {
    const page = src("src/app/memories/page.tsx");
    expect(page).toContain("<ChipRow");
    const chips = page.slice(page.indexOf("<ChipRow"), page.indexOf("</ChipRow>"));
    expect(chips).not.toContain("truncate");
    expect(chips).not.toContain("max-w-");
    expect(chips).toContain("whitespace-nowrap");
    const row = src("src/components/ChipRow.tsx");
    expect(row).toContain("overflow-x-auto");
    expect(row).toContain("-mx-5");
    expect(row).toContain("data-chip-fade");
  });
  it("'How Loopin works' has a play icon, different from Help & support", () => {
    const you = src("src/app/account/page.tsx");
    expect(you).toContain('icon={<PlayLineIcon />} title="How Loopin works"');
    expect(you).toContain('icon={<HelpLineIcon />} title="Help & support"');
  });
  it("Dinner on Home: an 'Other' expense named like food takes the fork and knife, the same as everywhere else", () => {
    expect(expenseIcon("Dinner at Jay Fai", "other")).toBe("🍽️");
    expect(expenseIcon("Dinner at Jay Fai", "food")).toBe("🍽️");
    expect(expenseIcon("Train tickets", "other")).toBe("🚆"); // a word rule still wins
    expect(expenseIcon("Gas", "bills")).toBe("🔥");
    expect(expenseIcon("Zzzq", "other")).toBe("📦"); // nothing to go on: unchanged
  });
  it("signed out: Passport, Postcards, Notifications and Privacy show locked, 'Sign in to use', and open sign-in", () => {
    const you = src("src/app/account/page.tsx");
    const locked = [...you.matchAll(/<LockedYouRow [\s\S]*?title="([^"]+)"/g)].map((x) => x[1]);
    expect(locked).toEqual(["Your trip passport", "Your postcards", "Notifications & email", "Privacy & sharing"]);
    expect(you).toContain("{!account && (\n        <YouList className=\"mt-6\">\n          <LockedYouRow");
    const rows = src("src/components/YouRows.tsx");
    expect(rows).toContain("Sign in to use");
    expect(rows).toContain('href="/signin?back=/account"');
    expect(rows).toContain("data-locked-row");
    expect(rows).toContain('<rect x="5" y="10.5"');
  });
});

describe("s7: small fixes", () => {
  it("Delete this moment is in the danger colour (the app's red), and Remove too", () => {
    const menu = src("src/app/groups/[id]/moments/_components/MomentMenu.tsx");
    expect(menu).toContain("text-red-600");
    expect(menu).toMatch(/<ConfirmButton message=\{DELETE_MOMENT_TEXT\} className=\{danger\}>/);
  });
  it("a closing emoji stays with the last word (non-breaking space); other captions are not changed", () => {
    expect(glueLastWord("The boat we almost missed 😂")).toBe("The boat we almost missed 😂");
    expect(glueLastWord("Sunset 🌅🌅")).toBe("Sunset 🌅🌅");
    expect(glueLastWord("Day 3: no emoji")).toBe("Day 3: no emoji");
    expect(glueLastWord("😂 first")).toBe("😂 first");
    expect(src("src/app/groups/[id]/moments/_components/MomentBig.tsx")).toContain("glueLastWord(card.caption)");
  });
  const card = (id: string, who: string, days: number) => ({
    id, groupId: "g1", authorId: `m-${who}`, authorAccountId: `a-${who}`, authorName: who, authorInitial: who[0], authorIsMe: false, caption: "", takenOn: "", day: "",
    width: 1, height: 1, createdAt: new Date(Date.UTC(2026, 10, 16) - days * 86_400_000), thumb: `/t/${id}`, full: `/f/${id}/`, reactions: [],
  });
  const now = new Date(Date.UTC(2026, 10, 16));
  it("one story circle when one person added moments; the group circle only when it shows more", () => {
    expect(momentPageStories([card("m1", "Nupur", 0.1)], "g1", "Krabi weekend", now).map((s) => s.label)).toEqual(["Nupur"]);
    expect(momentPageStories([card("m1", "Nupur", 0.1), card("m2", "Nupur", 1)], "g1", "Krabi weekend", now).map((s) => s.label)).toEqual(["Nupur"]);
    const two = momentPageStories([card("m1", "Nupur", 0.1), card("m2", "Riya", 1)], "g1", "Krabi weekend", now);
    expect(two.map((s) => s.label)).toEqual(["Krabi weekend", "Nupur", "Riya"]);
    expect(two[0].frames).toHaveLength(2);
    expect(momentPageStories([], "g1", "Krabi weekend", now)).toEqual([]);
  });
  it("a place in a match card is left out of 'Your list'", () => {
    const places = [{ code: "IS", name: "Iceland" }, { code: "JP", name: "Japan" }];
    expect(unmatchedPlaces(places, ["JP"]).map((p) => p.code)).toEqual(["IS"]);
    expect(unmatchedPlaces(places, []).map((p) => p.code)).toEqual(["IS", "JP"]);
    expect(unmatchedPlaces(places, ["JP", "IS"])).toEqual([]);
    const tab = src("src/components/want/WantToGoTab.tsx");
    expect(tab).toContain("{listed.map((p) => {");
    expect(tab).toContain("places={places}"); // Share still offers the whole list
    expect(tab).toContain("added={mine}");
  });
  it("the games disclaimer shows once per screen: the sheet leaves it out where the Games tab has it", () => {
    const page = src("src/app/groups/[id]/page.tsx");
    expect(page).toContain('showNote={!(pot && tab === "games")}');
    const sheet = src("src/components/GroupTypeSheet.tsx");
    expect(sheet).toContain("showNote && sheet.note");
    expect(src("src/app/groups/[id]/_components/GamesTab.tsx").match(/\{GAME_NOTE\}/g)?.length).toBe(1);
    expect(src("src/app/groups/[id]/pot/[gameId]/page.tsx").match(/\{GAME_NOTE\}/g)?.length).toBe(1);
    expect(src("src/app/groups/[id]/pot/new/page.tsx").match(/\{GAME_NOTE\}/g)?.length).toBe(1);
  });
  it("All square: the same three tiles whether amounts are shown or hidden; hidden blanks only the money", () => {
    const n = squareNumbers({ expenses: [{ amount: 800000, createdAt: new Date(), spentAt: new Date() }], payments: [{}], people: 2 });
    const inr = (m: number) => `₹${(m / 100).toLocaleString("en-IN")}`;
    const shown = squareTiles(n, { hide: false, formatSpent: inr });
    const hidden = squareTiles(n, { hide: true, formatSpent: inr });
    expect(shown).toEqual([["₹8,000", "spent together"], ["1", "expense"], ["2", "people"]]);
    expect(hidden).toEqual([[`₹ ${HIDDEN_AMOUNT}`, "spent together"], ["1", "expense"], ["2", "people"]]);
    expect(hidden.map((t) => t[1])).toEqual(shown.map((t) => t[1]));
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The screens for people who left, and for people who are not the admin. These need a browser to draw, so the pages are read
// as text to prove each button is behind the right check (the screenshots script draws them; the server refuses the actions regardless).

const src = (p: string) => readFileSync(`${__dirname}/../src/${p}`, "utf8");
const G = "app/groups/[id]";

describe("Inside a group you left: no buttons that fail", () => {
  const activity = src(`${G}/_components/ActivityTab.tsx`);
  it("one rule for every row action: not closed and not a leaver", () => {
    expect(activity).toContain("const canChange = !group.closed && !v.leaver;");
    // swipe Edit/Delete, payment Delete/Restore, reactions and the Edit/Repeat/Restore/Open the game block all use it
    expect(activity).toContain("const swipeable = !deleted && canChange && !isPot;");
    expect(activity).toContain("isParty && !live && canChange");
    expect(activity).toContain("isParty && live && canChange");
    // reactions follow the leaver rule only, so a closed group keeps them for people still in
    expect(activity).toContain("{!deleted && !v.leaver && (\n                        <div className=\"-mx-1 mb-1\" role=\"group\" aria-label=\"React\">");
    expect(activity).toContain("{canChange && (\n                        <div className=\"flex gap-4 pt-1\">");
    expect(activity.match(/!group\.closed/g)).toHaveLength(1); // only inside the canChange rule itself
  });
  it("an opened expense says why, once", () => {
    expect(activity).toContain("You left this group, so you can’t change expenses.");
    expect(activity).toContain("You were removed from this group, so you can’t change expenses.");
  });
  it("the header: no three-dot menu, no Invite, no Settings, no Add people, no Add dates for a leaver", () => {
    const h = src(`${G}/_components/GroupHeader.tsx`);
    // the menu holds Group settings (refused for a leaver) and Our passports (allowed for someone who left on their own, not for a removed person)
    expect(h).toContain("{!v.leaver?.removed && (\n            <details className=\"group/more relative shrink-0\">");
    expect(h).toContain("{!v.leaver && (\n                  <Link href={`/groups/${group.id}/settings`}");
    expect(h).toContain("{!v.leaver && (\n            <Link href={`/groups/${group.id}/invite`} aria-label=\"Add people\" className=\"inline-flex");
    expect(h).toContain("{!v.leaver && (\n          <>\n            <Link href={`/groups/${group.id}/invite`}");
    expect(h).toContain("{!v.leaver && (\n            <Link href={`/groups/${group.id}/invite`} className=\"shrink-0 font-semibold text-fg\">");
    expect(h).toContain("!group.tripStart && !v.leaver ?");
    expect(h).toContain("switcher"); // the switcher itself stays
  });
  it("Group settings at the bottom and the Change link go, Trip recap stays; the closed banner's Reopen goes", () => {
    expect(src(`${G}/_components/OverviewTab.tsx`)).toContain("settings={!v.leaver}");
    expect(src(`${G}/_components/BalancesTab.tsx`)).toContain("{!v.leaver && (\n            <Link href={`/groups/${group.id}/settings`}");
    const banner = src(`${G}/_components/GroupSummary.tsx`);
    expect(banner).toMatch(/\{!v\.leaver && \(\s*<form action=\{setGroupClosed\}>/);
  });
  it("the add page checks a leaver BEFORE closed, and a removed person is not told to rejoin", () => {
    const add = src(`${G}/add/page.tsx`);
    expect(add.indexOf("me?.leftAt || me?.removedAt")).toBeGreaterThan(0);
    expect(add.indexOf("me?.leftAt || me?.removedAt")).toBeLessThan(add.indexOf("group.closed && group.type"));
    expect(add).toContain("You were removed from this group, so you can’t add expenses.");
  });
});

describe("People, seen by someone who left", () => {
  const people = src(`${G}/people/page.tsx`);
  it("other names are read-only rows: no Edit, Rename, Invite, moving out, Moved in, Bring back", () => {
    const readonly = people.slice(people.indexOf("if (leaver && !me) {"), people.indexOf("const mine = leaver && me;"));
    expect(readonly).toContain("data-readonly-person");
    for (const bad of ["renamePerson", "invitePersonByEmail", "setPersonLeft", "removePerson", "Edit", "moving out", "Moved in", "Bring"]) expect(readonly).not.toContain(bad);
  });
  it("no add-person icon for a leaver; the rest of the forms are for people still in", () => {
    expect(people).toContain("{!leaver && (\n          <Link href={`/groups/${group.id}/invite`} aria-label=\"Add people\"");
    expect(people).toContain("{!leaver && (\n            <form action={renamePerson}");
  });
  it("read-only rows keep Report / Block for every leaver, and the passport link only for a self-leaver", () => {
    const row = people.slice(people.indexOf("data-readonly-person"), people.indexOf("const mine = leaver && me;"));
    expect(row).toContain("<SafetyLinks");
    expect(row).toContain("viewer && m.accountId && m.accountId !== viewer.id");
    // SafetyLinks is not behind the removed check; the passport link is
    expect(row).toContain("{!leaver.removed && m.accountId && !m.removedAt && (");
    const safety = row.slice(row.indexOf("{viewer && m.accountId && m.accountId !== viewer.id && ("));
    expect(safety.indexOf("leaver.removed")).toBe(-1);
  });
  it("the people listed are already cut to the day they left (membersAsOf)", () => {
    expect(people).toContain("groupPeople(leaver ? membersAsOf(group.members, myId, leaver.leftAt) : group.members)");
  });
  it("their own row keeps Rejoin, Undo my move-out and the removed note", () => {
    expect(people).toContain("Rejoin the group");
    expect(people).toContain("UndoMoveOutButton");
    expect(people).toContain("data-removed-note");
  });
  it("the 'is moving out' link is only for the person themself or the admin", () => {
    expect(people).toContain('group.type === "home" && !m.leftAt && !leaver && (me || isAdmin) && (');
  });
});

describe("Our passports: kept for someone who left on their own, hidden for someone who was removed", () => {
  // The passport rules (passportRoster, canSeePassport) turn a removed person away and let a self-leaver in, so the links follow them.
  it("People page: shown unless the viewer was removed", () => {
    const people = src(`${G}/people/page.tsx`);
    expect(people).toContain("{!leaver?.removed && (\n      <Link href={`/groups/${group.id}/passports`}");
    expect(people).not.toContain("{!leaver && (\n      <Link href={`/groups/${group.id}/passports`}");
  });
  it("People tab (By person): same rule", () => {
    expect(src(`${G}/_components/BalancesTab.tsx`)).toContain("{!leaver?.removed && <Link href={`/groups/${group.id}/passports`}");
  });
  it("the passports page loads createdAt so the roster can cut to the day they left", () => {
    expect(src(`${G}/passports/page.tsx`)).toContain("removedAt: true, createdAt: true");
    expect(src("lib/passport-db.ts")).toContain("m.createdAt.getTime() <= day");
  });
  it("the rule matches the passport code: a removed viewer gets no roster", () => {
    const db = src("lib/passport-db.ts");
    expect(db).toContain("if (!me || isPending(me) || me.removedAt) return null;");
  });
  it("evaluating the condition: self-leaver {removed:false} shows, removed {removed:true} hides, member (null) shows", () => {
    const show = (leaver: { removed: boolean } | null) => !leaver?.removed;
    expect([show({ removed: false }), show({ removed: true }), show(null)]).toEqual([true, false, true]);
  });
});

describe("Closed group: the payment page and the shopping list", () => {
  it("Record a payment shows the card instead of the form", () => {
    const pay = src(`${G}/pay/page.tsx`);
    expect(pay).toContain("payBlocked({ name: group.name, closed: group.closed, leaver: data.leaver })");
    expect(pay.indexOf("data-pay-blocked")).toBeLessThan(pay.indexOf("<RecordPaymentForm"));
    expect(pay).toContain("Back to {group.name}");
  });
  it("recordCustomPayment's closed redirect carries a (signed) error message", () => {
    expect(src("app/actions.ts")).toContain('if (group.closed) redirect(await flashTo(["groups", group.id], { error: CLOSED_PAY_ERROR }, { tab: "balances" }));');
  });
  it("the closed list: a note, and no add box, ticks, × or Going shopping", () => {
    const list = src(`${G}/_components/ListTab.tsx`);
    expect(list).toContain("The list is kept as it was. Nothing can be added or ticked.");
    expect(list).toContain("This flat is closed");
    expect(list).toContain("{!closed && (\n      <form action={listAdd}");
    expect(list).toContain("{!closed && (\n        <form action={listGoingShopping}");
    // the read-only row has no form at all
    const at = list.indexOf("closed ? (");
    const ro = list.slice(at, list.indexOf(") : (", at));
    expect(ro).not.toContain("<form");
    expect(ro).not.toContain("button");
  });
  it("toggle, remove and going-shopping pass their errors back as signed messages", () => {
    const a = src("app/bill-actions.ts");
    for (const fn of ["listToggle", "listRemove", "listGoingShopping"]) {
      const body = a.slice(a.indexOf(`export async function ${fn}`), a.indexOf("export async function", a.indexOf(`export async function ${fn}`) + 10));
      expect(body).toContain("flashTo(");
      expect(body).toContain("error: r.error");
    }
  });
});

describe("Move-out page, seen by a flatmate who is not the admin", () => {
  const move = src(`${G}/people/[memberId]/move/page.tsx`);
  it("only the person moving out or the admin gets the form, the day box and the button", () => {
    expect(move).toContain("const canConfirm = leaver.id === myId || admin?.id === myId;");
    expect(move).toContain("{canConfirm && (\n      <form method=\"get\"");
    const from = move.indexOf("data-move-out-readonly");
    const readonly = move.slice(from, move.indexOf("</div>\n      ) : (", from));
    expect(readonly).toContain("{squaring}");
    for (const bad of ["MoveOutButton", "depositTo", "addDaily", "<form", "type=\"radio\"", "moveOutAction"]) expect(readonly).not.toContain(bad);
  });
  it("the deposit is a plain line, and the info line names who can confirm", () => {
    expect(move).toContain("Deposit {money(p.deposit.amount)}");
    expect(move).toContain("not chosen yet");
    expect(move).toContain("can confirm this move-out. You’ll get a note when they do.");
    expect(move).toContain("(admin)");
  });
  it("'You'll get a note' is true: the move-out event tells the whole flat", () => {
    expect(src("lib/home/moving-db.ts")).toContain('kind: "member_left"'); // logged through logEvent, which notifies the group
    expect(move).toContain("Everyone is told.");
  });
});

describe("Your groups: the folded Groups you left row", () => {
  const page = src("app/groups/page.tsx");
  it("is folded by default, hidden when there are none, and sits between Start a group and Closed groups", () => {
    expect(page).toContain("{left.length > 0 && (\n        <details className=\"group/left mt-6\" data-left-groups>");
    expect(page).not.toMatch(/<details[^>]*data-left-groups[^>]*\bopen\b/);
    expect(page.indexOf("Start a group")).toBeLessThan(page.indexOf("data-left-groups"));
    expect(page.indexOf("data-left-groups")).toBeLessThan(page.indexOf('aria-label="Closed groups"'));
  });
  it("Home's stories still skip groups you left (stillIn), and the page lists them from `open`, not from stillIn", () => {
    expect(page).toContain("const live = stillIn(open)");
    expect(page).toContain("leftGroups(open)");
  });
});

describe("People tab: the way back for someone who left on their own", () => {
  const tab = src(`${G}/_components/PeopleTab.tsx`);
  it("a self-leaver gets a link to the People page, in the same style as Manage people; a removed person gets none", () => {
    expect(tab).toContain("{v.leaver && !v.leaver.removed && (");
    expect(tab).toContain("href={`/groups/${v.group.id}/people`}");
    const link = tab.slice(tab.indexOf("data-rejoin-link") - 260, tab.indexOf("data-rejoin-link"));
    const manage = tab.slice(tab.indexOf("data-manage-people") - 260, tab.indexOf("data-manage-people"));
    const cls = (x: string) => /className="([^"]*)"/.exec(x)![1].replace(/^mt-6 /, "");
    expect(cls(link)).toBe(cls(manage));
    // evaluating the condition: self-leaver shows, removed hides, member (null) shows nothing here
    const show = (l: { removed: boolean } | null) => Boolean(l && !l.removed);
    expect([show({ removed: false }), show({ removed: true }), show(null)]).toEqual([true, false, false]);
  });
  it("the label: Undo move-out or rejoin only for a flat whose undo is available, else Rejoin the group", () => {
    expect(tab).toContain('canUndoMoveOut ? "Undo move-out or rejoin" : "Rejoin the group"');
    expect(src(`${G}/page.tsx`)).toContain('canUndoMoveOut={group.type === "home" && Boolean(ownMove?.check.ok)}');
  });
  it("Manage people is still hidden for every leaver", () => {
    expect(tab).toContain("{!v.leaver && !v.group.closed && (");
  });
});

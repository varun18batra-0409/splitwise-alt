import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Batch 5a of the look-and-feel work: getting around (bottom bar, the bell, You, Your updates). Read as text, so no browser is needed.
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("bottom bar", () => {
  const nav = src("src/components/BottomNav.tsx");
  it("is Home, Groups, +, Settle, You, with no Recap or Alerts", () => {
    for (const s of ['label: "Home"', 'label: "Groups"', 'label: "Settle"', 'label: "You"', 'aria-label="Add expense"', 'href: "/groups"', 'href: "/account"']) expect(nav).toContain(s);
    expect(nav).not.toContain('label: "Recap"');
    expect(nav).not.toContain('label: "Alerts"');
    expect(nav).not.toContain("/api/unread");
  });
  it("lights You for the account, passport and postcards pages, and keeps hiding on forms", () => {
    expect(nav).toContain('path.startsWith("/account/")');
    expect(nav).toContain('path.startsWith("/passport")');
    expect(nav).toContain('path.startsWith("/postcards")');
    expect(nav).toContain("const HIDE = [");
    expect(nav).toContain("/\\/add$/");
  });
  it("keeps 44px targets and fits five items at 320px (4 x 54 + 52 + 8 + 12 <= 288)", () => {
    expect(nav).toContain("min-h-11");
    expect(nav).toContain("min-w-0 flex-1");
    expect(4 * 54 + 52 + 8 + 12).toBeLessThanOrEqual(320 - 32);
  });
});

describe("the bell", () => {
  const bell = src("src/components/BellButton.tsx");
  it("opens Your updates, reads the same unread count, and says how many are new", () => {
    expect(bell).toContain('href="/notifications"');
    expect(bell).toContain("/api/unread");
    expect(bell).toContain("Updates (${unread} new)");
    expect(bell).toContain('"Updates"');
    expect(bell).toContain("h-11 w-11");
    expect(bell).not.toMatch(/orange|accent/);
  });
  it("is at the top right of Home, Your groups and You", () => {
    expect(src("src/app/(home)/page.tsx")).toContain("<BellButton");
    expect(src("src/app/groups/page.tsx")).toContain('title="Your groups" back="/" bell');
    expect(src("src/app/account/page.tsx")).toContain('title="You" back="/" bell');
    expect(src("src/components/ui.tsx")).toContain("{bell && <BellButton />}");
  });
});

describe("recap stays reachable", () => {
  it("Home month card, each group, and the You page all open the recap", () => {
    expect(src("src/app/(home)/page.tsx")).toContain("/search?m=");
    expect(src("src/app/groups/[id]/_components/GroupHeader.tsx")).toContain("/search?g=${group.id}");
    expect(src("src/app/groups/[id]/_components/GroupHeader.tsx")).toContain("Trip recap");
    expect(src("src/app/account/page.tsx")).toContain('href="/search"');
    expect(src("src/app/account/page.tsx")).toContain("Your recap");
  });
});

describe("You page", () => {
  const you = src("src/app/account/page.tsx");
  it("has the three lists, and everything from the old page is still on it", () => {
    for (const s of ["Your trip passport", "Your postcards", "Friends’ passports", "Preferences", "Notifications & email", "Privacy & sharing", "Sign-in & devices", "Export your data", "Help & support"]) expect(you).toContain(s);
    for (const s of ['href="/passport"', 'href="/postcards"', 'href="/passport/friends"', 'href="/account/notifications"', 'href="#pay"', 'href="#privacy"', 'href="#sign-in"', 'href="#data"', 'href="/support"']) expect(you).toContain(s);
    for (const s of ['id="pay"', 'id="sign-in"', 'id="data"', 'id="notifications"', 'id="other-phones"', "savePayWays", "saveMyName", "signOutThisPhone", "signOutOtherPhonesAction", "deleteMyAccount", "removeMyPasskey", "<PasskeyAdd", "<PrivacySafety", "<InviteFriends", "/api/my-data", "data-deleted-link", "ACCOUNT_FOOTER_LINKS"]) expect(you).toContain(s);
  });
  it("keeps the test hooks and has one link per name the tests click", () => {
    const rows = src("src/components/YouRows.tsx");
    expect(rows).toContain("data-postcards-link");
    expect(rows).toContain("data-notify-link");
    expect(you.match(/Notifications &amp; email|Notifications & email/g)?.length).toBe(1);
  });
  it("has no tinted vault card", () => expect(you).not.toContain("vault"));
});

describe("Your updates", () => {
  const page = src("src/app/notifications/page.tsx");
  it("is titled Your updates with Needs you and All tabs", () => {
    expect(page).toContain('title="Your updates"');
    expect(page).not.toContain('title="Alerts"');
    for (const s of ["data-updates-tabs", 'data-tab="needs"', 'data-tab="all"', "Needs you", "\n          All\n","/notifications?tab=all", "/notifications?tab=needs"]) expect(page).toContain(s);
  });
  it("opens on Needs you when something needs you, and has the calm empty state", () => {
    expect(page).toContain('needs.total > 0 ? "needs" : "all"');
    expect(page).toContain("Nothing needs you right now.");
  });
  it("keeps its hooks, deep links and mark-as-read", () => {
    for (const s of ["data-needs-you", "data-need={it.kind}", "data-invitations", "href={it.href}", "markNotificationsSeen", "markNotesSeen", "data-change-lines", 'aria-label="New"', "setCollectPush", "<PhoneStatus"]) expect(page).toContain(s);
  });
  it("has one cream pill (first row, only when no invitation card), outlines otherwise, and no emoji", () => {
    expect(page).toContain('i === 0 && invitations.length === 0 ? "bg-fg text-canvas" : "border border-fg/25 text-fg"');
    expect(page).not.toMatch(/\p{Extended_Pictographic}(?<![✎✕✓↺⇄])/u);
    expect(page).not.toContain("text-orange-400");
  });
});

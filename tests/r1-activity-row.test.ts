import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(f, "utf8");

describe("R1 item 1: activity rows", () => {
  const row = src("src/components/ActivityRow.tsx");
  it("line 3 is group and date, joined with a dot, and may truncate", () => {
    expect(row).toContain('[groupName, dateLabel].filter(Boolean).join(" · ")');
    expect(row).toMatch(/mt-0\.5 truncate[^"]*" data-where-line/);
  });
  it("Home passes the group and the day apart", () => {
    const home = src("src/app/(home)/page.tsx");
    expect(home).toContain("groupName={r.groupName} dateLabel={dayLabel(");
  });
  it("a plain payment has no 'Payment' subtitle and does not repeat the amount", () => {
    expect(row).toContain('subRaw === "Payment"');
    expect(row).toContain("(deleted || item.effect === 0)");
  });
});

describe("R1 item 3: invite friends lives on You only", () => {
  it("Home no longer shows the invite card; You still does", () => {
    expect(src("src/app/(home)/page.tsx")).not.toContain("InviteFriends");
    expect(src("src/app/account/page.tsx")).toContain("<InviteFriends");
  });
});

describe("R1 item 4: the Collecting card", () => {
  it("shows progress only: no green 'awaiting check' line, no 'to check' repeat", () => {
    const card = src("src/components/CollectionsList.tsx");
    expect(card).not.toContain("awaiting check");
    expect(card).not.toContain("text-owed");
    expect(card).not.toContain("to check`");
  });
  it("no Collection story circle", () => {
    expect(src("src/lib/home/stories.ts")).not.toContain('kind: "collect",');
  });
});

describe("R1 items 5, 11, 12, 13: passport book", () => {
  const book = src("src/components/PassportBook.tsx");
  it("the cover and page 1 read one `counts` object (passportCounts, worked out once by the page)", () => {
    expect(book).toContain("counts: PassportCounts");
    expect(book).toContain("{ name, stats, counts, milestones, pages, index, badges = [], own = true }");
    expect(book).toContain("data-cover-counts={`${counts.countries}|${counts.stamps}`}");
    expect(book).toContain("data-passport-counts={`${counts.countries}|${counts.stamps}|${counts.trips}`}");
  });
  it("no green on the map or badges, and no emoji in the badge grid", () => {
    expect(book).not.toContain("#2f7d4f");
    expect(book).not.toContain("#7fb59a");
    expect(book).not.toContain("{b.emoji}");
    expect(book).toContain("<BadgeIcon");
    expect(book).toContain("visibleBadges(badges)");
  });
  it("the stamp album hides '0 of 9 collected' until there is one", () => {
    expect(src("src/app/postcards/stamps/page.tsx")).toContain("{count > 0 && (");
  });
});

describe("R1 item 16: the Moments page", () => {
  const page = src("src/app/groups/[id]/moments/page.tsx");
  it("no tagline, the row's time is its own never-cut piece, and a short list puts Add at its end", () => {
    expect(page).not.toContain("One photo. A few words. Our story.");
    expect(page).toContain('shrink-0 whitespace-nowrap text-fg/55" data-moment-time');
    expect(page).toContain("const floating = canAdd && cards.length > 2;");
    expect(page).toContain("data-moments-add-inline");
  });
});

describe("R1 item 7: one monthly estimate", () => {
  it("the Bills tab shows the forecast monthInsights works out (the same one This month shows), not its own sum", () => {
    const bills = src("src/app/groups/[id]/_components/BillsTab.tsx");
    expect(bills).toContain("forecast.total");
    expect(bills).not.toContain("b.bill.amount * 30");
    expect(bills).not.toContain("const monthly =");
    const page = src("src/app/groups/[id]/page.tsx");
    expect(page).toContain('monthTab || (home && tab === "bills")');
    expect(page).toContain("forecast={heads?.forecast ?? null}");
    expect(src("src/app/groups/[id]/_components/ThisMonthTab.tsx")).toContain("extras.forecast.total");
  });
});

describe("R1 items 8 and 11: the invite page", () => {
  const page = src("src/app/groups/[id]/invite/page.tsx");
  it("has one 'More ways to share' control, and the old duplicates are gone", () => {
    expect(page.match(/More ways to share/g)?.length).toBe(2); // the comment and the summary
    expect(page).not.toContain("Share the group link or QR code");
    expect(page).not.toContain("More ways <span");
    expect(page.match(/data-more-ways/g)?.length).toBe(1);
    expect(src("src/components/ShareInvite.tsx")).not.toContain("More ways to share");
  });
  it("the WhatsApp button is cream (no green) and the heading is not peach", () => {
    expect(page).not.toContain("#6fe3a8");
    expect(page).not.toContain("#ffd9a8");
    expect(page).toContain("bg-fg px-4 py-3.5");
  });
  it("in production the invite link uses the real site address, never localhost", () => {
    expect(page).toContain('process.env.VERCEL_ENV === "production" ? SITE_URL');
  });
});

describe("R1 item 11: no green or orange where no money is involved", () => {
  it("chart category colours avoid orange, yellow and green", () => {
    const charts = src("src/app/groups/[id]/_components/ChartsTab.tsx");
    for (const bad of ["#e9b872", "#e6d47e", "#9fceaa"]) expect(charts).not.toContain(bad);
  });
  it("'start the countdown' is off-white, not the money colour", () => {
    expect(src("src/components/TripDates.tsx")).not.toContain("text-owed");
  });
  it("the share picture's map is inked, not green", () => {
    expect(src("src/lib/og-assets.ts")).not.toContain("#2f7d4f");
  });
});

describe("R1 item 12: no emoji as decoration", () => {
  it("'Watch the Wrapped' has no emoji", () => {
    const charts = src("src/app/groups/[id]/_components/ChartsTab.tsx");
    expect(charts).toContain("Watch the Wrapped ›");
    expect(charts).not.toContain("🎬");
  });
});

import { headerTripLine } from "@/lib/countdown";
describe("R1 item 14: group header line", () => {
  it("says 'Starts in 36 days', 'Starts tomorrow', 'Day 5 of 5', and nothing after the trip", () => {
    expect(headerTripLine({ kind: "before", days: 36 })).toBe("Starts in 36 days");
    expect(headerTripLine({ kind: "before", days: 1 })).toBe("Starts tomorrow");
    expect(headerTripLine({ kind: "today" })).toBe("Starts today");
    expect(headerTripLine({ kind: "during", day: 5, of: 5 })).toBe("Day 5 of 5");
    expect(headerTripLine({ kind: "after" })).toBeNull();
  });
  it("the header no longer writes the crew's names or the 'Trip,' type twice", () => {
    const head = src("src/app/groups/[id]/_components/GroupHeader.tsx");
    expect(head).not.toContain("const crew");
    expect(head).not.toContain('type ? `${type}, `');
    expect(head).toContain("headerTripLine(phase)");
  });
});

import { buildStories } from "@/lib/home/stories";
describe("R1 item 14: trip story says the day once", () => {
  it("'Goa · day 2 of 5' with no 'Day 2' label and no repeated 'Day 2 of 5'", () => {
    const [s] = buildStories({
      now: new Date("2026-11-12T10:00:00Z"),
      trips: [{ id: "t1", name: "Goa trip", phase: { kind: "during", day: 2, of: 5 }, people: 3, photos: ["/p/a.jpg", "/p/b.jpg"], month: 11 } as never],
      games: [], squared: [], collections: [], memories: [], wrapped: [],
    });
    const first = s.frames[0];
    expect(first).toMatchObject({ kind: "photo", head: "Goa · day 2 of 5", line: "Keep the receipts coming" });
    expect((first as { kicker?: string }).kicker).toBeUndefined();
  });
});

describe("R1 item 14: Our passports chip", () => {
  it("the 'Everywhere' chip drops the count already in the headline", () => {
    expect(src("src/app/groups/[id]/passports/page.tsx")).toContain('label: "Everywhere", countries: together.map(c3), hideCount: true');
    expect(src("src/components/PassportCompare.tsx")).toContain("!s.hideCount");
  });
});
describe("R1 item 14: Record a payment", () => {
  it("the button says 'Record payment' and a suggestion equal to the form is not offered again", () => {
    expect(src("src/components/RecordPaymentForm.tsx")).toContain('const button = "Record payment"');
    const pay = src("src/app/groups/[id]/pay/page.tsx");
    expect(pay).toContain("t.from === from && t.to === to && parseAmount(qAmount, group.currency) === t.amount");
    expect(pay).toContain("suggestions.map");
  });
});

describe("R1 item 14: recap and updates", () => {
  it("the recap's 'Your share' mini-stat is left out when the big number is your share", () => {
    const ins = src("src/app/search/Insights.tsx");
    expect(ins).toContain('d.view !== "share" && <p className="px-1">');
    expect(ins).toContain("data-recap-ministats");
  });
  it("an Updates collection item says the time, not the collection name again", () => {
    expect(src("src/app/notifications/page.tsx")).toContain('it.kind === "collect" ? time(it.at) : it.where');
  });
});

describe("R1 item 15: Add expense small copy", () => {
  const form = src("src/components/AddExpenseForm.tsx");
  it("no 'result shows once it adds up'; the fold says 'More options'", () => {
    expect(form).not.toContain("The result shows once it adds up");
    expect(form).toContain('"More options"');
    expect(form).not.toContain("Notes, several payers");
  });
  it("the amount box stays plain digits while typing (no grouping reintroduced)", () => {
    expect(form).not.toMatch(/onChange=\{\(e\) => setAmount\(groupDigits/);
  });
});

describe("R1 item 14: collection organiser", () => {
  it("no 'confirmed · to check · still to pay' line under the stat boxes", () => {
    const page = src("src/app/c/[code]/page.tsx");
    expect(page).not.toContain("const counts");
    expect(page).not.toContain("`${p.dueCount} still to pay`");
  });
});
describe("R1 item 14: Balances", () => {
  it("the 'Overall you're owed' paragraph is gone; the currency cards stay", () => {
    const b = src("src/app/groups/[id]/_components/BalancesTab.tsx");
    expect(b).not.toContain("data-ledger-summary");
    expect(b).not.toContain("ledgerSummary(");
    expect(b).toContain("expenses</span>");
  });
  it("People says the amount once", () => {
    const p = src("src/app/groups/[id]/people/page.tsx");
    expect(p).toContain("must be settled up first.`");
    expect(p).not.toContain("must be settled up first (");
  });
});

describe("R1 item 9: the pay link page", () => {
  const page = src("src/app/p/[token]/page.tsx");
  it("with a UPI ID: Pay with UPI, the UPI ID with Copy, and a QR (the same pieces as the collection payer page)", () => {
    expect(page).toContain("Pay with UPI");
    expect(page).toContain('<CopyButton text={acc?.upiId ?? ""} label="Copy" />');
    expect(page).toContain("dangerouslySetInnerHTML={{ __html: qr }}");
    expect(src("src/app/c/[code]/page.tsx")).toContain("with UPI");
  });
  it("the amount is in the header only, and the steps do not repeat the sum or the name", () => {
    expect(page).toContain("data-paylink-amount");
    expect(page).not.toContain("{step(1, `Pay ${to} ${money}`)}");
    expect(page).not.toContain("I’ve paid {money}");
    expect(page).toContain('step(2, "Then tell them")');
  });
});

describe("R1 item 17: postcard send step", () => {
  it("drops the 'Or' when the WhatsApp option above it is not shown (no message yet)", () => {
    const c = src("src/app/postcards/new/Composer.tsx");
    expect(c).toContain('{message.trim() ? "Or send it in Loopin" : "Send it in Loopin"}');
    expect(c).toContain("data-whatsapp-anyone"); // shown only when message.trim()
  });
});

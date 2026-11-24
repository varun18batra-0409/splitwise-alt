import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { oneStampPerCountry, shareStamps, stampPages, type Stamp } from "../src/lib/passport";

// Look set 2 (mockups for the founder, not released). Mostly source checks: the real layout is judged from the screenshots.
const src = (f: string) => readFileSync(f, "utf8");

const stamp = (id: string, code: string, byHand = false): Stamp => ({ id, kind: "country", code, name: code, flag: "", when: byHand ? "" : "2026-05-05", cities: [], byHand });

describe("19. split by shares buttons", () => {
  it("the minus and plus are round and the count is in the normal font", () => {
    const f = src("src/components/AddExpenseForm.tsx");
    expect(f.match(/h-10 w-10 rounded-full border border-line text-lg/g)).toHaveLength(2);
    expect(f).toContain("w-14 bg-transparent py-2 text-center text-base outline-none");
    expect(f).not.toContain("w-14 bg-transparent py-2 text-center font-display");
  });
});

describe("20. spin wheel label", () => {
  it("only the slice dims once there is a winner; the name stays light", () => {
    const w = src("src/components/SpinWheel.tsx");
    expect(w).toContain("opacity={lost ? 0.55 : 1}");
    expect(w).toContain("fillOpacity={lost ? 0.85 : 1}");
    expect(w).not.toContain("<g key={p.id} opacity=");
  });
});

describe("21. passport book buttons", () => {
  it("Share and Send in Loopin are both h-12", () => {
    const p = src("src/app/passport/page.tsx");
    expect(p).toContain('label="Share" className="pop flex h-12 w-full');
    expect(p).toContain("flex h-12 items-center justify-center rounded-full border border-fg/25 text-[15px] font-semibold active:bg-fg/10\" data-passport-send");
  });
});

describe("22. settings Save bar", () => {
  it("has a solid panel behind it and a smaller gap before People & data", () => {
    const s = src("src/app/groups/[id]/settings/page.tsx");
    expect(s).toContain("data-save-bar");
    expect(s).toContain("bg-canvas");
    expect(s).toContain("mt-8 ${sectionTitle}`}>People &amp; data");
  });
});

describe("23, 24, 25. postcards", () => {
  it("the sealed choice shows a lock, not an empty ring", () => {
    const s = src("src/app/postcards/new/editor/SendStep.tsx");
    expect(s).toContain("<LockIcon");
    expect(s).not.toContain("h-3 w-3 shrink-0 rounded-full border-[1.5px] border-fg");
    expect(src("src/components/icons.tsx")).toContain("export const LockIcon");
  });
  it("Next is dimmed (still tappable, it explains why) until there is a message", () => {
    const c = src("src/app/postcards/new/Composer.tsx");
    expect(c).toContain('const waiting = !(tab === "front" && !oneSide) && !message.trim();');
    expect(c).toContain("data-waiting={waiting || undefined}");
    expect(c).toContain('waiting ? "opacity-40" : ""');
  });
  it("a sealed card says the morning of one day (no clock time), and the seal is the same L everywhere", () => {
    const page = src("src/app/postcards/[id]/page.tsx");
    expect(page).toContain("sealed this to open on the morning of {opensShort}");
    expect(page).not.toContain("opensLine");
    expect(src("src/components/postcards/Sealed.tsx")).toContain('waxSeal("crimson:crest", "L", "sealed")');
  });
});

describe("26. closed pay link", () => {
  it("shows a clock, not the success tick", () => {
    const p = src("src/app/p/[token]/page.tsx");
    expect(p).toContain('<Mark tone="closed" />');
    expect(p).toContain("<ClockIcon size={28} />");
  });
});

describe("27. chart colours", () => {
  it("each category has its own colour", () => {
    const t = src("src/app/groups/[id]/_components/ChartsTab.tsx");
    const block = t.slice(t.indexOf("const CAT_COLOUR"), t.indexOf("};", t.indexOf("const CAT_COLOUR")));
    const hex = block.match(/#[0-9a-f]{6}/gi) ?? [];
    expect(hex).toHaveLength(8);
    expect(new Set(hex.map((h) => h.toLowerCase())).size).toBe(8);
    // never the money green or the owed orange
    for (const h of hex) expect(["#6fe3a8"]).not.toContain(h.toLowerCase());
  });
});

describe("28. category recap rows", () => {
  it("a foreign amount has its own line, and both amounts share one decimals style", () => {
    const r = src("src/components/ActivityRow.tsx");
    expect(r).toContain("keepDecimals: keep");
    expect(r).toContain("sub={o ? sameForeign(o.effect) : undefined}");
    expect(r).toContain("sub={o ? sameForeign(-o.effect) : undefined}");
    expect(r).toContain("{/* A foreign amount gets its own line");
  });
});

describe("29. small grey text", () => {
  it("the activity row's right-hand words and the group header notes are 13px and lighter", () => {
    const r = src("src/components/ActivityRow.tsx");
    expect(r).toContain('<span className="mt-0.5 block text-[13px] text-fg/70">{label}</span>');
    expect(r).not.toContain("block text-[11px] text-fg/60");
    expect(src("src/app/groups/[id]/_components/GroupHeader.tsx")).toContain('<p className="mt-3 text-[13px] text-fg/70">Long-term averages');
  });
});

describe("30. Updates page", () => {
  it("the activity comes before the notification settings, which are one small section; one name (Updates)", () => {
    const p = src("src/app/notifications/page.tsx");
    expect(p.indexOf("Nothing yet. When someone adds")).toBeLessThan(p.indexOf("data-update-settings"));
    expect(p.indexOf('<PhoneStatus compact />')).toBeGreaterThan(p.indexOf("data-update-settings"));
    expect(p).toContain("data-notify-link");
    expect(src("src/components/PassportFriend.tsx")).toContain("in Updates.");
    expect(src("src/components/ShareCountdown.tsx")).toContain("their Updates and a buzz");
  });
});

describe("31. stamp album", () => {
  it("is split into Yours / Available now / Coming later with one label style", () => {
    const a = src("src/app/postcards/stamps/page.tsx");
    for (const s of ['title: "Yours"', 'title: "Available now"', 'title: "Coming later"', "data-album-group={g.key}", "data-album-stamp={id}"]) expect(a).toContain(s);
    expect(a).not.toContain("text-[12.5px]");
    expect(a).not.toContain("text-[11px]");
  });
});

describe("32 and 33. passport stamps and picture", () => {
  it("a country is stamped once: trips and Been there never repeat it", () => {
    expect(oneStampPerCountry([stamp("a", "JP"), stamp("b", "JP"), stamp("c", "TH")], [stamp("d", "JP", true), stamp("e", "IT", true)]).map((s) => s.id)).toEqual(["a", "c", "e"]);
  });
  it("the book pages and the share picture use the same rule", () => {
    const stamps = [stamp("a", "JP"), stamp("b", "JP")];
    const been = [stamp("c", "JP", true)];
    expect(stampPages(stamps, been).flatMap((p) => p.stamps.map((s) => s.id))).toEqual(["a"]);
    expect(shareStamps(stamps, been).map((s) => s.id)).toEqual(["b"]); // newest trip first
  });
  it("the index drops 'Been there' for a country that also has trips; a locked badge is dashed, not faded", () => {
    const b = src("src/components/PassportBook.tsx");
    expect(b).toContain('r.byHand && !r.trips ? "Been there" : ""');
    expect(b).toContain("border-dashed");
    expect(b).not.toContain("opacity-60");
  });
  it("the picture says '5 countries (4 abroad)' next to 4 stamps and its code line fits", () => {
    const r = src("src/app/passport/image/route.tsx");
    expect(r).toContain("(${stamped} abroad)");
    expect(r).toContain("fontSize: 18, letterSpacing: 1.5");
  });
});

describe("34 and 35. trip report", () => {
  it("shows the group's place photo like its own page, and keeps amounts whole on a line", () => {
    const r = src("src/app/groups/[id]/report/page.tsx");
    expect(r).toContain("const placeShot = tripPhotoSrc(group);");
    expect(r).toContain("{placeShot ? (");
    expect(r).toContain("whitespace-nowrap text-[40px]");
    expect(r).toContain("break-words");
  });
});

describe("36. Wrapped awards", () => {
  it("an odd last award takes the whole row, so there is no empty slot", () => {
    const w = src("src/components/WrappedDeck.tsx");
    expect(w).toContain("shown.length % 2 === 1 && k === shown.length - 1 ? \"col-span-2\"");
    expect(w).toContain("justify-start pt-3");
  });
});

describe("37. group header arrow", () => {
  it("sits inside the name, after its last word", () => {
    const h = src("src/app/groups/[id]/_components/GroupHeader.tsx");
    const h1 = h.slice(h.indexOf("<h1 className={`font-display font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]"), h.indexOf("</h1>"));
    expect(h1.length).toBeGreaterThan(0);
    expect(h1.indexOf("{group.name}")).toBeGreaterThan(-1);
    expect(h1.indexOf("{group.name}")).toBeLessThan(h1.indexOf("<ChevronDown size={18} />"));
  });
});

describe("39. flat bills rows", () => {
  it("the meta line is built from its parts (no stray dot)", () => {
    expect(src("src/app/groups/[id]/_components/BillsTab.tsx")).toContain("data-bill-meta");
  });
});

describe("40. one menu on a person's page", () => {
  it("the card has no menu of its own; the header menu holds the part-payment link", () => {
    const p = src("src/app/people/[id]/page.tsx");
    expect(p).toContain("const menu: MenuItem[] = [];");
    expect(p).toContain('markReceived={owed ? "Mark received" : undefined}');
    expect(p).toContain("data-different-amount=\"\"");
    expect(src("src/components/SettleUp.tsx")).toContain("{menu.length > 0 && (");
  });
});

describe("41. report box", () => {
  it("has no resize handle", () => {
    expect(src("src/app/report/page.tsx")).toContain("`${inputClass} resize-none`");
  });
});

describe("42. sign in and create account", () => {
  const s = src("src/app/signin/page.tsx");
  it("only Create account asks for a name, and it has the short header", () => {
    expect(s).toContain("{signup && (\n              <label className=\"block\">");
    expect(s).not.toContain("(if you’re new)");
    expect(s).toContain('signup ? "h-[96px]" : "h-[420px] tight:h-[96px]"');
    expect(s).toContain("Already have an account?");
  });
});

describe("43. invite screen badge", () => {
  it("says Not signed in with a Sign in link", () => {
    const s = src("src/app/groups/[id]/invite/page.tsx");
    expect(s).toContain('text: "Not signed in"');
    expect(s).not.toContain("Only on this device");
  });
});

describe("44. reaction button", () => {
  it("uses the smiley-with-plus icon", () => {
    expect(src("src/app/groups/[id]/_components/ActivityTab.tsx")).toContain("<ReactIcon size={20} />");
    expect(src("src/components/icons.tsx")).toContain("export const ReactIcon");
  });
});

describe("45. no emoji among the line icons on the countdown share sheet", () => {
  it("the sheet's own line has the emoji taken out; the sent message keeps them", () => {
    const c = src("src/components/ShareCountdown.tsx");
    expect(c).toContain("Extended_Pictographic");
    expect(c).toContain("const words = `${line} ✨`;");
  });
});

describe("46. Spin row under Save", () => {
  it("More has room at the bottom when open", () => {
    expect(src("src/components/AddExpenseForm.tsx")).toContain('data-more className={showMore ? "pb-24" : undefined}');
  });
});

describe("47. Collect: the amount in the normal font", () => {
  it("the example amount is not in the handwriting font", () => {
    expect(src("src/app/collect/new/page.tsx")).toContain('<span className="font-sans text-[19px] font-semibold tabular-nums">{example}</span>');
  });
});

describe("48. countdown photo reads Where to", () => {
  it("the Home countdown reads the place text as well as the name", () => {
    const c = src("src/components/TripCountdown.tsx");
    expect(c).toContain("tripPlace?: string | null");
    expect(c).toContain('placePhoto(`${group.name} ${group.tripPlace ?? ""}`.trim(), group.id)');
  });
});

describe("49. offline page", () => {
  it("is in Loopin's look with a Try again button, and keeps the words the offline tests look for", () => {
    const sw = src("public/sw.js");
    expect(sw).toContain("Try again");
    expect(sw).toContain("location.reload()");
    expect(sw).toContain("You’re offline");
    expect(sw).toContain("Loopin needs the internet");
    expect(sw).toContain("#0d0d0f");
  });
});

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { cardWord } from "@/lib/home/group-card";
import { passPhoto, type PassGroup } from "@/lib/home/pass-photo";
import { COMING_UP_MAX, comingUp, destinationCode, nameCode, type ComingUpTrip } from "@/lib/home/coming-up";
import { passLines, passQuip, tripPhase } from "@/lib/countdown";
import { MEMORY_MAX, pickMemories, type MemoryGroup } from "@/lib/home/memories";
import { homeHighlights } from "@/lib/home/highlights";
import type { MomentViewer } from "@/lib/moments-access";

// R2b: Home says each thing once, the money pass has a better photo, "Coming up" is a stack of trip passes, memories on Home.
const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");

describe("1. nothing repeats on Home", () => {
  it("a polaroid says one word: You owe, Owed to you or Square. No amount", () => {
    expect(cardWord(-5412200)).toEqual({ text: "You owe", tone: "owe" });
    expect(cardWord(300000)).toEqual({ text: "Owed to you", tone: "owed" });
    expect(cardWord(0)).toEqual({ text: "Square", tone: "square" });
    for (const w of [cardWord(-1), cardWord(1), cardWord(0)]) expect(w.text).not.toMatch(/\d|₹/);
    const cards = src("src/components/HomeGroups.tsx");
    expect(cards).not.toContain("formatMoney");
    expect(cards).not.toContain("cardBalance");
    expect(cards).toContain("cardWord(");
  });
  it("Home has no 'is all square. Close it' line, no Also line and no day tag on the polaroids", () => {
    const home = src("src/app/(home)/page.tsx");
    expect(home).not.toContain("is all square.");
    expect(home).not.toContain('"Close it"');
    expect(home).not.toContain("tripTag(");
    expect(home).not.toContain("alsoLine");
  });
  it("the cards under it don't say the trip's day count or its countdown again", () => {
    const trip = { id: "t", name: "Bangkok", phase: { kind: "during" as const, day: 2, of: 5 }, start: "2026-11-12", end: "2026-11-16", stops: [{ city: "Bangkok", country: "TH" }], todaySpent: "₹4,200" };
    const base = { trips: [trip], justBack: [], hasMonth: false, season: null, postcardsNew: 0, billsDue: [], passportCountries: 0, groups: 1 };
    const cards = homeHighlights(base).flatMap((h) => (h.kind === "card" ? [h.eyebrow] : []));
    expect(cards[0]).toBe("In Bangkok now");
    expect(cards.join(" ")).not.toMatch(/Day 2/);
    const soon = { ...trip, phase: { kind: "before" as const, days: 12 } };
    const withPass = homeHighlights({ ...base, trips: [soon], skipWeather: ["t"] }).map((h) => h.id);
    expect(withPass).not.toContain("weather-t");
  });
});

describe("2. the money pass photo", () => {
  const trip = (id: string, o: Partial<PassGroup> = {}): PassGroup => ({ id, type: "trip", iOwe: true, isOwed: false, owe: 100, owed: 0, spend: 0, photos: [`/${id}0.jpg`, `/${id}1.jpg`, `/${id}2.jpg`], cover: `/${id}0.jpg`, ...o });
  const flat = (id: string, o: Partial<PassGroup> = {}): PassGroup => ({ id, type: "home", iOwe: true, isOwed: false, owe: 100, owed: 0, spend: 0, photos: [], ...o });
  const base = { side: null, avoid: [] as string[], interiors: ["/in0.jpg", "/in1.jpg"], visited: ["TH", "JP"], want: ["IS"], general: ["/gen.jpg"], countryPhoto: (c: string) => ({ TH: "/c-th.jpg", JP: "/c-jp.jpg", IS: "/c-is.jpg" })[c] ?? null };

  it("(a) the trip where you owe the most: its second photo, never its polaroid cover", () => {
    const goa = trip("goa", { owe: 500_000 });
    const thai = trip("thai", { owe: 900_000 });
    expect(passPhoto({ ...base, groups: [goa, thai] })).toEqual({ src: "/thai1.jpg", source: "trip", groupId: "thai" });
  });
  it("owing nothing: the trip where you are owed the most", () => {
    const a = trip("a", { iOwe: false, isOwed: true, owe: 0, owed: 200 });
    const b = trip("b", { iOwe: false, isOwed: true, owe: 0, owed: 700 });
    expect(passPhoto({ ...base, groups: [a, b] })?.groupId).toBe("b");
  });
  it("owing something outranks being owed more: the owe side is chosen first", () => {
    const owe = trip("owe", { owe: 10 });
    const owed = trip("owed", { iOwe: false, isOwed: true, owe: 0, owed: 99_999 });
    expect(passPhoto({ ...base, groups: [owed, owe] })?.groupId).toBe("owe");
  });
  it("a tie goes to the trip with the largest spending", () => {
    const a = trip("a", { owe: 500, spend: 1_000 });
    const b = trip("b", { owe: 500, spend: 9_000 });
    expect(passPhoto({ ...base, groups: [a, b] })?.groupId).toBe("b");
  });
  it("never the cover: a cover that is not the first photo is skipped too; a photo already on a polaroid is avoided", () => {
    const g = trip("g", { photos: ["/p0.jpg", "/p1.jpg", "/p2.jpg"], cover: "/p1.jpg" });
    expect(passPhoto({ ...base, groups: [g] })?.src).toBe("/p0.jpg");
    expect(passPhoto({ ...base, groups: [g], avoid: ["/p0.jpg"] })?.src).toBe("/p2.jpg");
    for (const cover of ["/p0.jpg", "/p1.jpg", "/p2.jpg"]) expect(passPhoto({ ...base, groups: [trip("g", { photos: ["/p0.jpg", "/p1.jpg", "/p2.jpg"], cover })] })?.src).not.toBe(cover);
  });
  it("a trip with only its cover to show falls through to a country, never repeating the cover", () => {
    const g = trip("g", { photos: ["/only.jpg"], cover: "/only.jpg" });
    expect(passPhoto({ ...base, groups: [g] })).toEqual({ src: "/c-th.jpg", source: "visited" });
  });
  it("(b) money only from a flat or a couple: a warm home interior, not a country", () => {
    expect(passPhoto({ ...base, groups: [flat("f1")] })).toEqual({ src: "/in0.jpg", source: "flat" });
    expect(passPhoto({ ...base, groups: [flat("f1", { type: "couple" })] })?.source).toBe("flat");
    expect(passPhoto({ ...base, groups: [flat("f1")], avoid: ["/in0.jpg"] })?.src).toBe("/in1.jpg");
  });
  it("(b) no interior photo downloaded: null, so the group's own drawn home picture stays (and no country photo is borrowed)", () => {
    expect(passPhoto({ ...base, groups: [flat("f1")], interiors: [] })).toBeNull();
  });
  it("trip money and flat money together: the trip's photo", () => {
    expect(passPhoto({ ...base, groups: [flat("f1", { owe: 999_999 }), trip("t", { owe: 5 })] })?.source).toBe("trip");
  });
  it("a both-ways card: each pass takes the photo for its own side", () => {
    const thai = trip("thai", { owe: 50, iOwe: true, isOwed: false });
    const flatOwed = flat("flat", { iOwe: false, isOwed: true, owe: 0, owed: 80 });
    expect(passPhoto({ ...base, side: "owe", groups: [thai, flatOwed] })?.source).toBe("trip");
    expect(passPhoto({ ...base, side: "owed", groups: [thai, flatOwed] })?.source).toBe("flat");
  });
  it("(c) no trip and no flat money (all square): a visited country first, then want to go, then a general photo", () => {
    expect(passPhoto({ ...base, groups: [] })).toEqual({ src: "/c-th.jpg", source: "visited" });
    expect(passPhoto({ ...base, groups: [], visited: ["XX"] })).toEqual({ src: "/c-is.jpg", source: "want" });
    expect(passPhoto({ ...base, groups: [], visited: [], want: [] })).toEqual({ src: "/gen.jpg", source: "general" });
    expect(passPhoto({ ...base, groups: [], visited: ["TH", "JP"], avoid: ["/c-th.jpg"] })?.src).toBe("/c-jp.jpg");
    expect(passPhoto({ ...base, groups: [], visited: [], want: [], general: [] })).toBeNull();
  });
  it("money only in another kind of group (a dinner group): countries, not an interior", () => {
    expect(passPhoto({ ...base, groups: [flat("d", { type: "other" })] })?.source).toBe("visited");
  });
  it("the page uses it and keeps the group covers only as the fallback", () => {
    const home = src("src/app/(home)/page.tsx");
    expect(home).toContain("passPhoto(");
    expect(home).toContain("groupStub");
  });
});

describe("3. Coming up: one boarding pass per upcoming trip", () => {
  const today = "2026-11-14";
  const t = (id: string, name: string, start: string, end: string, o: Partial<ComingUpTrip> = {}): ComingUpTrip => ({ id, type: "trip", name, start, end, phase: tripPhase(start, end, today), going: 6, ...o });

  it("destination codes: Bangkok BKK, Thailand THA, Goa GOA", () => {
    expect(destinationCode({ city: "Bangkok", country: "TH", tripName: "x" })).toBe("BKK");
    expect(destinationCode({ city: "", country: "TH", countryName: "Thailand", tripName: "x" })).toBe("THA");
    expect(destinationCode({ city: "Goa", country: "IN", tripName: "x" })).toBe("GOA");
    expect(destinationCode({ city: "", country: "AE", countryName: "United Arab Emirates", tripName: "x" })).toBe("UAE");
  });
  it("the name rule: one word, first three letters; two words, initial + two; three words, initials", () => {
    expect(nameCode("Wayanad")).toBe("WAY");
    expect(nameCode("Koh Samui")).toBe("KSA");
    expect(nameCode("Rann of Kutch")).toBe("ROK");
    expect(nameCode("São Paulo")).toBe("SPA");
    expect(destinationCode({ city: "", country: "PE", countryName: "Peru", tripName: "x" })).toBe("PER");
    expect(destinationCode({ city: "", country: "", tripName: "Goa trip 2026" })).toBe("GOA");
  });
  it("never the same as the other end: a place called Youth keeps its code off YOU", () => {
    expect(nameCode("Youth")).toBe("YOU");
    expect(destinationCode({ city: "Youth", tripName: "x" })).toBe("OUT");
  });

  it("Thailand in 35 days (19 Dec): Date 19 Dec, In 35 days, Going 6, YOU to THA, one line for its stage", () => {
    const [p] = comingUp([t("thai", "Thailand trip", "2026-12-19", "2026-12-24", { stop: { city: "", country: "TH", countryName: "Thailand" } })], "2026");
    expect(p.from).toBe("YOU");
    expect(p.to).toBe("THA");
    expect(p.title).toBe("Thailand");
    expect(p.days).toBe(35);
    expect(p.fields).toEqual([
      { key: "date", label: "Date", value: "19 Dec" },
      { key: "in", label: "In", value: "35 days" },
      { key: "going", label: "Going", value: "6" },
    ]);
    expect(p.stage).toBe("w45");
    expect(p.quip.length).toBeGreaterThan(5);
  });
  it("a date in another year keeps its year; a day away says 1 day; nobody going leaves the Going field out", () => {
    const [p] = comingUp([t("x", "Goa trip", "2027-01-10", "2027-01-12", { going: 0 })], "2026");
    expect(p.fields.map((f) => f.key)).toEqual(["date", "in"]);
    expect(p.fields[0].value).toBe("10 Jan 2027");
    expect(comingUp([t("y", "Goa trip", "2026-11-15", "2026-11-16")], "2026")[0].fields[1].value).toBe("1 day");
  });
  it("earliest first, at most three, trips only", () => {
    expect(COMING_UP_MAX).toBe(3);
    const list = [
      t("d", "Four", "2026-12-30", "2026-12-31"),
      t("flat", "Flat 402", "2026-11-20", "2026-11-21", { type: "home" }),
      t("b", "Two", "2026-12-01", "2026-12-02"),
      t("a", "One", "2026-11-18", "2026-11-19"),
      t("c", "Three", "2026-12-10", "2026-12-11"),
      t("pot", "Card night", "2026-11-16", "2026-11-16", { type: "pot" }),
    ];
    expect(comingUp(list, "2026").map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(comingUp(list, "2026", 2).map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("on the trip: Day 2 of 5 on its pass, and it comes before trips still to come; after the trip it leaves", () => {
    const on = t("on", "Bali trip", "2026-11-13", "2026-11-17");
    const later = t("later", "Goa trip", "2026-12-01", "2026-12-03");
    const over = t("over", "Manali trip", "2026-11-01", "2026-11-05");
    const out = comingUp([later, over, on], "2026");
    expect(out.map((p) => p.id)).toEqual(["on", "later"]);
    expect(out[0].fields.find((f) => f.key === "now")).toEqual({ key: "now", label: "Now", value: "Day 2 of 5" });
    expect(out[0].fields.some((f) => f.key === "in")).toBe(false);
    expect(comingUp([t("today", "Goa trip", today, "2026-11-16")], "2026")[0].fields.find((f) => f.key === "now")?.value).toBe("Starts today");
  });
  it("two trips at the same stage get different lines (35 and 37 days: both six-ish weeks)", () => {
    const out = comingUp([t("a", "Thailand trip", "2026-12-19", "2026-12-24"), t("b", "Goa trip", "2026-12-21", "2026-12-24")], "2026");
    expect(out.map((p) => p.stage)).toEqual(["w45", "w45"]);
    expect(out[0].quip).not.toBe(out[1].quip);
  });
  it("the line never counts down again or prints an emoji, at any stage", () => {
    const phases = [100, 50, 40, 20, 10, 5, 2, 1].map((d) => ({ kind: "before" as const, days: d }));
    for (const p of [...phases, { kind: "today" as const }, { kind: "during" as const, day: 1, of: 5 }, { kind: "during" as const, day: 3, of: 5 }, { kind: "during" as const, day: 5, of: 5 }]) {
      const lines = passLines("Thailand trip", p);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      for (const l of lines) {
        expect(l).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(l).not.toMatch(/sleep|tomorrow|week|month|\bdays?\b/i);
      }
      expect(passQuip("Thailand trip", p, 0)).toBeTruthy();
    }
    expect(passLines("Thailand trip", { kind: "before", days: 100 })).toContain("Daydreaming about Thailand is allowed");
    expect(passQuip("Goa trip", { kind: "after" })).toBeNull();
  });
  it("the pass draws the money pass's own pieces; one outline button; the stack hides its dots for a single pass", () => {
    const hm = src("src/components/HomeMoney.tsx");
    const body = hm.slice(hm.indexOf("function TripPassCard"));
    for (const s of ["TicketShell", "PassRoute", "PassFields", "Open trip", "barcode", "data-trip-weather", "data-trip-quip"]) expect(body).toContain(s);
    expect(body).not.toContain("CREAM");
    expect(body).not.toContain("data-notch");
    expect(src("src/components/PassStack.tsx")).toContain("items.length > 1");
    const home = src("src/app/(home)/page.tsx");
    expect(home).toContain("<ComingUp passes={passes} />");
    expect(home).toContain("comingUp(");
  });
});

describe("4. Memories on Home: square polaroids, only moments canSeeMoment allows", () => {
  const viewer = (o: Partial<MomentViewer> = {}): MomentViewer => ({ groupId: "goa", groupType: "trip", groupDeleted: false, memberId: "me", accountId: "acc-me", leftAt: null, removedAt: null, pending: false, isAdmin: false, blocked: new Set<string>(), ...o });
  const at = (h: number) => new Date(Date.UTC(2026, 10, 10, h));
  const mo = (id: string, o: { groupId?: string; acc?: string; h?: number; caption?: string } = {}) => ({ id, groupId: o.groupId ?? "goa", authorId: `m-${o.acc ?? "x"}`, authorAccountId: o.acc ?? "acc-x", createdAt: at(o.h ?? 1), caption: o.caption ?? `cap ${id}` });
  const grp = (o: Partial<MemoryGroup> = {}): MemoryGroup => ({ groupId: "goa", name: "Goa", viewer: viewer(), moments: [], ...o });
  const thumb = (id: string) => `/api/moment-photo/${id}?s=t`;
  const ids = (r: { id: string }[]) => r.map((x) => x.id);

  it("nothing visible gives an empty list (and the component renders nothing)", () => {
    expect(pickMemories([], thumb)).toEqual([]);
    expect(pickMemories([grp()], thumb)).toEqual([]);
    const ui = src("src/components/MemoryPolaroids.tsx");
    expect(ui).toContain("if (memories.length === 0) return null;");
  });
  it("newest first across groups, each with its caption, group name, small photo and a link to the moment viewer", () => {
    const goa = grp({ moments: [mo("g1", { h: 1 }), mo("g2", { h: 5, caption: "The boat" })] });
    const bali = grp({ groupId: "bali", name: "Bali", viewer: viewer({ groupId: "bali" }), moments: [mo("b1", { groupId: "bali", h: 3 })] });
    const r = pickMemories([goa, bali], thumb);
    expect(ids(r)).toEqual(["g2", "b1", "g1"]);
    expect(r[0]).toEqual({ id: "g2", groupId: "goa", groupName: "Goa", caption: "The boat", thumb: thumb("g2"), href: "/groups/goa/moments/g2?from=home" });
    expect(r[1].href).toBe("/groups/bali/moments/b1?from=home");
  });
  it("at most 10 (the newest ten)", () => {
    const moments = Array.from({ length: 14 }, (_, i) => mo(`m${i}`, { h: i }));
    const r = pickMemories([grp({ moments })], thumb);
    expect(r).toHaveLength(MEMORY_MAX);
    expect(MEMORY_MAX).toBe(10);
    expect(ids(r)[0]).toBe("m13");
    expect(ids(r)[9]).toBe("m4");
  });
  it("no leak: a blocked person's moments are never listed and their photo address is never returned", () => {
    const v = viewer({ blocked: new Set(["acc-bad"]) });
    const r = pickMemories([grp({ viewer: v, moments: [mo("ok1", { h: 1 }), mo("bad1", { acc: "acc-bad", h: 9 }), mo("ok2", { h: 2 })] })], thumb);
    expect(ids(r)).toEqual(["ok2", "ok1"]);
    expect(JSON.stringify(r)).not.toContain("bad");
  });
  it("no leak: another group's moment, one added after you left, or a pending / removed viewer gives nothing", () => {
    const left = grp({ viewer: viewer({ leftAt: at(5) }), moments: [mo("early", { h: 3 }), mo("late", { h: 8 }), mo("other", { groupId: "bali", h: 4 })] });
    expect(ids(pickMemories([left], thumb))).toEqual(["early"]);
    expect(pickMemories([grp({ viewer: viewer({ pending: true }), moments: [mo("a")] })], thumb)).toEqual([]);
    expect(pickMemories([grp({ viewer: viewer({ removedAt: at(2) }), moments: [mo("a")] })], thumb)).toEqual([]);
    expect(pickMemories([grp({ moments: [mo("x", { groupId: "bali" })] })], thumb)).toEqual([]);
  });
  it("the old carousel card is gone; the row sits right under the story circles, and the loader uses the viewer's own filter", () => {
    const home = src("src/app/(home)/page.tsx");
    expect(home).not.toContain("MemoriesCard");
    expect(existsSync(`${__dirname}/../src/components/MemoriesCard.tsx`)).toBe(false);
    const stories = home.indexOf("<Stories stories={stories} className=\"mb-4\" />");
    expect(stories).toBeGreaterThan(0);
    expect(home.indexOf("<MemoryPolaroids memories={memories} />")).toBeGreaterThan(stories);
    expect(home.indexOf("<MemoryPolaroids memories={memories} />")).toBeLessThan(home.indexOf("<MoneyCard"));
    expect(homeHighlights({ trips: [], justBack: [], hasMonth: false, season: null, postcardsNew: 0, billsDue: [], passportCountries: 0, groups: 1 }).some((h) => (h.kind as string) === "memories")).toBe(false);
    const db = src("src/lib/moments-db.ts");
    expect(db.slice(db.indexOf("export async function loadHomeMemories"))).toContain("momentsWhere(viewer)");
    const ui = src("src/components/MemoryPolaroids.tsx");
    expect(ui).toContain("aspect-square");
    expect(ui).toContain("font-hand");
    expect(ui).toContain("snap-x");
  });
  it("the moment viewer sends Back home only for from=home", () => {
    const page = src("src/app/groups/[id]/moments/[momentId]/page.tsx");
    expect(page).toContain('cameFrom === "home" ? "/" : here');
  });
});

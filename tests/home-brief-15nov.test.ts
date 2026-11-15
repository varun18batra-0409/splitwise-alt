import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildStories } from "@/lib/home/stories";
import { storyLines } from "@/lib/home/story-lines";
import { TAG_LINES } from "@/lib/home/photo-tags";
import { buttonLabel, cardLabel, greetingWord, homeAmountTier, sideLine } from "@/lib/home/owe-card";

// The founder's Home brief (15 Nov), read as text and through the pure story builder: the tagline is back, the playful stories are back
// (emoji, handwriting, tape), moments are Memories only, the slim pass reads like a real boarding pass, groups are smaller polaroids,
// and Coming up is the 12 Nov countdown card.
const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");
const photos = ["/p/a.jpg", "/p/b.jpg", "/p/c.jpg"];
const EMOJI = /\p{Extended_Pictographic}/u;
const base = { now: new Date("2026-11-13T12:00:00Z"), trips: [], games: [], squared: [], collections: [], memories: [], wrapped: [] };

describe("greeting under the wordmark, tagline at the very end", () => {
  const home = src("src/app/(home)/page.tsx");
  it("'Good evening' (no name) sits under the wordmark in the header: visible, 17px, text-fg/75; the tagline is gone from the header", () => {
    const header = home.slice(home.indexOf("<header"), home.indexOf("</header>"));
    expect(header).toContain("loopin</p>");
    expect(header).toContain("data-greeting");
    expect(header).toContain("greetingWord(new Date(), tz)");
    expect(header).toContain("text-[17px]");
    expect(header).toContain("text-fg/75");
    expect(header).not.toContain("sr-only");
    expect(header).not.toContain("Everything adds up");
    expect(header.indexOf("loopin</p>")).toBeLessThan(header.indexOf("data-greeting"));
    expect(header.indexOf("data-greeting")).toBeLessThan(header.indexOf("<BellButton"));
  });
  it("greetingWord: morning 5-11, afternoon 12-16, evening otherwise, never the name", () => {
    expect(greetingWord(new Date("2026-11-15T06:30:00Z"), "UTC")).toBe("Good morning");
    expect(greetingWord(new Date("2026-11-15T12:00:00Z"), "UTC")).toBe("Good afternoon");
    expect(greetingWord(new Date("2026-11-15T16:59:00Z"), "UTC")).toBe("Good afternoon");
    expect(greetingWord(new Date("2026-11-15T17:00:00Z"), "UTC")).toBe("Good evening");
    expect(greetingWord(new Date("2026-11-15T03:00:00Z"), "UTC")).toBe("Good evening");
    // 18:00 UTC is 23:30 in Kolkata: the viewer's own clock decides.
    expect(greetingWord(new Date("2026-11-15T18:00:00Z"), "Asia/Kolkata")).toBe("Good evening");
    expect(greetingWord(new Date("2026-11-15T04:00:00Z"), "Asia/Kolkata")).toBe("Good morning");
  });
  it("no tagline on Home (founder, 15 Nov); it stays on the opening screen, the app description, shared trip pictures and How Loopin works", () => {
    expect(home).not.toContain("data-tagline");
    expect(home).not.toContain("Everything adds up.\n");
    for (const f of ["src/components/Splash.tsx", "src/app/manifest.ts", "src/components/TripShare.tsx", "src/app/how-it-works/page.tsx"])
      expect(readFileSync(f, "utf8").replace(/\s+/g, " ")).toMatch(/Everything adds up/);
  });
});

describe("stories are playful again (from before a9fe48ee) and moments are not stories", () => {
  it("the place, mood and crew lines carry their emoji again", () => {
    const all = (o: Parameters<typeof storyLines>[0]) => storyLines({ ...o, n: 10 }).map(([k, l]) => `${k}: ${l}`).join(" | ");
    expect(all({ place: "place-thailand", people: 4, seed: "x" })).toContain("Pad thai count: rising 🍜");
    expect(all({ place: "place-bali", people: 4, seed: "x" })).toContain("Villa with a pool, obviously 🌴");
    expect(all({ place: null, mood: "beach", people: 4, seed: "x" })).toContain("100% chance of flip‑flops 🩴");
    expect(all({ place: null, mood: "hills", people: 4, seed: "x" })).toContain("Cold enough for two hoodies 🧣");
    // Which crew line shows is picked by the seed, so this one is checked in the list itself.
    expect(readFileSync("src/lib/home/story-lines.ts", "utf8")).toContain("Table for two, every night 💛");
    expect(JSON.stringify(TAG_LINES.beach)).toContain("🩴");
    expect(JSON.stringify(TAG_LINES.snow)).toContain("🧣");
    expect(JSON.stringify(TAG_LINES.hills)).toContain("☕");
  });
  it("trip stories: countdown lines with ✈️ / 🔋 / 👀, and Spent-today lines with 🍹", () => {
    const tomorrow = buildStories({ ...base, trips: [{ id: "t", name: "Goa trip", phase: { kind: "before", days: 1 }, people: 4, photos }] });
    const text = JSON.stringify(tomorrow[0].frames);
    expect(text).toContain("Tomorrow! Charge your phone 🔋");
    expect(text).toContain("Not that anyone's counting 👀");
    const today = buildStories({ ...base, trips: [{ id: "t", name: "Goa trip", phase: { kind: "today" }, people: 4, photos }] });
    expect(JSON.stringify(today[0].frames)).toContain("Bags packed? It starts today ✈️");
    const on = buildStories({ ...base, trips: [{ id: "t", name: "Goa trip", phase: { kind: "during", day: 2, of: 5 }, people: 3, photos, today: { spent: "₹4,200", count: 0, top: "Asha" } }] });
    expect(JSON.stringify(on[0].frames)).toContain("Somebody buy them a drink 🍹");
    expect(JSON.stringify(on[0].frames)).toContain("Suspiciously quiet… 👀");
  });
  it("square, wrapped, a year ago: their emoji are back, and the circle's own emoji too", () => {
    const s = buildStories({
      ...base,
      squared: [{ id: "s1", name: "Flat 402", at: new Date("2026-11-13T08:00:00Z") }],
      wrapped: [{ id: "w1", name: "Thailand trip", endedDaysAgo: 2 }],
      memories: [{ id: "m1", name: "Goa trip", years: 1, people: 4, days: 3 }],
    });
    const of = (k: string) => s.find((x) => x.kind === k)!;
    expect(of("square").line).toBe("Nobody owes anybody. Nice one 🎉");
    expect(of("square").emoji).toBe("🎉");
    expect(of("wrapped").emoji).toBe("🎬");
    expect(of("memory").line).toContain("🌴");
    expect(EMOJI.test(JSON.stringify(of("memory").frames))).toBe(true);
  });
  it("collections have their circle again: 'N of M paid' with a roll call, 'Checked ✓' with no amount", () => {
    const [c] = buildStories({ ...base, collections: [{ id: "c1", code: "abc", title: "Teacher’s Day gift", paid: 2, people: 4, in: "₹2,000", target: "₹4,000", paidNames: ["Asha", "Ravi"], dueNames: ["Kabir", "Meera"] }] });
    expect(c).toMatchObject({ kind: "collect", short: "Collection", href: "/c/abc", emoji: "🪙", big: "2/4", headline: "Teacher’s Day gift: 2 of 4 paid" });
    const roll = c.frames.find((f) => f.kind === "list");
    expect(roll && roll.kind === "list" && roll.rows.map((r) => r.value)).toEqual(["Checked ✓", "Checked ✓", "Not yet", "Not yet"]);
  });
  it("Home passes no moments to the stories and does not even load them; Memories is the only place for moments", () => {
    const home = src("src/app/(home)/page.tsx");
    expect(home).not.toContain("loadMomentStoryGroups");
    expect(home).not.toMatch(/\bmoments: /);
    expect(home).toContain("loadHomeMemories(memberships)");
    expect(buildStories({ ...base }).some((x) => x.kind === "moment")).toBe(false);
  });
  it("the viewer has the paper-tape handwritten sticker, handwritten lines in warm cream, the accent rule on posters and the big headlines; the safety rules stay", () => {
    const ui = src("src/components/Stories.tsx");
    expect(ui).toContain("-rotate-[4deg] bg-[#f4f2ec]");
    expect(ui).toContain("font-hand text-[25px]");
    expect(ui).toContain("text-[#ffd9a8]");
    expect(ui).toContain('<span aria-hidden className="mt-5 block h-[3px] w-14 rounded-full"');
    expect(ui).toContain("text-[clamp(34px,10.5vw,44px)]");
    expect(ui).toContain("unoptimized={isOwnApi(f.photo)}");
    expect(ui).toContain("const empty =");
    expect(ui).toContain("money(r) && r.good");
  });
});

describe("Memories: one tilted polaroid and a quiet line, a group link, and See all to the Memories page", () => {
  const ui = src("src/components/MemoryPolaroids.tsx");
  it("collapsed is the newest moment as a tilted polaroid (caption in handwriting, group under it) with up to two behind it, and the line 'Little moments, shared together.' with a swoosh; 'See all' opens the grid", () => {
    expect(ui).toContain("data-memories-collapsed");
    expect(ui).toContain("const first = memories[0]");
    expect(ui).toContain("memories.slice(1, 3)");
    expect(ui).toContain("-rotate-[3deg]");
    expect(ui).toContain("font-hand");
    expect(ui).toContain("data-memory-lead");
    expect(ui).toContain("Little moments, shared together.");
    expect(ui).toContain("data-swoosh");
    // "See all" is a link to /memories, only when there is more than the one memory shown; the group name is its own link.
    expect(ui).toContain('href="/memories"');
    expect(ui).toContain("hasMoreMemories(memories.length)");
    expect(ui).toContain("data-memories-see-all");
    expect(ui).toContain("data-memories-group-link");
    expect(ui).toContain("groupMemoriesHref(first.groupId)");
    expect(ui).toContain("memories →");
    expect(ui).not.toContain("grid grid-cols-2");
    expect(ui).toContain("data-memory-caption");
    expect(ui).toContain("data-memory-group");
    expect(ui).toContain("href={first.href}");
    expect(ui).toContain("if (memories.length === 0) return null;");
  });
});

describe("the money card is the mockup's: label, exact amount, who and where, faces, ONE cream pill, the photo on the right", () => {
  const hm = src("src/components/HomeMoney.tsx");
  const line = (o: Partial<Parameters<typeof sideLine>[0]>) => ({ side: "owe" as const, count: 2, name: "2 people", groupNames: ["Thailand Trip"], ...o });
  it("the words: 'To 2 people · Thailand Trip', 'To Asha · Thailand trip', 'From 3 people · 2 groups', no group name: just who", () => {
    expect(sideLine(line({}))).toBe("To 2 people · Thailand Trip");
    expect(sideLine(line({ count: 1, name: "Asha", groupNames: ["Thailand trip"] }))).toBe("To Asha · Thailand trip");
    expect(sideLine(line({ side: "owed", count: 3, name: "3 flatmates", groupNames: ["Flat 402", "Goa"] }))).toBe("From 3 people · 2 groups");
    expect(sideLine(line({ side: "owed", count: 1, name: "Kabir", groupNames: [] }))).toBe("From Kabir");
    expect(cardLabel("owe")).toBe("You owe");
    expect(cardLabel("owed")).toBe("You’re owed");
  });
  it("the button: 'Review & settle' when you owe (same href, same key); the existing 'Remind Kabir' / 'Remind 3 people' when owed", () => {
    const act = (label: string) => ({ key: "pay" as const, label, fullLabel: label, href: "/settle#pay-x", bright: true });
    expect(buttonLabel({ side: "owe", action: act("Pay Asha") })).toBe("Review & settle");
    expect(buttonLabel({ side: "owed", action: { ...act("Remind Kabir"), key: "remind" as const } })).toBe("Remind Kabir");
    expect(buttonLabel({ side: "owed", action: { ...act("Remind 3 people"), key: "remind" as const } })).toBe("Remind 3 people");
    // the card keeps the action's own key and address; only the words change
    expect(hm).toContain("label: buttonLabel(line), fullLabel:");
    expect(hm).toContain("data-money-action={a.key}");
  });
  it("amount size by length: 8 characters or fewer is big, 9 to 10 middle, longer is smallest (so a lakh amount is never clipped)", () => {
    expect(homeAmountTier("₹19,054.88")).toBe("l"); // 10 characters
    expect(homeAmountTier("₹5,412")).toBe("xl"); // 6
    expect(homeAmountTier("₹6,17,283.94")).toBe("m"); // 12
    expect(homeAmountTier("₹12,34,567.88")).toBe("m"); // 13
  });
  it("one rounded card (22px) with a photo on the right and a curved edge; the data hooks stay; the compact boarding pass is not on Home", () => {
    expect(hm).toContain("rounded-[22px]");
    expect(hm).toContain("clip-path:ellipse(");
    expect(hm).toContain("data-card-photo");
    for (const h of ["data-balance-card", "data-money-mode", "data-tone", "data-ticket", "data-net-balance", "data-money-people", "data-money-action", "data-ticket-line", "data-settled-stamp", "data-square-add"]) expect(hm).toContain(h);
    // The need line is gone from Home: no line under the card, and Home passes no `need` to it.
    expect(hm).not.toContain("data-need-line");
    expect(hm).not.toContain("NeedLineView");
    expect(src("src/app/(home)/page.tsx")).not.toContain("need={");
    expect(hm).not.toContain("CompactBody");
    expect(hm).not.toContain("CompactRoute");
    expect(hm).toContain("text-owe");
    expect(hm).toContain("text-owed");
    expect(hm).toContain("<ActionButton a={action}");
    // all square: the label, "All square", "Nobody owes anybody", a quiet link, the stamp
    expect(hm).toContain('Your money</p>');
    expect(hm).toContain("Add an expense");
    expect(src("src/app/(home)/page.tsx")).not.toContain("compact");
  });
});

describe("Your groups: polaroids as in the mockup", () => {
  it("the + New group tile and two whole polaroids fit a phone row (each at most 150px), one status word, the + New group tile and See all stay", () => {
    const g = src("src/components/HomeGroups.tsx");
    expect(g).toContain("w-[72px]");
    expect(g).not.toContain("w-[88px]");
    expect(g).toContain("w-[calc((100%-72px-24px)/2)] max-w-[150px]");
    expect(g).toContain('className="w-full"');
    expect(g).toContain('sizes="(max-width: 430px) 40vw, 150px"');
    expect(g).toContain('photoClass="aspect-square max-h-[104px]"');
    expect(g).not.toContain("124px");
    expect(g).toContain("data-group-card-new");
    expect(g).toContain("data-group-card-end");
    expect(src("src/app/(home)/page.tsx")).toContain("See all\n");
  });
});

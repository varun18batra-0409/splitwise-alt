import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GROUP_TYPES } from "@/lib/group-types";
import { sheetFor } from "@/lib/group-type-sheet";
import { STORY_POOLS, namesThePlace, storyLines } from "@/lib/home/story-lines";
import { buildStories } from "@/lib/home/stories";
import { tripStops } from "@/lib/geo";
import { placeSlot } from "@/lib/places";
import { climateFor } from "@/lib/climate";
import { guessCategory } from "@/lib/categories";
import { sameDayLater } from "@/lib/dates";
import { afterTripNudge } from "@/lib/countdown";
import { rareOpen, rareWindow } from "@/lib/postcards/catalog";
import { stampShortName } from "@/components/stamps/StampArt";
import { AI_DOWN, aiAllowed, readBill, readLine } from "@/lib/ai";

// Review of 23 Nov: wording and automatic content. Hand-worked expectations; the text checks read the source of the screens.
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const SRC = walk(join(root, "src")).filter((f) => !f.includes("/generated/"));

describe("the founder's names", () => {
  it("the 'Home' group type is called 'Flat or family' (the stored value stays 'home')", () => {
    const t = GROUP_TYPES.find((x) => x.id === "home")!;
    expect(t.label).toBe("Flat or family");
    expect(GROUP_TYPES.map((x) => x.id)).toContain("home");
    expect(sheetFor("home", "g1")?.title).toBe("Your flat or family group is ready");
  });
  it("the invite card, the join page, the tour, the FAQ and How Loopin works use it", () => {
    expect(read("src/components/InvitationCard.tsx")).toContain('type === "home" ? "Flat or family"');
    expect(read("src/app/join/[code]/page.tsx")).toContain('group.type === "home" ? "Flat or family"');
    expect(read("src/components/IntroTour.tsx")).toContain('["Trip", "Flat or family", "Couple", "Game night"]');
    expect(read("src/app/faq/page.tsx")).toContain("Make a Flat or family group");
    expect(read("src/app/how-it-works/page.tsx")).toContain("<strong>Flat or family</strong>");
    expect(read("src/app/(home)/page.tsx")).toContain('["home", "Flat or family", "Flat expenses"]');
  });
  it("money with one person is 'With a person': no 'Non-group' and no 'Direct' label anywhere on screen", () => {
    for (const f of SRC) {
      const text = read(f.slice(root.length + 1)).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
      expect(/Non-group/.test(text), `${f} says Non-group`).toBe(false);
      expect(/groupName: "Direct"|groupLine: "Direct"|groupLine="Direct"|groupName="Direct"|"Direct · /.test(text), `${f} says Direct`).toBe(false);
    }
    expect(read("src/lib/home/money-card.ts")).toContain("With a person");
    expect(read("src/app/settle/page.tsx")).toContain("With a person · only you can see this");
    expect(read("src/app/settle/page.tsx")).toContain("WITH A PERSON");
  });
});

describe("joining wording (F1, VI4, VD-3)", () => {
  it("the FAQ, How Loopin works and the invite screen say friends join with just a name", () => {
    const faq = read("src/app/faq/page.tsx");
    expect(faq).toContain("Friends can join a group with just a name");
    expect(faq).toContain("needed for postcards and the passport");
    const how = read("src/app/how-it-works/page.tsx");
    expect(how).toContain("Friends can join with just a name, no account needed");
    expect(how).toContain("needed for postcards and the passport");
    const invite = read("src/app/groups/[id]/invite/page.tsx");
    expect(invite).toContain("Anyone with the link or code can join with just a name");
    expect(invite).not.toContain("ask to join");
    expect(invite).not.toContain("after signing up");
  });
  it("the FAQ puts 'Invite friends to Loopin' on the You page only (F12)", () => {
    expect(read("src/app/faq/page.tsx")).toContain("tap Invite friends to Loopin on the You page.");
    expect(read("src/app/faq/page.tsx")).not.toContain("on Home or the You page");
  });
  it("on iPhone the Home Screen app's own groups are explained in the install sheet (VI5)", () => {
    const g = read("src/components/GetApp.tsx");
    expect(g).toContain('platform.startsWith("ios")');
    expect(g).toContain("the Home Screen app keeps its own groups");
  });
});

describe("F4: the season line", () => {
  const lines = (o: Parameters<typeof storyLines>[0]) => storyLines({ n: 12, people: 4, seed: "t", ...o }).map(([k]) => k).join("|");
  it("never defaults to India: no country, no season line", () => {
    expect(STORY_POOLS.seasonLines(6, null)).toEqual([]);
    expect(STORY_POOLS.seasonLines(6, "")).toEqual([]);
    expect(STORY_POOLS.seasonLines(6, undefined)).toEqual([]);
  });
  it("a December beach trip in Goa gets no 'Winter trip: layers'", () => {
    expect(lines({ month: 11, country: "IN", city: "Goa", mood: "beach", home: "IN" })).not.toMatch(/Winter|Cosy/);
    expect(STORY_POOLS.seasonLines(11, "IN", { city: "Goa" })).toEqual([]); // Goa in December is 33°/21°: warm all year
  });
  it("tropical countries and beach trips skip it, a cold place keeps it", () => {
    expect(STORY_POOLS.seasonLines(11, "TH")).toEqual([]);
    expect(STORY_POOLS.seasonLines(0, "GB", { mood: "beach" })).toEqual([]);
    expect(STORY_POOLS.seasonLines(0, "GB")[0][0]).toBe("Winter trip");
    expect(STORY_POOLS.seasonLines(0, "AU")[0][0]).toBe("Summer trip"); // January in the south
  });
  it("Ladakh in July is not monsoon", () => {
    expect(STORY_POOLS.seasonLines(6, "IN", { city: "Ladakh" }).map((l) => l[0])).not.toContain("Monsoon mode");
    expect(STORY_POOLS.seasonLines(6, "IN", { text: "Leh trip" }).map((l) => l[0])).not.toContain("Monsoon mode");
    expect(STORY_POOLS.seasonLines(6, "IN", { city: "Mumbai" }).map((l) => l[0])).toContain("Monsoon mode");
  });
  it("Chennai's rain is October to December, not June to September", () => {
    expect(STORY_POOLS.seasonLines(6, "IN", { city: "Chennai" }).map((l) => l[0])).not.toContain("Monsoon mode"); // July
    for (const m of [9, 10, 11]) expect(STORY_POOLS.seasonLines(m, "IN", { city: "Chennai" }).map((l) => l[0]), `month ${m}`).toContain("Monsoon mode");
    expect(STORY_POOLS.seasonLines(8, "IN", { city: "Chennai" }).map((l) => l[0])).not.toContain("Monsoon mode"); // September
  });
});

describe("F5: hand-written place lines only for that exact place", () => {
  const goa = new Set(STORY_POOLS.PLACE.goa.map(([, l]) => l));
  const manali = new Set(STORY_POOLS.PLACE.manali.map(([, l]) => l));
  const all = (o: Parameters<typeof storyLines>[0]) => storyLines({ n: 12, people: 4, seed: "t", home: "IN", ...o }).map(([k, l]) => `${k}: ${l}`);
  it("a Manali trip gets Manali's own lines", () => {
    const l = storyLines({ n: 12, people: 4, seed: "t", place: "place-manali", placeText: "Manali trip Manali", country: "IN", city: "Manali" });
    expect(l.some(([, x]) => manali.has(x))).toBe(true);
  });
  it("a Shimla trip (the same photo slot) does not say 'Hello Manali'", () => {
    expect(placeSlot("Shimla trip")).toBe("place-manali");
    const l = all({ place: "place-manali", placeText: "Shimla trip Shimla", country: "IN", city: "Shimla", countryName: "India" });
    expect(l.join(" | ")).not.toMatch(/Manali/);
    expect(l.join(" | ")).toContain("Shimla by day, Shimla by night"); // the generic city line
  });
  it("Jodhpur is not 'Pink City', Dehradun is not Mussoorie, Goa's neighbours keep their own", () => {
    expect(namesThePlace("jaipur", "Jodhpur trip Jodhpur")).toBe(false);
    expect(namesThePlace("jaipur", "Jaipur weekend")).toBe(true);
    expect(namesThePlace("mussoorie", "Dehradun")).toBe(false);
    expect(namesThePlace("delhi", "Gurgaon offsite")).toBe(false);
    expect(namesThePlace("goa", "Palolem")).toBe(true);
  });
  it("a country's own lines fit a place in that country (Bangkok gets the Thailand lines)", () => {
    expect(namesThePlace("thailand", "Boys trip Bangkok", "TH")).toBe(true);
    expect(namesThePlace("thailand", "Boys trip", "IN")).toBe(false);
  });
  it("with no trip text given (older callers) the slot decides, as before", () => {
    const l = storyLines({ n: 12, people: 4, seed: "t", place: "place-goa", mood: "beach" });
    expect(l.some(([, x]) => goa.has(x))).toBe(true);
  });
});

describe("F6: 'home' is the viewer's own country", () => {
  const text = (o: Parameters<typeof storyLines>[0]) => storyLines({ n: 14, people: 4, seed: "t", ...o }).map(([k, l]) => `${k}: ${l}`).join(" | ");
  it("an Indian viewer's trip to Agra: no new stamp, no 'learn Namaste', no rupees tip", () => {
    const t = text({ country: "IN", countryName: "India", flag: "🇮🇳", city: "Agra", home: "IN" });
    expect(t).not.toMatch(/New stamp|Learn one word|Carry a little/);
    expect(t).toContain("Agra by day");
  });
  it("a US viewer's trip to Chicago: nothing about a new stamp or the local word", () => {
    const t = text({ country: "US", countryName: "United States", flag: "🇺🇸", city: "Chicago", home: "US" });
    expect(t).not.toMatch(/New stamp|Learn one word|Carry a little/);
  });
  it("an Indian viewer abroad still gets the stamp, the word and the money line; a US viewer in India gets them too", () => {
    const th = text({ country: "TH", countryName: "Thailand", flag: "🇹🇭", city: "Bangkok", home: "IN" });
    expect(th).toMatch(/New stamp: Thailand/);
    expect(th).toContain("Learn one word: “Sawasdee”");
    expect(th).toContain("Carry a little baht");
    expect(text({ country: "IN", countryName: "India", flag: "🇮🇳", city: "Agra", home: "US" })).toContain("Learn one word: “Namaste”");
  });
  it("when the viewer's home is not known nothing is guessed: the home-or-away lines are left out", () => {
    expect(text({ country: "TH", countryName: "Thailand", flag: "🇹🇭", city: "Bangkok" })).not.toMatch(/New stamp|Learn one word|Carry a little/);
  });
});

describe("F15: couple lines for couple groups only", () => {
  it("two colleagues on a trip get neutral words; a couple keeps its own", () => {
    const two = JSON.stringify(STORY_POOLS.crewLines(2));
    expect(two).not.toMatch(/Couple goals|💛/);
    expect(STORY_POOLS.crewLines(2).map(([k]) => k)).toContain("Just you two");
    expect(JSON.stringify(STORY_POOLS.crewLines(2, true))).toContain("Couple goals");
    expect(JSON.stringify(storyLines({ people: 2, seed: "x", n: 10 }))).not.toMatch(/Couple goals/);
    expect(JSON.stringify(storyLines({ people: 2, seed: "x", n: 10, couple: true }))).toMatch(/Couple goals|Table for two/);
  });
});

describe("F14: the year-ago story", () => {
  const base = { now: new Date("2026-11-13T12:00:00Z"), trips: [], games: [], squared: [], collections: [], wrapped: [] };
  const memory = (name: string, people: number) => buildStories({ ...base, memories: [{ id: "m1", name, years: 1, people, days: 4 }] }).find((s) => s.kind === "memory")!;
  it("a Ladakh trip shows the mountain, not a palm, and a beach trip keeps the palm", () => {
    expect(memory("Ladakh trip", 4).line).toContain("🏔️");
    expect(memory("Ladakh trip", 4).line).not.toContain("🌴");
    expect(JSON.stringify(memory("Ladakh trip", 4).frames)).not.toContain("🌴");
    expect(memory("Goa trip", 4).line).toContain("🌴");
  });
  it("one person still in is 'Just you', never '1 of you'", () => {
    const s = memory("Ladakh trip", 1);
    expect(s.line).toBe("Just you, 4 days. Remember that? 🏔️");
    expect(JSON.stringify(s.frames)).toContain("Just you. Zero regrets.");
    expect(JSON.stringify(s.frames)).not.toContain("1 of you");
    expect(memory("Ladakh trip", 4).line).toBe("4 of you, 4 days. Remember that? 🏔️");
  });
  it("Home counts only people still in the group", () => {
    expect(read("src/app/(home)/page.tsx")).toContain("people: g.group.members.filter((m) => !m.leftAt).length,\n            days:");
  });
});

describe("F7: no country-wide weather for Mexico, Japan, New Zealand, Turkey", () => {
  it("an unknown city in those countries shows no card; a known city still does", () => {
    for (const cc of ["MX", "JP", "NZ", "TR"]) expect(climateFor("Somewhere", cc, 0), cc).toBeNull();
    expect(climateFor("Mexico City", "MX", 0)).toBeNull(); // no Mexico City row either: nothing rather than Cancún's 28°
    expect(climateFor("Tokyo", "JP", 0)).toMatchObject({ hi: 10, lo: 2 });
    expect(climateFor("Bangkok", "TH", 0)).not.toBeNull();
  });
});

describe("F8: guessing the place from words", () => {
  it("'New Mexico' is not Mexico", () => {
    expect(tripStops("New Mexico road trip")).toEqual([{ city: "New Mexico", country: "US" }]);
    expect(tripStops("Mexico trip")).toEqual([{ city: "", country: "MX" }]);
    expect(tripStops("Mexico City")).toEqual([{ city: "Mexico City", country: "MX" }]);
  });
  it("'Georgia's' is a person, not the country; the others are unchanged", () => {
    expect(tripStops("Georgia’s birthday")).toEqual([]);
    expect(tripStops("Georgia's birthday")).toEqual([]);
    expect(tripStops("Georgia trip")).toEqual([{ city: "", country: "GE" }]);
    expect(tripStops("Atlanta, Georgia")).toEqual([{ city: "Atlanta", country: "US" }]);
  });
  it("a bare 'Taj' is not Agra; 'Taj Mahal' is", () => {
    expect(tripStops("Taj lunch")).toEqual([]);
    expect(placeSlot("Taj lunch")).toBeNull();
    expect(tripStops("Taj Mahal visit")).toEqual([{ city: "Agra", country: "IN" }]);
    expect(placeSlot("Agra day trip")).toBe("cover-taj");
    expect(placeSlot("Taj Mahal")).toBe("cover-taj");
  });
  it("'UK trip' alone is not the United Kingdom (it can be Uttarakhand); the full words still are", () => {
    expect(tripStops("UK trip")).toEqual([]);
    expect(tripStops("United Kingdom trip")).toEqual([{ city: "", country: "GB" }]);
    expect(tripStops("England in summer")).toEqual([{ city: "", country: "GB" }]);
    expect(placeSlot("UK trip")).toBeNull();
    expect(placeSlot("London UK")).toBe("place-london");
  });
});

describe("F11: Holi and Diwali move with the year", () => {
  const at = (d: string) => new Date(`${d}T06:00:00Z`);
  it("windows, hand-worked: Diwali 8 Nov 2026 = 25 Oct to 11 Nov; Diwali 17 Oct 2028 = 3 to 20 Oct; Holi 11 Mar 2028 = 28 Feb to 14 Mar", () => {
    expect(rareWindow("diwali", at("2026-06-01"))).toEqual({ from: "10-25", to: "11-11" });
    expect(rareWindow("diwali", at("2028-06-01"))).toEqual({ from: "10-03", to: "10-20" });
    expect(rareWindow("holi", at("2028-01-10"))).toEqual({ from: "02-28", to: "03-14" });
    expect(rareWindow("holi", at("2040-01-10"))).toEqual({ from: "03-10", to: "03-25" }); // a year not listed: the usual window
    expect(rareWindow("kites", at("2028-01-10"))).toEqual({ from: "01-10", to: "01-16" });
  });
  it("Diwali 2028 (17 Oct) is on issue in mid October, and no longer on 5 Nov (the old fixed window said yes)", () => {
    expect(rareOpen("r:diwali", at("2028-10-10"))).toBe(true);
    expect(rareOpen("r:diwali", at("2028-11-05"))).toBe(false);
    expect(rareOpen("r:diwali", at("2026-11-10"))).toBe(true);
    expect(rareOpen("r:diwali", at("2026-11-13"))).toBe(false);
  });
  it("Holi 2028 (11 Mar) is on issue on 5 Mar (the old window started on 10 Mar)", () => {
    expect(rareOpen("r:holi", at("2028-03-05"))).toBe(true);
    expect(rareOpen("r:holi", at("2028-03-20"))).toBe(false);
  });
});

describe("F13: nothing says 'rupee' for every currency", () => {
  it("the Wrapped poster and the game-night FAQ are currency-neutral", () => {
    expect(read("src/lib/home/stories.ts")).not.toContain("Worth every rupee");
    expect(read("src/lib/home/stories.ts")).toContain("Was it worth it? Discuss.");
    expect(read("src/app/faq/page.tsx")).not.toContain("every rupee");
  });
});

describe("F16: 'gas' and 'dune'", () => {
  it("a lone 'Gas' outside India is travel; in India (or unsaid) it is still the cooking-gas bill", () => {
    expect(guessCategory("Gas", { india: false })).toBe("transport");
    expect(guessCategory("Gas $45.20", { india: false })).toBe("transport");
    expect(guessCategory("Gas bill", { india: false })).toBe("bills");
    expect(guessCategory("Gas", { india: true })).toBe("bills");
    expect(guessCategory("Gas")).toBe("bills");
  });
  it("'Dune bashing' is an activity, not food", () => {
    expect(guessCategory("Dune bashing")).toBe("activities");
    expect(guessCategory("Desert safari with dune bashing")).toBe("activities");
  });
  it("saving an expense passes whether it was in rupees", () => {
    expect(read("src/lib/save-expense.ts")).toContain('guessCategory(name, { india: group.currency === "INR" || input.currency === "INR" })');
  });
});

describe("F17: the AI helper's own messages", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterAll(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });
  it("an outage (a 500, or no connection) is told apart from 'answered, nothing clear'", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const people = [{ id: "a", name: "Asha" }];
    expect(await readLine("cab 600", people, "a")).toBe(AI_DOWN);
    expect(await readBill(new Uint8Array([1, 2, 3]), "image/jpeg")).toBe(AI_DOWN);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await readLine("cab 600", people, "a")).toBe(AI_DOWN);
    // It did answer, with nothing in it: that is "unclear", not an outage.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [] }), { status: 200 })));
    expect(await readLine("cab 600", people, "a")).toBeNull();
  });
  it("the typed-line screen gets its own outage and limit words", async () => {
    const act = read("src/app/ai-actions.ts");
    expect(act).toContain("if (r === AI_DOWN) return { ok: false, error: AI_DOWN_LINE };");
    expect(act).toContain('aiAllowed(me.accountId ?? me.id, "line")');
    expect(read("src/app/api/receipt/route.ts")).toContain("AI_DOWN_BILL");
    delete process.env.ANTHROPIC_API_KEY;
    expect(await aiAllowed("someone", "bill")).toBe("Reading bills isn’t switched on yet.");
    expect(await aiAllowed("someone", "line")).toBe("Reading typed lines isn’t switched on yet. Fill the form in by hand.");
    expect(await aiAllowed("someone", "line")).not.toMatch(/bill/i);
  });
});

describe("F18, F19, F20 and VA1-20: small fixes", () => {
  it("'1 expense', not '1 expenses'; the chip says 'Clear'", () => {
    const s = read("src/app/search/page.tsx");
    expect(s).toContain('${n} ${n === 1 ? "expense" : "expenses"}');
    expect(s).toContain("Clear ✕");
    expect(s).not.toContain("All ✕");
  });
  it("'In a month' never spills into the next month; 'A year from today' never lands on 1 March", () => {
    const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
    const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
    expect(ymd(sameDayLater(d(2026, 1, 31), 1))).toBe("2026-2-28"); // not 3 March
    expect(ymd(sameDayLater(d(2028, 1, 31), 1))).toBe("2028-2-29"); // a leap year
    expect(ymd(sameDayLater(d(2026, 3, 31), 1))).toBe("2026-4-30");
    expect(ymd(sameDayLater(d(2026, 12, 31), 1))).toBe("2027-1-31");
    expect(ymd(sameDayLater(d(2026, 11, 23), 1))).toBe("2026-12-23");
    expect(ymd(sameDayLater(d(2028, 2, 29), 12))).toBe("2029-2-28");
    expect(ymd(sameDayLater(d(2026, 11, 23), 12))).toBe("2027-11-23");
    const send = read("src/app/postcards/new/editor/SendStep.tsx");
    expect(send).toContain("sameDayLater(now, 1)");
    expect(send).toContain("sameDayLater(now, 12)");
  });
  it("the Sign in link on the tour's last step marks the tour seen, like the other links", () => {
    expect(read("src/components/IntroTour.tsx")).toContain("<Link href={signInHref} onClick={seen}");
  });
});

describe("F22: the day after a trip, all square", () => {
  it("the all-square push does not ask anyone to settle", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) {
      const sq = afterTripNudge({ id, name: "Goa trip" }, true);
      expect(sq, id).toContain("Goa");
      expect(sq, id).not.toMatch(/settle up|clear the balances/i);
      expect(sq, id).toMatch(/square|nobody owes/i);
    }
    expect(afterTripNudge({ id: "a", name: "Goa trip" })).toMatch(/settle up|Clear the balances/i);
  });
});

describe("F22 in the database: only a trip with something owed asks to settle", () => {
  it("the all-square trip opens the group; the one with a balance opens Settle up", async () => {
    // (A separate file would be needed to mock the push for the whole job; the same rule is read straight from the job's source.)
    const job = read("src/lib/countdown-db.ts");
    expect(job).toContain("ledgerInTx(tx, g.id)");
    expect(job).toContain("l.transfers.length === 0");
    expect(job).toContain("const where = square ? `/groups/${g.id}` : `/groups/${g.id}/settle`;");
    expect(job).toContain("afterTripNudge(g, square)");
  });
});

describe("VA4-6: long country names on stamps are written short", () => {
  it("UAE, UK and USA", () => {
    expect(stampShortName("United Arab Emirates")).toBe("UAE");
    expect(stampShortName("United Kingdom")).toBe("UK");
    expect(stampShortName("United States")).toBe("USA");
    expect(stampShortName("Thailand")).toBe("Thailand");
    expect(read("src/components/stamps/StampArt.tsx")).toContain("const shortName = stampShortName(s.name);");
  });
});

describe("wording fixes", () => {
  it("VA1-4: one name for the first-abroad badge", () => {
    expect(read("src/lib/passport.ts")).not.toContain("First flight");
    // The milestone and the badge both use the one name (a code comment may mention it too).
    const src = read("src/lib/passport.ts");
    expect(src).toContain('milestones.push("First trip abroad")');
    expect(src).toMatch(/badge\("first-abroad", "[^"]*", "First trip abroad"/);
  });
  it("VA1-6: 'safe in your account', not 'in your email'", () => {
    const p = read("src/app/account/sign-in/page.tsx");
    expect(p).toContain("stay safe in your account");
    expect(p).not.toContain("safe in your email");
  });
  it("VA1-7: 'fingerprint or face', never with a slash", () => {
    for (const f of SRC) expect(read(f.slice(root.length + 1)).includes("fingerprint / face"), f).toBe(false);
  });
  it("VA1-9, VA2-20, VI14: 'Tap for more', not 'Tap or click'; the pay link says who to tell", () => {
    expect(read("src/components/WrappedDeck.tsx")).not.toContain("Tap or click");
    expect(read("src/components/WrappedDeck.tsx")).toContain("Tap for more");
    expect(read("src/app/p/[token]/page.tsx")).toContain("`Then let ${to} know`");
    expect(read("src/app/p/[token]/page.tsx")).not.toContain("Then tell them");
  });
  it("VA1-3: a future total date is 'Totals on', a past one 'Totalled'", () => {
    expect(read("src/app/groups/[id]/page.tsx")).toContain('${b.due < today ? "Totalled" : "Totals on"} ${niceDate(b.due)}');
  });
  it("VA1-30: the pill that opens Add people says Add people", () => {
    const h = read("src/app/groups/[id]/_components/GroupHeader.tsx");
    expect(h).toContain("<InviteIcon size={18} />\n              Add people");
  });
  it("VA2-16: the 'new person' box suggests a name nobody is listed under", () => {
    expect(read("src/app/add/person/page.tsx")).toContain('placeholder="Priya"');
  });
  it("VD-4: the country option no longer says '(from the name)'", () => {
    expect(read("src/components/WhereTo.tsx")).not.toContain("(from the name)");
  });
  it("VD-9: the stories hint has a mouse version", () => {
    const s = read("src/components/Stories.tsx");
    expect(s).toContain("hover: hover) and (pointer: fine");
    expect(s).toContain("Use the button to open, Esc to close.");
    expect(s).toContain("Swipe up to open, down to close.");
  });
  it("VD-12: '1 group … get it back'", () => {
    expect(read("src/app/account/page.tsx")).toContain('get {groupCount === 1 ? "it" : "them"} back.');
  });
  it("VA4-14: an empty week says so", () => {
    expect(read("src/app/search/Insights.tsx")).toContain("Nothing spent this ");
  });
  it("VI6: a phone with no voice says so, instead of 'Didn’t catch that'", () => {
    const q = read("src/components/QuickLine.tsx");
    expect(q).toContain("Voice isn’t available on this phone right now. Type it instead.");
    expect(q).toContain('e.error === "service-not-allowed"');
  });
  it("VI7: the notifications note gives the same Share steps as the install sheet", () => {
    expect(read("src/components/PushControls.tsx")).toContain("Share ⬆︎");
    expect(read("src/components/PushControls.tsx")).toContain("older iPhones: Share ⬆︎ in the bottom bar");
  });
  it("VA3-5: a goal on a flat does not offer a 'trip group'", () => {
    const g = read("src/app/groups/[id]/goals/[goalId]/page.tsx");
    expect(g).toContain('group.type === "trip" ?');
    expect(g).toContain("Start a group for “{goal.name}”");
  });
  it("VA2-4: the payment note on a person's page shows only when something is owed", () => {
    expect(read("src/app/people/[id]/page.tsx")).toContain("{net !== 0 && (\n        <p className=\"mt-6 px-1 text-[13.5px] leading-snug text-fg/60\" data-settle-footnote>");
  });
  it("VA1-16: the want-to-go sharing rule is said once, with what to do about it", () => {
    const w = read("src/components/want/WishShareSheet.tsx");
    expect(w).toContain("A locked tick means that friend sees your whole list. To stop that, pick “Whole list” above and untick them.");
    expect(w).not.toContain("can’t be hidden from them here");
  });
});

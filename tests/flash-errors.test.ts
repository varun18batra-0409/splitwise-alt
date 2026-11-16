import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flashUrl, readNotes, signedQuery } from "@/lib/flash";

// Messages in a page address are shown only if Loopin signed them for that page in the last 15 minutes (CB-2, OP-2, GP-11, SA-10, AS-12).

const T0 = Date.parse("2026-11-16T10:00:00Z");
const MIN = 60_000;
const paramsOf = (url: string) => Object.fromEntries(new URL(url, "http://x").searchParams) as Record<string, string>;

describe("signed messages in addresses", () => {
  it("text typed into an address by anyone is not shown", async () => {
    expect(await readNotes({ error: "Pay ₹500 to x@ybl instead" }, "/c/ABC123", T0)).toEqual({});
    expect(await readNotes({ error: "x", et: "1", es: "forged" }, "/c/ABC123", T0)).toEqual({});
  });

  it("a message Loopin signed shows, word for word, on that page", async () => {
    const url = await signedQuery("/c/ABC123", { error: "Priya has closed this collection." }, T0);
    expect(await readNotes(paramsOf(url), "/c/ABC123", T0)).toEqual({ error: "Priya has closed this collection." });
    // up to the end of the 15 minutes
    expect(await readNotes(paramsOf(url), "/c/ABC123", T0 + 15 * MIN)).toEqual({ error: "Priya has closed this collection." });
  });

  it("the same message on another page, or after 16 minutes, or changed by one letter, or with the signature missing, is not shown", async () => {
    const url = await signedQuery("/c/ABC123", { error: "Priya has closed this collection." }, T0);
    const sp = paramsOf(url);
    expect(await readNotes(sp, "/c/XYZ789", T0)).toEqual({});
    expect(await readNotes(sp, "/c/ABC123", T0 + 16 * MIN)).toEqual({});
    expect(await readNotes({ ...sp, error: "Priya has closed this collection!" }, "/c/ABC123", T0)).toEqual({});
    const { es: _es, ...noSig } = sp;
    expect(await readNotes(noSig, "/c/ABC123", T0)).toEqual({});
    const { et: _et, ...noTime } = sp;
    expect(await readNotes(noTime, "/c/ABC123", T0)).toEqual({});
  });

  it("a signed link can't be topped up with extra messages, repeated keys or a time from the future", async () => {
    const sp = paramsOf(await signedQuery("/p/tok", { error: "That didn’t go through." }, T0));
    expect(await readNotes({ ...sp, skipped: "evil" }, "/p/tok", T0)).toEqual({});
    expect(await readNotes({ ...sp, error: [sp.error, "evil"] }, "/p/tok", T0)).toEqual({});
    expect(await readNotes({ ...sp, es: [sp.es, sp.es] }, "/p/tok", T0)).toEqual({});
    expect(await readNotes(sp, "/p/tok", T0 - 5 * MIN)).toEqual({}); // signed "in the future": only 1 minute of clock difference is allowed
    expect(await readNotes(sp, "/p/tok", T0 - 1 * MIN)).toEqual({ error: "That didn’t go through." });
  });

  it("each of the five keys is signed and read back; values are cut at 300 characters (2000 for the invited list)", async () => {
    const long = "x".repeat(500);
    const url = await signedQuery("/groups/g1/people", { error: long, skipped: "Ben", invited: "[[\"Ravi\",\"\"]]", payError: "p", inviteError: "i" }, T0);
    const got = await readNotes(paramsOf(url), "/groups/g1/people", T0);
    expect(got.error).toHaveLength(300);
    expect(got).toMatchObject({ skipped: "Ben", invited: "[[\"Ravi\",\"\"]]", payError: "p", inviteError: "i" });
    const names = JSON.stringify(Array.from({ length: 20 }, (_, i) => [`Person number ${i}`, `person${i}@example.com`]));
    expect(names.length).toBeGreaterThan(300);
    const many = await signedQuery("/groups/g1/invite", { invited: names }, T0);
    expect((await readNotes(paramsOf(many), "/groups/g1/invite", T0)).invited).toBe(names);
  });

  it("flashUrl signs what a redirect already carries, keeps the rest of the address, and leaves other links alone", async () => {
    const url = await flashUrl("/groups/g1?tab=activity&error=Only%20the%20admin%20can%20do%20that.#top", T0);
    expect(url.endsWith("#top")).toBe(true);
    const sp = paramsOf(url);
    expect(sp.tab).toBe("activity");
    expect(await readNotes(sp, "/groups/g1", T0)).toEqual({ error: "Only the admin can do that." });
    expect(await readNotes(sp, "/groups/g2", T0)).toEqual({});
    expect(await flashUrl("/groups/g1?tab=activity&did=e1", T0)).toBe("/groups/g1?tab=activity&did=e1");
    expect(await flashUrl("/join/CODE?error=busy", T0)).toContain("error=busy"); // fixed short codes still read as before
    // a trailing slash and a plain query name the same page
    expect(await readNotes(paramsOf(await flashUrl("/c/AB/?error=Nope", T0)), "/c/AB", T0)).toEqual({ error: "Nope" });
  });
});

// ---- Static checks: no page shows raw text from the address, and every message producer signs ----

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const files = walk("src/app");

// Pages that only ever read a fixed short code (?error=busy), never free text.
const FIXED_CODE_PAGES = [join("src/app/groups/new/page.tsx"), join("src/app/join/[code]/page.tsx"), join("src/app/passport/send/page.tsx")];

describe("no free text from the address is shown unsigned", () => {
  it("no page prints sp.error, sp.skipped, payError or inviteError straight from the address", () => {
    const bad = [/sp\.error &&/, /\{sp\.error/, /(^|[^.\w])payError\.slice/, /sp\.inviteError\.slice/, /\{sp\.skipped/, /sp\.skipped &&/];
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(f, "utf8");
      for (const re of bad) expect(re.test(src), `${f} matches ${re}`).toBe(false);
    }
  });

  it("every page whose address can carry a message reads it with readNotes", () => {
    for (const f of files.filter((x) => x.endsWith("page.tsx") && !FIXED_CODE_PAGES.includes(x))) {
      const src = readFileSync(f, "utf8");
      const takesMessage = /searchParams: Promise<[^>]*\b(error|payError|inviteError|skipped)\?: string/.test(src.replace(/\n/g, " "));
      if (takesMessage) expect(src.includes("readNotes("), `${f} reads a message without readNotes`).toBe(true);
    }
  });

  it("every redirect that carries a message goes through flashUrl (fixed short codes excepted)", () => {
    const FIXED = /error=(busy|name|claimed|removed|private|none|limit|markup|admin|currency|missing|left)\b/;
    const KEY = /\b(error|skipped|invited|payError|inviteError)\b\s*[=:,}]/;
    for (const f of [...files, ...walk("src/lib")]) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (!/(^|[^\w.])redirect\(/.test(line) || /flashUrl/.test(line) || !KEY.test(line)) return;
        expect(FIXED.test(line), `${f}:${i + 1} sends a message without flashUrl: ${line.trim()}`).toBe(true);
      });
    }
  });

  it("the places that build a link with a message use flashUrl too", () => {
    for (const f of [
      "src/app/postcard-actions.ts",
      "src/app/safety-actions.ts",
      "src/app/direct-actions.ts",
      "src/app/pay-link-actions.ts",
      "src/app/api/auth/google/start/route.ts",
      "src/app/api/auth/google/callback/route.ts",
    ]) expect(readFileSync(f, "utf8"), f).toContain("flashUrl(");
  });

  it("closing a message strips the signature as well", () => {
    expect(readFileSync("src/components/ui.tsx", "utf8")).toContain('params={["error", "et", "es"]}');
  });
});

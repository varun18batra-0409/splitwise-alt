import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flashTo, flashToAt, isPlainPath, readNotes, readSignedNotes } from "@/lib/flash";

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
    const url = await flashTo("/c/ABC123", { error: "Priya has closed this collection." }, undefined, "", T0);
    expect(await readNotes(paramsOf(url), "/c/ABC123", T0)).toEqual({ error: "Priya has closed this collection." });
    // up to the end of the 15 minutes
    expect(await readNotes(paramsOf(url), "/c/ABC123", T0 + 15 * MIN)).toEqual({ error: "Priya has closed this collection." });
  });

  it("the same message on another page, or after 16 minutes, or changed by one letter, or with the signature missing, is not shown", async () => {
    const url = await flashTo("/c/ABC123", { error: "Priya has closed this collection." }, undefined, "", T0);
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
    const sp = paramsOf(await flashTo("/p/tok", { error: "That didn’t go through." }, undefined, "", T0));
    expect(await readNotes({ ...sp, skipped: "evil" }, "/p/tok", T0)).toEqual({});
    expect(await readNotes({ ...sp, error: [sp.error, "evil"] }, "/p/tok", T0)).toEqual({});
    expect(await readNotes({ ...sp, es: [sp.es, sp.es] }, "/p/tok", T0)).toEqual({});
    expect(await readNotes(sp, "/p/tok", T0 - 5 * MIN)).toEqual({}); // signed "in the future": only 1 minute of clock difference is allowed
    expect(await readNotes(sp, "/p/tok", T0 - 1 * MIN)).toEqual({ error: "That didn’t go through." });
  });

  it("each of the five keys is signed and read back; values are cut at 300 characters (the invited list is kept whole up to 8000, or not shown)", async () => {
    const long = "x".repeat(500);
    const url = await flashTo("/groups/g1/people", { error: long, skipped: "Ben", invited: "[[\"Ravi\",\"\"]]", payError: "p", inviteError: "i" }, undefined, "", T0);
    const got = await readNotes(paramsOf(url), "/groups/g1/people", T0);
    expect(got.error).toHaveLength(300);
    expect(got).toMatchObject({ skipped: "Ben", invited: "[[\"Ravi\",\"\"]]", payError: "p", inviteError: "i" });
    const names = JSON.stringify(Array.from({ length: 20 }, (_, i) => [`Person number ${i}`, `person${i}@example.com`]));
    expect(names.length).toBeGreaterThan(300);
    const many = await flashTo("/groups/g1/invite", { invited: names }, undefined, "", T0);
    expect((await readNotes(paramsOf(many), "/groups/g1/invite", T0)).invited).toBe(names);
  });

  it("flashTo puts the message on the page it names, keeps the plain extras and the #part, and gives plain links when there is no message", async () => {
    const url = await flashTo(["groups", "g1"], { error: "Only the admin can do that." }, { tab: "activity" }, "top", T0);
    expect(url.endsWith("#top")).toBe(true);
    const sp = paramsOf(url);
    expect(sp.tab).toBe("activity");
    expect(await readNotes(sp, "/groups/g1", T0)).toEqual({ error: "Only the admin can do that." });
    expect(await readNotes(sp, "/groups/g2", T0)).toEqual({});
    expect(await flashTo(["groups", "g1"], {}, { tab: "activity", did: "e1" })).toBe("/groups/g1?tab=activity&did=e1");
    expect(await flashTo("/join/CODE", {}, { error: "busy" })).toBe("/join/CODE"); // extras can't carry a message key; fixed codes are written by hand
    // a trailing slash and a plain query name the same page
    expect(await readNotes(paramsOf(await flashTo("/c/AB/", { error: "Nope" }, undefined, "", T0)), "/c/AB", T0)).toEqual({ error: "Nope" });
  });

  it("an id typed by someone can't make Loopin sign text for another page (the ../signin?error= attack)", async () => {
    const evil = "../signin?error=Pay ₹500 to x@ybl&z=";
    for (const url of [
      await flashTo(["groups", evil, "people"], { error: "You left this group." }, undefined, "", T0),
      await flashTo(["groups", evil], { error: "x" }, { tab: "activity" }, "", T0),
      await flashTo("/groups/" + evil + "/people", { error: "x" }, undefined, "", T0),
      await flashTo(["groups", "..", "signin"], { error: "x" }, undefined, "", T0),
      await flashTo(["groups", "%2e%2e", "signin"], { error: "x" }, undefined, "", T0),
      await flashTo(["groups", "a/b"], { error: "x" }, undefined, "", T0),
    ]) {
      // refused (plain "/"), or kept inside one /groups/… piece (an encoded slash or percent sign): never the /signin page
      expect(url === "/" || url.startsWith("/groups/")).toBe(true);
      expect(new URL(url, "http://x").pathname).not.toBe("/signin");
      expect(await readNotes(paramsOf(url), "/signin", T0)).toEqual({});
      if (url === "/") expect(url).not.toContain("es=");
    }
    // nothing the attacker typed is read back as a message: the text in "evil" is never signed
    const sp = paramsOf(await flashTo(["groups", "g1"], { error: "real" }, { note: evil }, "", T0));
    expect(sp.error).toBe("real");
    expect(await readNotes({ ...sp, error: "Pay ₹500 to x@ybl" }, "/groups/g1", T0)).toEqual({});
    // valid ids still work, including ones that need encoding
    expect(await readNotes(paramsOf(await flashTo(["groups", "cm1abcDEF_-9", "people"], { error: "ok" }, undefined, "", T0)), "/groups/cm1abcDEF_-9/people", T0)).toEqual({ error: "ok" });
    expect(await readNotes(paramsOf(await flashTo(["c", "AbC123"], { error: "ok" }, undefined, "", T0)), "/c/AbC123", T0)).toEqual({ error: "ok" });
  });

  it("isPlainPath refuses anything that is not one plain page", () => {
    for (const ok of ["/", "/signin", "/groups/g1/people", "/c/AbC123", "/groups/a%20b"]) expect(isPlainPath(ok), ok).toBe(true);
    for (const bad of ["signin", "//evil.com", "/a/../b", "/a/..", "/a?x=1", "/a#b", "/a/%2e%2e/b", "/a/%2E/b", "/a%2fb", "/a%5cb", "/a b", "/a\\b", "/a//b", "/a/./b", "/%zz"]) expect(isPlainPath(bad), bad).toBe(false);
  });

  it("the signed text is unambiguous: one message can't pass for two", async () => {
    const one = paramsOf(await flashTo("/groups/g1", { error: "a|skipped=b" }, undefined, "", T0));
    expect(await readNotes({ error: "a", skipped: "b", et: one.et, es: one.es }, "/groups/g1", T0)).toEqual({});
    const two = paramsOf(await flashTo("/groups/g1", { error: "a", skipped: "b" }, undefined, "", T0));
    expect(await readNotes({ error: "a|skipped=b", et: two.et, es: two.es }, "/groups/g1", T0)).toEqual({});
    expect(await readNotes({ skipped: "a", et: one.et, es: one.es }, "/groups/g1", T0)).toEqual({});
  });

  it("carrying a message to another page keeps its original minute: it does not get more time", async () => {
    const signed = await readSignedNotes(paramsOf(await flashTo("/groups/g1/settle", { error: "Nope" }, undefined, "", T0)), "/groups/g1/settle", T0 + 10 * MIN);
    expect(signed).not.toBeNull();
    const moved = paramsOf(await flashToAt(["people", "p1"], signed!.notes, signed!.et, { did: "e1" }));
    expect(await readNotes(moved, "/people/p1", T0 + 14 * MIN)).toEqual({ error: "Nope" });
    expect(await readNotes(moved, "/people/p1", T0 + 16 * MIN)).toEqual({});
    expect(await readNotes(moved, "/groups/g1/settle", T0 + 1 * MIN)).toEqual({});
  });

  it("an invited list longer than 8000 characters is not shown (a cut-off list can't be read)", async () => {
    const big = "x".repeat(8001);
    expect((await readNotes(paramsOf(await flashTo("/groups/g1/invite", { invited: big, error: "e" }, undefined, "", T0)), "/groups/g1/invite", T0))).toEqual({ error: "e" });
    const ok = "y".repeat(8000);
    expect((await readNotes(paramsOf(await flashTo("/groups/g1/invite", { invited: ok }, undefined, "", T0)), "/groups/g1/invite", T0)).invited).toBe(ok);
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

  it("every redirect that carries a message goes through flashTo (fixed short codes excepted)", () => {
    const FIXED = /error=(busy|name|claimed|removed|private|none|limit|markup|admin|currency|missing|left)\b/;
    const KEY = /\b(error|skipped|invited|payError|inviteError)\b\s*[=:,}]/;
    for (const f of [...files, ...walk("src/lib")]) {
      const src = readFileSync(f, "utf8");
      src.split("\n").forEach((line, i) => {
        if (!/(^|[^\w.])redirect\(/.test(line) || /flashTo|flashBack/.test(line) || !KEY.test(line)) return;
        expect(FIXED.test(line), `${f}:${i + 1} sends a message without flashTo: ${line.trim()}`).toBe(true);
      });
    }
  });

  it("the places that build a link with a message use flashTo too", () => {
    for (const f of [
      "src/app/postcard-actions.ts",
      "src/app/safety-actions.ts",
      "src/app/direct-actions.ts",
      "src/app/pay-link-actions.ts",
      "src/app/api/auth/google/start/route.ts",
      "src/app/api/auth/google/callback/route.ts",
    ]) expect(readFileSync(f, "utf8"), f).toContain("flashTo(");
  });

  it("no link is built by hand with a message in it, and flashUrl is gone", () => {
    for (const f of [...files, ...walk("src/lib")]) {
      const src = readFileSync(f, "utf8");
      expect(src.includes("flashUrl"), `${f} still uses flashUrl`).toBe(false);
      expect(/flashTo\(\s*`[^`]*[?#]/.test(src), `${f} builds a path with ? or # inside`).toBe(false);
    }
  });

  it("closing a message strips the signature as well", () => {
    expect(readFileSync("src/components/ui.tsx", "utf8")).toContain('params={["error", "et", "es"]}');
  });
});

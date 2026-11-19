import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flashTo as flashToFor, flashToAt as flashToAtFor, isPlainPath, readNotes as readNotesFor, readSignedNotes as readSignedFor } from "@/lib/flash";
import { shownEmail } from "@/lib/email-clean";

// Messages in a page address are shown only if Loopin signed them for that page in the last 15 minutes (CB-2, OP-2, GP-11, SA-10, AS-12).

const T0 = Date.parse("2026-11-16T10:00:00Z");
// The browser's own value (the lp_v cookie). Passed in here; in the app it comes from the cookie.
const VIEWER = "viewerAAAAAAAAAAAAAAAAAA";
const OTHER_VIEWER = "viewerBBBBBBBBBBBBBBBBBB";
const flashTo = (path: Parameters<typeof flashToFor>[0], notes: Parameters<typeof flashToFor>[1], extra?: Parameters<typeof flashToFor>[2], hash = "", now = T0) => flashToFor(path, notes, extra, hash, now, VIEWER);
const flashToAt = (path: Parameters<typeof flashToAtFor>[0], notes: Parameters<typeof flashToAtFor>[1], et: number, extra?: Parameters<typeof flashToAtFor>[3]) => flashToAtFor(path, notes, et, extra, "", VIEWER);
const readNotes = (sp: Parameters<typeof readNotesFor>[0], path: string, now = T0, viewer = VIEWER) => readNotesFor(sp, path, now, viewer);
const readSignedNotes = (sp: Parameters<typeof readSignedFor>[0], path: string, now = T0, viewer = VIEWER) => readSignedFor(sp, path, now, viewer);
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

  it("a signed link works only in the browser it was made for (the lp_v cookie)", async () => {
    const sp = paramsOf(await flashTo("/", { error: "Pay ₹500 to x@ybl instead" }));
    // the same browser: shown
    expect(await readNotes(sp, "/")).toEqual({ error: "Pay ₹500 to x@ybl instead" });
    // another browser (a different cookie value): nothing
    expect(await readNotes(sp, "/", T0, OTHER_VIEWER)).toEqual({});
    // no cookie at all, or a cookie that isn't a proper value: nothing
    expect(await readNotes(sp, "/", T0, "")).toEqual({});
    expect(await readNotes(sp, "/", T0, "short")).toEqual({});
    // reading without saying whose browser it is (no cookie available here) shows nothing too
    expect(await readNotesFor(sp, "/", T0)).toEqual({});
    // and a message can't be made for "no browser"
    expect(await flashToFor("/", { error: "x" }, undefined, "", T0, "")).toBe("/");
  });

  it("the same message signed in two browsers has two different signatures", async () => {
    const a = paramsOf(await flashToFor("/c/AB", { error: "Nope" }, undefined, "", T0, VIEWER));
    const b = paramsOf(await flashToFor("/c/AB", { error: "Nope" }, undefined, "", T0, OTHER_VIEWER));
    expect(a.es).not.toBe(b.es);
    expect(await readNotesFor(b, "/c/AB", T0, OTHER_VIEWER)).toEqual({ error: "Nope" });
  });

  it("an address from a link is shown only if it is a real-looking email in plain ASCII", () => {
    expect(shownEmail("Asha@Example.com")).toBe("asha@example.com");
    for (const bad of ["Pay 500 to x", "a@b@c.com", "a b@c.com", "x@", "", undefined, "a".repeat(250) + "@b.com", "asha\u2800@example.com", "\u3164@example.com", "as\u200bha@example.com", "аsha@example.com"]) expect(shownEmail(bad), String(bad)).toBe("");
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
    const FIXED = /error=(busy|name|claimed|removed|private|none|limit|markup|admin|currency|missing|left|full)\b/;
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
    // postcard-actions.ts builds no message link any more: a refused card returns its error to the composer (SA-8), checked below.
    expect(readFileSync("src/app/postcard-actions.ts", "utf8")).not.toMatch(/[?&](error|notice)=/);
    for (const f of [
      "src/app/safety-actions.ts",
      "src/app/direct-actions.ts",
      "src/app/pay-link-actions.ts",
      "src/app/api/auth/google/start/route.ts",
      "src/app/api/auth/google/callback/route.ts",
    ]) expect(readFileSync(f, "utf8"), f).toContain("flashTo(");
  });

  // Any value typed into an address that a page prints as text (not only the message keys) must be checked first. Pages that read
  // addresses and print one unchecked fail here; a field that IS checked is listed with the reason.
  const CHECKED_FIELDS: Record<string, string[]> = {
    "src/app/signin/verify/page.tsx": ["code"], // digits only, cut to 6
    // Deliberate search echoes: the person's own search words in quotes, cut short. Plain text, never a link or a name from elsewhere.
    "src/app/search/page.tsx": ["q"],
    "src/app/passport/friends/page.tsx": ["q"],
  };
  it("no page prints a raw value from the address as text", () => {
    for (const f of files.filter((x) => x.endsWith("page.tsx"))) {
      const src = readFileSync(f, "utf8");
      if (!src.includes("await searchParams")) continue;
      const spName = /const (\w+) = await searchParams/.exec(src)?.[1];
      const names = new Set<string>();
      for (const part of (/const \{([^}]*)\} = await searchParams/.exec(src)?.[1] ?? "").split(",")) {
        const n = part.trim().split(":").pop()!.split("=")[0].trim();
        if (n) names.add(n);
      }
      // one step of derived names: const y = sp.field.slice(...) / const y = typed ?? ""
      const raw = (e: string) => (spName ? new RegExp(`\\b${spName}\\.\\w+`).test(e) : false) || [...names].some((n) => new RegExp(`(?<![\\w.])${n}\\b`).test(e));
      // a value looked up from the database (await ...) is the stored text, not the address text
      const SAFE = /shownEmail|readNotes|safePath|===|!==|hasOwnProperty|Number\(|Boolean\(|\.test\(|\.replace\(|\bawait\b/;
      for (const line of src.split("\n")) {
        const m = /^\s*const (\w+) = (.*);$/.exec(line);
        if (m && raw(m[2]) && !SAFE.test(m[2]) && !line.includes("searchParams")) names.add(m[1]);
      }
      const allowed = CHECKED_FIELDS[f.replace(/\\/g, "/")] ?? [];
      for (const line of src.split("\n")) {
        // a JSX text child that is the value (optionally cut or defaulted), alone or inside surrounding text or quotes
        const m = /(?:>|^\s*|[\w\s“”"'‘’:,.!?-])\{\s*([\w.]+)(?:\.slice\([^)]*\))?(?:\s*\?\?\s*"[^"]*")?\s*\}(?=\s*(?:<|$)|[“”"'‘’:,.!?-]|\s+[\w“”"'‘’])/.exec(line);
        if (!m || /^\s*(const|let|var)\b/.test(line)) continue;
        const expr = m[1];
        const field = expr.replace(new RegExp(`^${spName}\\.`), "");
        const isRaw = (spName && expr.startsWith(`${spName}.`)) || names.has(expr);
        if (isRaw) expect(allowed.includes(field), `${f} prints "${expr}" straight from the address: ${line.trim()}`).toBe(true);
      }
    }
  });

  it("the sign-in pages show an address from the link only through shownEmail", () => {
    for (const f of ["src/app/signin/page.tsx", "src/app/signin/verify/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("shownEmail(");
    }
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

describe("the browser value (lp_v) is set before any page draws", () => {
  const mw = readFileSync("src/proxy.ts", "utf8");
  it("the middleware sets lp_v when it is missing, with the same attributes as the actions", () => {
    expect(mw).toContain("VIEWER_COOKIE");
    expect(mw).toContain("res.cookies.set(VIEWER_COOKIE, newViewer, viewerCookieOptions())");
    expect(mw).toContain("!cleanViewer(req.cookies.get(VIEWER_COOKIE)?.value)"); // only when missing (or not a proper value)
    expect(mw).toContain('requestHeaders.set("cookie"'); // the first page of a new browser already sees it
    const opts = readFileSync("src/lib/viewer-cookie.ts", "utf8");
    expect(opts).toContain("httpOnly: true");
    expect(opts).toContain('sameSite: "lax"');
    expect(opts).toContain('path: "/"');
    expect(opts).toContain("60 * 60 * 24 * 730");
    expect(readFileSync("src/lib/flash.ts", "utf8")).toContain("viewerCookieOptions()"); // the action-side backup uses the same options
  });
  it("it is skipped for files, non-page requests and the existing static and API exclusions", () => {
    expect(mw).toContain('req.method === "GET" || req.method === "HEAD"');
    expect(mw).toContain("!/\\.[A-Za-z0-9]{1,8}$/.test(req.nextUrl.pathname)");
    expect(mw).toContain('matcher: ["/((?!_next/static|_next/image|api/).*)"]'); // unchanged
  });
  it("its existing rules are untouched", () => {
    expect(mw).toContain("shouldMove(host, req.method, req.nextUrl.pathname)");
    expect(mw).toContain('requestHeaders.set("x-nonce", nonce)');
    expect(mw).toContain("res.cookies.set(SESSION_COOKIE");
  });
  it("on the live site the cookie is __Host-lp_v, so a subdomain or plain-http hop can't plant it", () => {
    const src = readFileSync("src/lib/viewer-cookie.ts", "utf8");
    expect(src).toContain('export const VIEWER_COOKIE = SECURE ? "__Host-lp_v" : "lp_v";');
    expect(src).toContain('const SECURE = process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1";');
    expect(src).toMatch(/secure: SECURE, path: "\/"/);
    expect(src).not.toMatch(/domain\s*:/i); // __Host- cookies must not carry a Domain
  });
  it("lp_v is made of 128 random bits and only a proper value is accepted", async () => {
    const { newViewerId, cleanViewer } = await import("@/lib/viewer-cookie");
    const a = newViewerId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(cleanViewer(a)).toBe(a);
    expect(newViewerId()).not.toBe(a);
    expect(cleanViewer("short")).toBe("");
  });
});

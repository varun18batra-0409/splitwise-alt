import { afterEach, describe, expect, it, vi } from "vitest";

// The practice site sits behind Vercel's access lock: the server's own request for a font or the world map is answered with a
// redirect to a login page (302), or, if followed, the login page itself (200 text/html). Before this fix the share pictures
// (All square, passport) took that page as a font and failed with 500. Now only real font and map files are used.
vi.mock("@/generated/og-fonts.json", () => ({ default: { "sans-500": "/og-fonts/sans-500.woff", "sans-700": "/og-fonts/sans-700.woff" } }));
vi.mock("@/generated/map.json", () => ({ default: { ok: true, count: 1 } }));

const { loadOgFonts, worldMapImage } = await import("@/lib/og-assets");

const answer = (status: number, type: string, body = "x") => new Response(status === 302 ? null : body, { status, headers: { "content-type": type, ...(status === 302 ? { location: "https://vercel.com/login" } : {}) } });

afterEach(() => vi.unstubAllGlobals());

describe("share pictures behind a sign-in wall", () => {
  it("a login page (200 text/html) or a redirect (302) is not used as a font: no fonts, so the picture maker uses its own", async () => {
    for (const a of [answer(200, "text/html; charset=utf-8", "<html>Log in to Vercel</html>"), answer(302, "text/plain")]) {
      const seen: RequestInit[] = [];
      vi.stubGlobal("fetch", vi.fn(async (_u: URL, init: RequestInit) => (seen.push(init), a.clone())));
      expect(await loadOgFonts("https://practice.example")).toEqual([]);
      expect(seen.every((i) => i.redirect === "manual")).toBe(true);
    }
  });

  it("real font files are used: 2 fonts asked for, 2 back, named Sans at weights 500 and 700", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, "font/woff", "wOFF")));
    const got = await loadOgFonts("https://loopin.example");
    expect(got.map((f) => [f.name, f.weight]).sort()).toEqual([["Sans", 500], ["Sans", 700]]);
  });

  it("the world map: a login page or redirect gives no map (null), a real SVG is painted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, "text/html", "<html>login</html>")));
    expect(await worldMapImage("https://practice.example", ["TH"], [])).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => answer(302, "text/plain")));
    expect(await worldMapImage("https://practice.example", ["TH"], [])).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => answer(200, "image/svg+xml", '<svg><g id="TH"></g></svg>')));
    const src = await worldMapImage("https://loopin.example", ["TH"], []);
    expect(Buffer.from(src!.split(",")[1], "base64").toString()).toBe('<svg><style>#TH{fill:#26231d}</style><g id="TH"></g></svg>');
  });
});

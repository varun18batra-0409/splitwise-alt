import { afterEach, describe, expect, it, vi } from "vitest";

// The practice site sits behind Vercel's access lock: the server's own request for a font or the world map is answered with a
// redirect to a login page (302), or, if followed, the login page itself (200 text/html). Before this fix the share pictures
// (All square, passport) took that page as a font and failed with 500. Now only real font and map files are used.
vi.mock("@/generated/og-fonts.json", () => ({ default: { "sans-500": "/og-fonts/sans-500.woff", "sans-700": "/og-fonts/sans-700.woff" } }));
vi.mock("@/generated/map.json", () => ({ default: { ok: true, count: 1 } }));
// The files in public/ are read first; by default here they are "not on disk", so the fetch path is what is tested.
const disk = vi.hoisted(() => ({ files: {} as Record<string, string>, reads: [] as string[] }));
vi.mock("node:fs/promises", () => ({
  readFile: async (p: string) => {
    disk.reads.push(String(p));
    const hit = Object.entries(disk.files).find(([k]) => String(p).endsWith(k));
    if (!hit) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return Buffer.from(hit[1]);
  },
}));

const { loadOgFonts, worldMapImage } = await import("@/lib/og-assets");

const answer = (status: number, type: string, body = "x") => new Response(status === 302 ? null : body, { status, headers: { "content-type": type, ...(status === 302 ? { location: "https://vercel.com/login" } : {}) } });

afterEach(() => {
  vi.unstubAllGlobals();
  disk.files = {};
  disk.reads = [];
});

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

  it("files on disk come first: the fonts and the map are read from public/ and nothing is fetched (works behind any sign-in wall)", async () => {
    disk.files = { "public/og-fonts/sans-500.woff": "wOFF500", "public/og-fonts/sans-700.woff": "wOFF700", "public/world.svg": '<svg><g id="TH"></g></svg>' };
    const fetchSpy = vi.fn(async () => answer(302, "text/plain"));
    vi.stubGlobal("fetch", fetchSpy);
    const got = await loadOgFonts("https://practice.example");
    expect(got.map((f) => [f.name, f.weight, Buffer.from(f.data).toString()]).sort()).toEqual([["Sans", 500, "wOFF500"], ["Sans", 700, "wOFF700"]]);
    const src = await worldMapImage("https://practice.example", ["TH"], []);
    expect(Buffer.from(src!.split(",")[1], "base64").toString()).toBe('<svg><style>#TH{fill:#26231d}</style><g id="TH"></g></svg>');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a path that tries to leave public/ is never read", async () => {
    vi.doMock("@/generated/og-fonts.json", () => ({ default: { "sans-500": "/../../etc/passwd" } }));
    vi.resetModules();
    const fresh = await import("@/lib/og-assets");
    vi.stubGlobal("fetch", vi.fn(async () => answer(302, "text/plain")));
    expect(await fresh.loadOgFonts("https://practice.example")).toEqual([]);
    expect(disk.reads.some((r) => r.includes("passwd"))).toBe(false);
    vi.doUnmock("@/generated/og-fonts.json");
  });
});

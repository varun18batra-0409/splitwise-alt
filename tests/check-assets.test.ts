import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// OB-16: the live deploy must stop (before any database change) when the map or the fonts did not download.
const fonts = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, `/og-fonts/f${i}.woff`]));
function run(map: unknown, og: unknown, vercelEnv?: string) {
  const dir = mkdtempSync(join(tmpdir(), "lp-assets-"));
  if (map !== undefined) writeFileSync(join(dir, "map.json"), JSON.stringify(map));
  if (og !== undefined) writeFileSync(join(dir, "og-fonts.json"), JSON.stringify(og));
  const env = { ...process.env, CHECK_ASSETS_DIR: dir } as Record<string, string | undefined>;
  delete env.VERCEL_ENV;
  if (vercelEnv) env.VERCEL_ENV = vercelEnv;
  const r = spawnSync("node", ["scripts/check-assets.mjs"], { cwd: process.cwd(), encoding: "utf8", env });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("check-assets", () => {
  it("production with a map that did not download: exit 1", () => {
    const r = run({ ok: false, count: 0 }, fonts(6), "production");
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("world map");
  });
  it("production with 5 of 6 fonts: exit 1", () => {
    const r = run({ ok: true, count: 200 }, fonts(5), "production");
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("only 5 of 6");
  });
  it("production with the files missing altogether: exit 1", () => {
    expect(run(undefined, undefined, "production").code).toBe(1);
  });
  it("production with a good map and 6 fonts: exit 0", () => {
    const r = run({ ok: true, count: 241 }, fonts(6), "production");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("241 countries");
  });
  it("not production: exit 0 with a warning, even with nothing downloaded", () => {
    for (const env of [undefined, "preview"]) {
      const r = run({ ok: false, count: 0 }, {}, env);
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("warning");
    }
  });
});

describe("the deploy order (OA-11, cheap version)", () => {
  it("downloads and checks assets, then builds, and only then changes the database", () => {
    const cmd: string = JSON.parse(readFileSync("package.json", "utf8")).scripts["vercel-build"];
    const at = (s: string) => cmd.indexOf(s);
    const order = ["fetch-photos", "fetch-map", "fetch-flags", "fetch-fonts", "check-assets", "next build", "turso-sync", "upgrade-data"];
    for (const s of order) expect(at(s), s).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < order.length; i++) expect(at(order[i - 1]), `${order[i - 1]} before ${order[i]}`).toBeLessThan(at(order[i]));
  });
});

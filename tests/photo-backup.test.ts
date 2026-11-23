import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { REQUIRED, missingSettings, pickSample, runPhotoBackup, shortName, toCopy, uniqueKeys } from "../scripts/photo-backup.mjs";

// R3: the weekly copy of the photo store, and its drill. Run here with a pretend store (no network, no keys).
type Deps = Parameters<typeof runPhotoBackup>[0];

function pretend(opts: { live: Record<string, number>; copy?: Record<string, number>; referenced: string[]; breakCopy?: string[]; failWrite?: string[]; existsOnWrite?: string[] }) {
  const copy = new Map(Object.entries(opts.copy ?? {}));
  const writes: string[] = [];
  const deps: Deps = {
    referencedKeys: async () => opts.referenced,
    listCopy: async () => new Map(copy),
    readLive: async (k: string) => (k in opts.live ? { bytes: Buffer.alloc(opts.live[k], 1), type: "image/webp" } : null),
    writeCopy: async (k: string, bytes: Buffer) => {
      if (opts.failWrite?.includes(k)) throw new Error("store busy");
      if (opts.existsOnWrite?.includes(k)) return "exists";
      writes.push(k);
      copy.set(k, bytes.length);
    },
    readCopy: async (k: string) => (opts.breakCopy?.includes(k) || !copy.has(k) ? null : { size: copy.get(k)! }),
  };
  return { deps, writes, copy };
}

describe("photo backup: does nothing until it is set up", () => {
  it("lists exactly the settings that are missing (empty and blank count as missing)", () => {
    expect(REQUIRED).toEqual(["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "LIVE_BLOB_READ_WRITE_TOKEN", "BACKUP_BLOB_READ_WRITE_TOKEN"]);
    expect(missingSettings({})).toEqual(REQUIRED);
    expect(missingSettings({ TURSO_DATABASE_URL: "libsql://x", TURSO_AUTH_TOKEN: "t", LIVE_BLOB_READ_WRITE_TOKEN: "  ", BACKUP_BLOB_READ_WRITE_TOKEN: "" })).toEqual(["LIVE_BLOB_READ_WRITE_TOKEN", "BACKUP_BLOB_READ_WRITE_TOKEN"]);
    expect(missingSettings(Object.fromEntries(REQUIRED.map((k) => [k, "x"])))).toEqual([]);
  });
  it("run with no settings: says what is missing (names only), touches nothing, exits 0", () => {
    const env = { PATH: process.env.PATH ?? "" }; // nothing else: no database, no tokens
    const out = execFileSync("node", ["scripts/photo-backup.mjs"], { env }).toString();
    expect(out).toContain("Photo backup is not set up yet, so nothing was done.");
    for (const k of REQUIRED) expect(out).toContain(k);
  });
});

describe("photo backup: the copy", () => {
  it("one name per file, empty ones dropped, and what is already copied is skipped", () => {
    expect(uniqueKeys([["moment/b", "", "group/a"], ["moment/b", null as unknown as string, "receipt/c"]])).toEqual(["group/a", "moment/b", "receipt/c"]);
    expect(toCopy(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
  });

  it("copies only what is new, and the sample opens: 5 referenced, 2 already there -> 3 copied, 5 of 5 sampled open", async () => {
    const keys = ["group/g1", "postcard/p1", "receipt/r1", "moment/m1", "moment/m1-thumb"];
    const s = pretend({ live: Object.fromEntries(keys.map((k, i) => [k, 10 + i])), copy: { "group/g1": 10, "moment/m1": 13 }, referenced: keys });
    const r = await runPhotoBackup(s.deps, { rand: () => 0 });
    expect(r).toMatchObject({ referenced: 5, alreadyThere: 2, copied: 3, missingInLive: [], failed: [], sampleChecked: 5, sampleFailed: [], ok: true });
    expect(s.writes.sort()).toEqual(["moment/m1-thumb", "postcard/p1", "receipt/r1"]);
    // a second run copies nothing
    const again = await runPhotoBackup(s.deps, { rand: () => 0 });
    expect(again).toMatchObject({ alreadyThere: 5, copied: 0, ok: true });
    expect(s.writes).toHaveLength(3);
  });

  it("a copy listed at 0 bytes is copied again, and 'already exists' is counted apart from 'copied'", async () => {
    const s = pretend({ live: { "group/a": 9, "group/b": 8, "group/c": 7 }, copy: { "group/a": 0, "group/b": 8 }, referenced: ["group/a", "group/b", "group/c"], existsOnWrite: ["group/c"] });
    const r = await runPhotoBackup(s.deps);
    // Hand count: b is whole (skipped); a is empty (recopied: 1 copied, 1 empty recopied); c finds a file already there (not copied).
    expect([r.alreadyThere, r.copied, r.recopiedEmpty, r.alreadyExisted]).toEqual([1, 1, 1, 1]);
    expect(s.writes).toEqual(["group/a"]);
    expect(s.copy.get("group/a")).toBe(9);
  });

  it("a photo the database names but the live store lacks turns the run red, and is not sampled", async () => {
    const s = pretend({ live: { "group/g1": 5 }, referenced: ["group/g1", "receipt/lost"] });
    const r = await runPhotoBackup(s.deps);
    expect(r.missingInLive).toEqual(["receipt/lost"]);
    expect(r.copied).toBe(1);
    expect(r.sampleChecked).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("a copy that fails to write is reported, the others carry on", async () => {
    const s = pretend({ live: { "group/a": 1, "group/b": 2, "group/c": 3 }, referenced: ["group/a", "group/b", "group/c"], failWrite: ["group/b"] });
    const r = await runPhotoBackup(s.deps);
    expect([r.copied, r.failed, r.ok]).toEqual([2, ["group/b"], false]);
  });

  it("the drill catches a copy that does not open (and an empty one)", async () => {
    const s = pretend({ live: { "group/a": 4, "group/b": 4 }, referenced: ["group/a", "group/b"], breakCopy: ["group/b"] });
    const r = await runPhotoBackup(s.deps, { rand: () => 0 });
    expect(r.sampleFailed).toEqual(["group/b"]);
    expect(r.ok).toBe(false);
    const empty = pretend({ live: { "group/z": 0 }, referenced: ["group/z"] });
    expect((await runPhotoBackup(empty.deps)).sampleFailed).toEqual(["group/z"]); // a 0-byte file is not a photo
  });

  it("the sample is at most 20, without repeats, and never invents a name", () => {
    const keys = Array.from({ length: 50 }, (_, i) => `moment/${i}`);
    const pick = pickSample(keys);
    expect(pick).toHaveLength(20);
    expect(new Set(pick).size).toBe(20);
    expect(pick.every((k) => keys.includes(k))).toBe(true);
    expect(pickSample(["a", "b"])).toHaveLength(2);
    expect(pickSample([])).toEqual([]);
  });

  it("log lines show only a short piece of a name", () => {
    expect(shortName("moment/0a1b2c3d-4e5f-6789")).toBe("moment/0a1b2c…");
  });
});

describe("the photo backup workflow template and the other changed workflows (R13, RL2, RL7)", () => {
  const read = (f: string) => readFileSync(`.github/workflows/${f}`, "utf8");
  it("the live photo token is not in the public repo's workflows at all; the private template carries it", () => {
    expect(existsSync(".github/workflows/photo-backup.yml")).toBe(false);
    for (const f of readdirSync(".github/workflows")) expect(read(f), f).not.toContain("LIVE_BLOB_READ_WRITE_TOKEN");
    const t = readFileSync("ops/photo-backup/photo-backup.yml", "utf8");
    expect(t).toMatch(/cron: "37 21 \* \* 0"/);
    expect(t).toContain("steps.ready.outputs.ok == '1'");
    expect(t).toContain("::warning title=Photo backup not set up");
    for (const k of ["LIVE_DB_URL", "LIVE_DB_READONLY_TOKEN", "LIVE_BLOB_READ_WRITE_TOKEN", "BACKUP_BLOB_READ_WRITE_TOKEN"]) expect(t).toContain(`secrets.${k}`);
    expect(t).not.toMatch(/^ {4}env:/m);
    expect(t).toContain("persist-credentials: false");
  });
  it("the public backup and live-stats run in the live-read environment with the READ-ONLY key", () => {
    for (const f of ["backup.yml", "live-stats.yml"]) {
      const t = read(f);
      expect(t, f).toMatch(/^ {4}environment: live-read/m);
      expect(t, f).toContain("secrets.TURSO_READONLY_TOKEN");
      expect(t, f).not.toMatch(/secrets\.TURSO_AUTH_TOKEN/);
      expect(t, f).toContain("cache: npm");
      expect(t, f).toContain("@libsql/client@0.15.0");
    }
    expect(read("live-stats.yml")).not.toMatch(/^ {4}env:/m);
    expect(read("backup.yml")).toContain("secrets.BACKUP_PASSPHRASE"); // a repository secret, still read from inside the environment
  });
  it("a missing database key fails the backup (red), only a missing passphrase skips", () => {
    const t = read("backup.yml");
    const check = t.slice(t.indexOf("- name: Check the secrets are set"), t.indexOf("- uses: actions/checkout"));
    expect(check).toMatch(/-z "\$TURSO_DATABASE_URL" \] \|\| \[ -z "\$TURSO_AUTH_TOKEN" \][\s\S]*?exit 1/);
    expect(check).toContain("::error title=Backup FAILED");
    expect(check.indexOf("exit 1")).toBeLessThan(check.indexOf("Backup skipped"));
  });
  it("the founder's setup steps exist and say the live token goes only in the private repo", () => {
    const t = readFileSync("ops/photo-backup/README.md", "utf8");
    for (const s of ["BACKUP_BLOB_READ_WRITE_TOKEN", "LIVE_BLOB_READ_WRITE_TOKEN", "restore drill", "ONLY in the private ops repo"]) expect(t).toContain(s);
  });
});

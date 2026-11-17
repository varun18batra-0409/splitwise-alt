import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canSeePassport, passportFriends } from "@/lib/passport-db";
import { postcardPeople } from "@/lib/postcards/people";
import { loadMyGroups } from "@/lib/group-data";

// Leaver scoping against a real (throwaway) database: the Goa trip. Meera joins 1 Jan, Asha joins 5 Jan and leaves 20 Jan, Ravi joins 1 Mar.
// Asha and Ravi were never in the group at the same time, so they are strangers to each other (passports and postcards), both ways.
// Needs the generated database client, so it runs where the other database tests run.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let counter = 0; // every trip gets its own people and invite code, so tests don't collide
const day = (s: string) => new Date(`${s}T10:00:00Z`);

async function account(name: string, n: number) {
  const a = await db.account.create({ data: { email: `ls-${name}-${n}-${stamp}@example.test`, name, passportChoiceAt: new Date(), passportShare: "groups" } });
  accountIds.push(a.id);
  return a;
}

async function goa() {
  const n = ++counter;
  const [meera, asha, ravi] = await Promise.all([account("Meera", n), account("Asha", n), account("Ravi", n)]);
  const g = await db.group.create({
    data: {
      name: `Goa ${n} ${stamp}`, inviteCode: `ls-${n}-${stamp}`, currency: "INR", type: "trip", cover: "own", coverAt: day("2026-03-02"),
      members: {
        create: [
          { name: "Meera", accountId: meera.id, createdAt: day("2026-01-01") },
          { name: "Asha", accountId: asha.id, createdAt: day("2026-01-05"), leftAt: day("2026-01-20") },
          { name: "Ravi", accountId: ravi.id, createdAt: day("2026-03-01") },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const row = (n: string) => g.members.find((m) => m.name === n)!;
  return { g, meera, asha, ravi, row };
}

afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("SB-1: passports and postcards only between people who were in a group at the same time", () => {
  it("canSeePassport(Asha, Ravi) and (Ravi, Asha) are strangers; Meera sees both and both see Meera", async () => {
    const s = await goa();
    expect(await canSeePassport(s.asha.id, s.ravi.id)).toMatchObject({ ok: false, reason: "stranger" });
    expect(await canSeePassport(s.ravi.id, s.asha.id)).toMatchObject({ ok: false, reason: "stranger" });
    expect((await canSeePassport(s.asha.id, s.meera.id)).ok).toBe(true);
    expect((await canSeePassport(s.ravi.id, s.meera.id)).ok).toBe(true);
    expect((await canSeePassport(s.meera.id, s.asha.id)).ok).toBe(true);
  });
  it("Friends' passports: Asha lists Meera only; Ravi lists Meera only", async () => {
    const s = await goa();
    expect((await passportFriends(s.asha.id)).map((f) => f.accountId)).toEqual([s.meera.id]);
    expect((await passportFriends(s.ravi.id)).map((f) => f.accountId)).toEqual([s.meera.id]);
  });
  it("the postcard picker for Asha excludes Ravi (and the other way round)", async () => {
    const s = await goa();
    const ids = (await postcardPeople(s.asha.id)).flatMap((g) => g.people.map((p) => p.id));
    expect(ids).toContain(s.meera.id);
    expect(ids).not.toContain(s.ravi.id);
    expect((await postcardPeople(s.ravi.id)).flatMap((g) => g.people.map((p) => p.id))).not.toContain(s.asha.id);
  });
});

describe("D-5: the cover a leaver is drawn", () => {
  it("Asha left before the group photo changed (2 Mar): her Home entry shows the default cover for a trip; Meera still sees the photo", async () => {
    const s = await goa();
    const [asLeaver] = await loadMyGroups({ [s.g.id]: s.row("Asha").id });
    expect(asLeaver.group.cover).toBe("");
    expect(asLeaver.group.coverAt).toBeNull();
    const [asMember] = await loadMyGroups({ [s.g.id]: s.row("Meera").id });
    expect(asMember.group.cover).toBe("own");
  });
});

describe("M2: leaving and being brought back leaves a gap", () => {
  it("Asha 5-20 Jan, brought back on 5 May by the app, and Ravi 1-30 Mar: not strangers by accident, they never overlapped", async () => {
    const s = await goa();
    // Ravi left on 30 Mar. Asha's row was reused: leftAt cleared on 5 May, with the lines the app writes for each move.
    await db.member.update({ where: { id: s.row("Ravi").id }, data: { leftAt: day("2026-03-30") } });
    await db.member.update({ where: { id: s.row("Asha").id }, data: { leftAt: null } });
    const line = (kind: string, memberId: string, at: Date) =>
      db.groupEvent.create({ data: { groupId: s.g.id, actorId: memberId, kind, text: kind, createdAt: at, undo: JSON.stringify({ type: "member_set", memberId, data: { leftAt: null } }) } });
    await line("member_left", s.row("Asha").id, day("2026-01-20"));
    await line("member_rejoined", s.row("Asha").id, day("2026-05-05"));
    expect(await canSeePassport(s.asha.id, s.ravi.id)).toMatchObject({ ok: false, reason: "stranger" });
    expect(await canSeePassport(s.ravi.id, s.asha.id)).toMatchObject({ ok: false, reason: "stranger" });
    expect((await passportFriends(s.asha.id)).map((f) => f.accountId)).toEqual([s.meera.id]);
    const ids = (await postcardPeople(s.asha.id)).flatMap((g) => g.people.map((p) => p.id));
    expect(ids).not.toContain(s.ravi.id);
  });
});

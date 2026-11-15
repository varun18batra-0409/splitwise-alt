import { describe, expect, it } from "vitest";
import { canAddMoment, canUseMomentOnPostcard, canDeleteMoment, canOpenMoments, canReactToMoment, canReportMoment, canSeeMoment, type MomentFacts, type MomentViewer } from "@/lib/moments-access";

// Every row of the access table in the plan, as a pure check: who may see a moment (and its photo), add, react, delete or remove, and report.
// A viewer is "the asking person's facts for one group". Nothing here touches the database.
const T = (s: string) => new Date(`2026-11-10T${s}Z`);
const viewer = (o: Partial<MomentViewer> = {}): MomentViewer => ({
  groupId: "g1", groupType: "trip", groupDeleted: false, memberId: "m-viewer", accountId: "a-viewer",
  leftAt: null, removedAt: null, pending: false, isAdmin: false, blocked: new Set<string>(), ...o,
});
// Someone else's moment, added at 10:00.
const theirs: MomentFacts = { groupId: "g1", authorId: "m-author", authorAccountId: "a-author", createdAt: T("10:00:00.000") };
const mine: MomentFacts = { groupId: "g1", authorId: "m-viewer", authorAccountId: "a-viewer", createdAt: T("10:00:00.000") };

describe("moments: who can see a moment (the photo address uses the same check)", () => {
  it("a current member, signed in, sees it", () => expect(canSeeMoment(viewer(), theirs)).toBe(true));
  it("a current member who is a guest (no email) sees it", () => expect(canSeeMoment(viewer({ accountId: null }), theirs)).toBe(true));
  it("the author sees their own", () => expect(canSeeMoment(viewer(), mine)).toBe(true));
  it("not in the group at all (no viewer): no", () => expect(canSeeMoment(null, theirs)).toBe(false));
  it("added by someone and never opened the group (pending): no", () => expect(canSeeMoment(viewer({ pending: true }), theirs)).toBe(false));
  it("removed by the admin: none, not even their own", () => {
    expect(canSeeMoment(viewer({ removedAt: T("09:00:00.000") }), theirs)).toBe(false);
    expect(canSeeMoment(viewer({ removedAt: T("11:00:00.000") }), mine)).toBe(false);
  });
  it("a group that is deleted: nobody", () => expect(canSeeMoment(viewer({ groupDeleted: true }), theirs)).toBe(false));
  it("a moment of another group is never seen, whatever the request says", () => expect(canSeeMoment(viewer({ groupId: "g2" }), theirs)).toBe(false));

  describe("someone who left on their own: only moments added at or before they left", () => {
    const left = T("10:00:00.500");
    it("1 ms before leftAt: visible", () => expect(canSeeMoment(viewer({ leftAt: left }), { ...theirs, createdAt: new Date(left.getTime() - 1) })).toBe(true));
    it("exactly at leftAt: visible", () => expect(canSeeMoment(viewer({ leftAt: left }), { ...theirs, createdAt: left })).toBe(true));
    it("1 ms after leftAt: hidden", () => expect(canSeeMoment(viewer({ leftAt: left }), { ...theirs, createdAt: new Date(left.getTime() + 1) })).toBe(false));
  });

  describe("blocks, either way", () => {
    it("the viewer blocked the author, or the author blocked the viewer: hidden", () => {
      expect(canSeeMoment(viewer({ blocked: new Set(["a-author"]) }), theirs)).toBe(false);
    });
    it("a block with somebody else changes nothing", () => expect(canSeeMoment(viewer({ blocked: new Set(["a-other"]) }), theirs)).toBe(true));
    it("a person's own moments are never hidden from them", () => expect(canSeeMoment(viewer({ blocked: new Set(["a-viewer"]) }), mine)).toBe(true));
  });
});

describe("moments: opening the list", () => {
  it("members and leavers can open it; strangers, pending, removed and deleted groups cannot", () => {
    expect(canOpenMoments(viewer())).toBe(true);
    expect(canOpenMoments(viewer({ leftAt: T("09:00:00.000") }))).toBe(true);
    expect(canOpenMoments(null)).toBe(false);
    expect(canOpenMoments(viewer({ pending: true }))).toBe(false);
    expect(canOpenMoments(viewer({ removedAt: T("09:00:00.000") }))).toBe(false);
    expect(canOpenMoments(viewer({ groupDeleted: true }))).toBe(false);
  });
});

describe("moments: who can add", () => {
  it("a current, signed-in member of a trip group can, also when the group is closed (closing isn't a block)", () => expect(canAddMoment(viewer())).toBe(true));
  it("a guest (no email) can't: they are asked to sign in", () => expect(canAddMoment(viewer({ accountId: null }))).toBe(false));
  it("someone who left, was removed, or is pending can't", () => {
    expect(canAddMoment(viewer({ leftAt: T("09:00:00.000") }))).toBe(false);
    expect(canAddMoment(viewer({ removedAt: T("09:00:00.000") }))).toBe(false);
    expect(canAddMoment(viewer({ pending: true }))).toBe(false);
  });
  it("not in the group, or a group that isn't a trip, or a deleted group: no", () => {
    expect(canAddMoment(null)).toBe(false);
    expect(canAddMoment(viewer({ groupType: "home" }))).toBe(false);
    expect(canAddMoment(viewer({ groupDeleted: true }))).toBe(false);
  });
});

describe("moments: who can react", () => {
  it("current members can, guests too", () => {
    expect(canReactToMoment(viewer(), theirs)).toBe(true);
    expect(canReactToMoment(viewer({ accountId: null }), theirs)).toBe(true);
  });
  it("leavers, removed, pending and strangers can't", () => {
    expect(canReactToMoment(viewer({ leftAt: T("10:30:00.000") }), theirs)).toBe(false);
    expect(canReactToMoment(viewer({ removedAt: T("10:30:00.000") }), theirs)).toBe(false);
    expect(canReactToMoment(viewer({ pending: true }), theirs)).toBe(false);
    expect(canReactToMoment(null, theirs)).toBe(false);
  });
  it("not on a moment of a blocked person", () => expect(canReactToMoment(viewer({ blocked: new Set(["a-author"]) }), theirs)).toBe(false));
});

describe("moments: delete (author) and remove (admin)", () => {
  it("the author deletes their own", () => expect(canDeleteMoment(viewer(), mine)).toBe(true));
  it("a plain member can't delete someone else's", () => expect(canDeleteMoment(viewer(), theirs)).toBe(false));
  it("the admin removes anyone's", () => expect(canDeleteMoment(viewer({ isAdmin: true }), theirs)).toBe(true));
  it("the admin can remove a moment from a person they blocked (they just can't see it)", () => expect(canDeleteMoment(viewer({ isAdmin: true, blocked: new Set(["a-author"]) }), theirs)).toBe(true));
  it("the author can still delete after leaving (it was added before they left)", () => {
    expect(canDeleteMoment(viewer({ leftAt: T("12:00:00.000") }), mine)).toBe(true);
  });
  it("a person who left can't remove other people's, even if they once looked after the group", () => {
    expect(canDeleteMoment(viewer({ leftAt: T("12:00:00.000"), isAdmin: true }), theirs)).toBe(false);
  });
  it("someone removed from the group deletes nothing, not even their own (the admin can)", () => {
    expect(canDeleteMoment(viewer({ removedAt: T("12:00:00.000") }), mine)).toBe(false);
    expect(canDeleteMoment(viewer({ isAdmin: true }), mine)).toBe(true);
  });
  it("pending, strangers and other groups: no", () => {
    expect(canDeleteMoment(viewer({ pending: true }), mine)).toBe(false);
    expect(canDeleteMoment(null, mine)).toBe(false);
    expect(canDeleteMoment(viewer({ groupId: "g2", isAdmin: true }), theirs)).toBe(false);
  });
  it("a guest author (no account) is matched by their name in the group", () => {
    expect(canDeleteMoment(viewer({ accountId: null }), { ...theirs, authorId: "m-viewer" })).toBe(true);
    expect(canDeleteMoment(viewer({ accountId: null }), theirs)).toBe(false);
  });
});

describe("moments: who can report", () => {
  it("a signed-in member, or someone who left (for a moment from before they left)", () => {
    expect(canReportMoment(viewer(), theirs)).toBe(true);
    expect(canReportMoment(viewer({ leftAt: T("12:00:00.000") }), theirs)).toBe(true);
  });
  it("not your own, not as a guest (sign in first), not a stranger, not one you can't see", () => {
    expect(canReportMoment(viewer(), mine)).toBe(false);
    expect(canReportMoment(viewer({ accountId: null }), theirs)).toBe(false);
    expect(canReportMoment(null, theirs)).toBe(false);
    expect(canReportMoment(viewer({ leftAt: T("09:00:00.000") }), theirs)).toBe(false);
    expect(canReportMoment(viewer({ removedAt: T("09:00:00.000") }), theirs)).toBe(false);
    expect(canReportMoment(viewer({ pending: true }), theirs)).toBe(false);
  });
});

describe("moments: using your own moment's photo on a postcard", () => {
  it("the author, a current signed-in member of the same group: yes", () => expect(canUseMomentOnPostcard(viewer(), mine)).toBe(true));
  it("someone else's moment: no", () => expect(canUseMomentOnPostcard(viewer(), theirs)).toBe(false));
  it("the author has left the group, was removed, or was never opened (pending): no", () => {
    expect(canUseMomentOnPostcard(viewer({ leftAt: T("09:00:00.000") }), mine)).toBe(false);
    expect(canUseMomentOnPostcard(viewer({ removedAt: T("09:00:00.000") }), mine)).toBe(false);
    expect(canUseMomentOnPostcard(viewer({ pending: true }), mine)).toBe(false);
  });
  it("a deleted group: no", () => expect(canUseMomentOnPostcard(viewer({ groupDeleted: true }), mine)).toBe(false));
  it("the moment belongs to a different group than the viewer's row: no", () => expect(canUseMomentOnPostcard(viewer({ groupId: "g2" }), mine)).toBe(false));
  it("a guest name (no account): no, even for a moment under their member id", () => {
    expect(canUseMomentOnPostcard(viewer({ accountId: null }), mine)).toBe(false);
    expect(canUseMomentOnPostcard(viewer({ accountId: null }), { ...mine, authorAccountId: "" })).toBe(false);
  });
  it("no viewer at all: no", () => expect(canUseMomentOnPostcard(null, mine)).toBe(false));
});

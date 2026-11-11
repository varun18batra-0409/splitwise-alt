import { describe, expect, it } from "vitest";
import { maskEmail, signedInPeople } from "@/lib/stats";

// The owner's "Who has signed in" list on the private Stats page.
describe("who has signed in", () => {
  it("hides most of the email", () => {
    expect(maskEmail("varun@gmail.com")).toBe("va•••@gmail.com");
    expect(maskEmail("ab@x.io")).toBe("a•••@x.io");
    expect(maskEmail("z@x.io")).toBe("z•••@x.io");
  });

  it("lists everyone newest first and counts only groups they are still in", () => {
    const d = (s: string) => new Date(s);
    const accounts = [
      { id: "a", email: "asha@mail.com", name: "Asha", createdAt: d("2026-10-01") },
      { id: "b", email: "ravi@mail.com", name: " ", createdAt: d("2026-11-05") },
      { id: "c", email: "meera@mail.com", name: "Meera", createdAt: d("2026-10-20") },
    ];
    const members = [
      { groupId: "g1", accountId: "a", leftAt: null, removedAt: null },
      { groupId: "g2", accountId: "a", leftAt: null, removedAt: null },
      { groupId: "g3", accountId: "a", leftAt: null, removedAt: null }, // g3 is in the bin
      { groupId: "g1", accountId: "c", leftAt: d("2026-11-01"), removedAt: null }, // left
      { groupId: "g2", accountId: "c", leftAt: d("2026-11-01"), removedAt: d("2026-11-01") }, // removed
      { groupId: "g1", accountId: null, leftAt: null, removedAt: null }, // a name only
    ];
    const list = signedInPeople(accounts, members, new Set(["g1", "g2"]));
    expect(list.map((p) => [p.id, p.name, p.email, p.groups])).toEqual([
      ["b", "", "ra•••@mail.com", 0],
      ["c", "Meera", "me•••@mail.com", 0],
      ["a", "Asha", "as•••@mail.com", 2],
    ]);
  });
});

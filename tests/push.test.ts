import { describe, expect, it } from "vitest";
import { pushPayload } from "@/lib/push";

describe("phone notification text", () => {
  it("names the group, who did it and what, and opens the group", () => {
    expect(pushPayload({ groupId: "g1", groupName: "Goa", actorName: "Asha", text: "added Dinner (₹2,400)", eventId: "e1" })).toEqual({
      title: "Goa",
      body: "Asha added Dinner (₹2,400)",
      url: "/groups/g1?tab=activity",
      tag: "e1",
    });
  });
  it("keeps long messages short", () => {
    const p = pushPayload({ groupId: "g", groupName: "G", actorName: "A", text: "x".repeat(300), eventId: "e" });
    expect(p.body.length).toBe(140);
    expect(p.body.endsWith("…")).toBe(true);
  });
});

describe("notification shows what kind of change it was", () => {
  it("adds a sign before the group name", () => {
    expect(pushPayload({ groupId: "g", groupName: "Euro trip", actorName: "Joey", text: "added Rancho to the group", eventId: "e", kind: "members_added" }).title).toBe("👋 Euro trip");
    expect(pushPayload({ groupId: "g", groupName: "Euro trip", actorName: "Joey", text: "deleted Pizza", eventId: "e", kind: "expense_deleted" }).title).toBe("🗑️ Euro trip");
  });
});

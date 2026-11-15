import { describe, expect, it } from "vitest";
import { lateMoveText, lateRemovalText, putBackOpen, PUT_BACK_MINUTES } from "@/lib/put-back";

// The 10-minute window for undoing someone's removal or move-out is counted from the change's saved time, and includes the 10th minute.
describe("putBackOpen", () => {
  const madeAt = new Date("2026-11-15T10:00:00.000Z");
  it("is 10 minutes", () => expect(PUT_BACK_MINUTES).toBe(10));
  it("open at 10:09:59.999 and exactly 10:10:00.000", () => {
    expect(putBackOpen(madeAt, new Date("2026-11-15T10:09:59.999Z"))).toBe(true);
    expect(putBackOpen(madeAt, new Date("2026-11-15T10:10:00.000Z"))).toBe(true);
  });
  it("closed from 10:10:00.001", () => expect(putBackOpen(madeAt, new Date("2026-11-15T10:10:00.001Z"))).toBe(false));
  it("a clock slightly behind the saved time (09:59:00) still counts as open", () => expect(putBackOpen(madeAt, new Date("2026-11-15T09:59:00.000Z"))).toBe(true));
  it("the messages name the person and the way back", () => {
    expect(lateRemovalText("Ada")).toBe("Undo only lasts 10 minutes. To bring Ada back, invite them from People.");
    expect(lateMoveText("Asha")).toBe("Undo only lasts 10 minutes. Asha can still undo it, or you can invite them back from People.");
  });
});

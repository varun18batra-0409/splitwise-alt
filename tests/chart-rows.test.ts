import { describe, expect, it } from "vitest";
import { spendingOnly } from "@/lib/chart-rows";

describe("chart rows", () => {
  it("leaves card-game results out of Who paid and Each person's share, and keeps expenses and money back", () => {
    const rows = [
      { id: "dinner", kind: "expense" },
      { id: "cards", kind: "pot" },
      { id: "refund", kind: "refund" },
    ];
    expect(spendingOnly(rows).map((r) => r.id)).toEqual(["dinner", "refund"]);
    expect(spendingOnly([{ kind: "pot" }])).toEqual([]);
    expect(spendingOnly([])).toEqual([]);
  });
});

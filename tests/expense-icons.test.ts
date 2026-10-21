import { describe, expect, it } from "vitest";
import { expenseIcon } from "@/lib/expense-icons";

// The picture next to an expense comes from what it says, within its category.
describe("expense icons", () => {
  it("transport by kind", () => {
    expect(expenseIcon("Airfare", "transport")).toBe("✈️");
    expect(expenseIcon("Flights to Bangkok", "transport")).toBe("✈️");
    expect(expenseIcon("IndiGo BLR-DEL", "transport")).toBe("✈️");
    expect(expenseIcon("Train to Agra", "transport")).toBe("🚆");
    expect(expenseIcon("Car rental", "transport")).toBe("🚗");
    expect(expenseIcon("Petrol", "transport")).toBe("⛽");
    expect(expenseIcon("Uber to airport", "transport")).toBe("🚕");
    expect(expenseIcon("Uber", "transport")).toBe("🚕");
  });
  it("food by meal", () => {
    expect(expenseIcon("Dinner at Jay Fai", "food")).toBe("🍽️");
    expect(expenseIcon("Lunch", "food")).toBe("🍽️");
    expect(expenseIcon("Coffee", "food")).toBe("☕");
    expect(expenseIcon("Beers at Khao San", "food")).toBe("🍻");
  });
  it("a word only counts when it fits the category", () => {
    expect(expenseIcon("Flight snacks", "food")).toBe("🍽️");
    expect(expenseIcon("Train tickets", "other")).toBe("🚆");
    expect(expenseIcon("Electricity", "bills")).toBe("⚡");
    expect(expenseIcon("Something", "accommodation")).toBe("🏨");
  });
  it("parts of words don't count", () => {
    expect(expenseIcon("Barbeque night", "food")).toBe("🍽️"); // not "bar"
    expect(expenseIcon("Trainers", "shopping")).toBe("🛍️");
  });
});

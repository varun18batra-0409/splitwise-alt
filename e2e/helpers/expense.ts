// Filling in "Add expense" the way a person does (src/components/AddExpenseForm.tsx).
import { expect, type Page } from "@playwright/test";
import { settled } from "./app";

export type Split =
  | { kind: "everyone" }
  | { kind: "only"; who: string[] }
  | { kind: "one"; who: string }
  | { kind: "amounts"; values: Record<string, string> }
  | { kind: "percent"; values: Record<string, string> }
  | { kind: "shares"; values: Record<string, string> };

export type ExpenseInput = {
  name: string;
  amount: string;
  payer?: string; // as shown on the chips: "You" or a name
  payers?: Record<string, string>; // more than one payer: { You: "1000", Bob: "500" }
  moneyBack?: boolean; // "Money back": `payer` is who got the money
  split?: Split;
};

const chip = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^(✓ )?${label}$`) });

export async function fillExpense(page: Page, x: ExpenseInput) {
  if (x.moneyBack) await page.getByRole("radio", { name: "Money back" }).click();
  if (x.payers) {
    await page.locator("#expense-name").fill(x.name);
    await page.getByLabel("Amount", { exact: true }).fill(x.amount);
    await page.getByRole("button", { name: "More than one" }).click();
    for (const [who, a] of Object.entries(x.payers)) await page.getByLabel(`${who} paid`).fill(a);
    await expect(page.getByText(/Adds up to/).first()).toBeVisible();
  } else {
    if (x.payer && x.payer !== "You") await chip(page, x.payer).first().click();
    await page.locator("#expense-name").fill(x.name);
    await page.getByLabel("Amount", { exact: true }).fill(x.amount);
  }
  // Always start from "Everyone equally" (the form remembers the last split).
  await page.getByRole("button", { name: "Everyone equally" }).click();
  const s = x.split ?? { kind: "everyone" };
  if (s.kind === "only") {
    await page.getByRole("button", { name: "Only some" }).click();
    for (const p of s.who) await chip(page, p).last().click();
  } else if (s.kind === "one") {
    await page.getByRole("button", { name: /Custom/ }).click();
    await page.getByRole("button", { name: "One person", exact: true }).click();
    await chip(page, s.who).last().click();
  } else if (s.kind !== "everyone") {
    await page.getByRole("button", { name: /Custom/ }).click();
    const tab = s.kind === "amounts" ? "Amounts" : s.kind === "percent" ? "%" : "Shares";
    await page.getByRole("button", { name: tab, exact: true }).click();
    const suffix = s.kind === "amounts" ? "amount" : s.kind === "percent" ? "percentage" : "shares";
    for (const [who, v] of Object.entries(s.values)) await page.getByLabel(`${who} ${suffix}`).fill(v);
  }
}

// Add one and save it; returns when back on the group's Activity.
export async function addExpense(page: Page, groupPath: string, x: ExpenseInput) {
  await page.goto(`${groupPath}/add`);
  await settled(page);
  await fillExpense(page, x);
  await page.getByRole("button", { name: x.moneyBack ? "Save money back" : "Save expense" }).click();
  const dup = page.getByRole("button", { name: "It’s a different one" });
  const done = await Promise.race([page.waitForURL(/tab=activity/).then(() => "saved"), dup.waitFor().then(() => "dup")]);
  if (done === "dup") {
    await dup.click();
    await page.waitForURL(/tab=activity/);
  }
}

// Try to save and expect it to be refused with a message (the form stays open).
export async function expectRefused(page: Page, groupPath: string, x: ExpenseInput, message: RegExp) {
  await page.goto(`${groupPath}/add`);
  await settled(page);
  await fillExpense(page, x);
  const before = page.url();
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.locator("p.bg-red-50").first()).toBeVisible();
  await expect(page.locator("p.bg-red-50").first()).toContainText(message);
  expect(page.url()).toBe(before);
}

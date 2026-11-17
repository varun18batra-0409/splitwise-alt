import { describe, expect, it } from "vitest";
import { amountEchoFor, amountSizeClass, editAmountInput, groupDigits, regroupAmount } from "../src/lib/amount-input";
import { parseAmount } from "../src/lib/money";

// Amount boxes show grouped digits as you type. The founder chose this on 16 Nov (Option A), reversing the earlier
// "plain digits only" rule. These tests are what makes that safe: the caret follows the digits, a comma can be deleted,
// and the text sent to the server still reads as exactly the same amount.

// Type one character at the caret, the way a keyboard would, and return what the box then shows.
function typeAt(prev: string, caret: number, ch: string, currency: string) {
  const raw = prev.slice(0, caret) + ch + prev.slice(caret);
  return editAmountInput(raw, caret + ch.length, currency, { prev });
}
function typeAll(text: string, currency: string) {
  let box = { value: "", caret: 0 };
  for (const ch of text) box = typeAt(box.value, box.caret, ch, currency);
  return box;
}
// Backspace / Delete with the caret at `caret` in `prev`.
function backspace(prev: string, caret: number, currency: string) {
  return editAmountInput(prev.slice(0, caret - 1) + prev.slice(caret), caret - 1, currency, { prev, inputType: "deleteContentBackward" });
}
function del(prev: string, caret: number, currency: string) {
  return editAmountInput(prev.slice(0, caret) + prev.slice(caret + 1), caret, currency, { prev, inputType: "deleteContentForward" });
}

describe("grouping", () => {
  it("rupees group the Indian way, other currencies in threes", () => {
    expect(groupDigits("1234567", "lakh")).toBe("12,34,567");
    expect(groupDigits("1234567", "thousands")).toBe("1,234,567");
    expect(groupDigits("123456", "lakh")).toBe("1,23,456");
    expect(groupDigits("999", "lakh")).toBe("999");
    expect(groupDigits("1000", "lakh")).toBe("1,000");
    expect(groupDigits("12345678901", "lakh")).toBe("12,34,56,78,901");
  });
});

describe("typing", () => {
  it("INR: typing 1 2 3 4 5 6 shows 1 / 12 / 123 / 1,234 / 12,345 / 1,23,456, caret always at the end", () => {
    const seen: string[] = [];
    let box = { value: "", caret: 0 };
    for (const ch of "123456") {
      box = typeAt(box.value, box.caret, ch, "INR");
      seen.push(box.value);
      expect(box.caret).toBe(box.value.length);
    }
    expect(seen).toEqual(["1", "12", "123", "1,234", "12,345", "1,23,456"]);
  });

  it("USD groups in threes: 123456 shows 123,456", () => {
    expect(typeAll("123456", "USD").value).toBe("123,456");
  });

  it("a digit typed in the middle keeps the caret right after it, even when the commas move", () => {
    // "1,23,456" with a 9 typed after the 1: 19,23,456, caret right after the 9
    expect(typeAt("1,23,456", 1, "9", "INR")).toEqual({ value: "19,23,456", caret: 2 });
    // "1,234" with a 5 typed after the 2: 12,534, caret right after the 5 (digits before it: 1, 2, 5)
    expect(typeAt("1,234", 3, "5", "INR")).toEqual({ value: "12,534", caret: 4 });
  });

  it("a decimal point is allowed once, and never more decimals than the currency has", () => {
    expect(typeAll("1234.5", "INR").value).toBe("1,234.5");
    expect(typeAll("12.345", "INR").value).toBe("12.34"); // rupees have 2 decimals: the third is not taken
    expect(typeAll("1.2.3", "INR").value).toBe("1.23"); // a second point is ignored
    expect(typeAll("12.", "INR").value).toBe("12."); // the point stays while the next digit is awaited
    expect(typeAll(".", "INR").value).toBe("0.");
    expect(typeAll("1.2345", "KWD").value).toBe("1.234"); // dinar: 3 decimals
  });

  it("JPY has no decimals: a point does nothing", () => {
    expect(typeAll("1234", "JPY").value).toBe("1,234");
    expect(typeAll("123.", "JPY").value).toBe("123");
    expect(typeAll("1234.5", "JPY").value).toBe("12,345"); // the point is dropped as it is typed; the 5 is then just another digit
  });

  it("leading zeros and stray characters are dropped, the caret staying after the same digit", () => {
    expect(typeAt("0", 1, "5", "INR")).toEqual({ value: "5", caret: 1 });
    expect(typeAt("12", 2, "a", "INR")).toEqual({ value: "12", caret: 2 });
    expect(typeAt("1,234", 3, ",", "INR")).toEqual({ value: "1,234", caret: 3 }); // a comma in the middle is just a separator
  });

  it("a comma typed after the last digit is a decimal comma (some phone keyboards)", () => {
    expect(typeAt("12", 2, ",", "INR")).toEqual({ value: "12.", caret: 3 });
    expect(typeAt("12", 2, ",", "JPY").value).toBe("12"); // no decimals in yen
  });
});

describe("deleting", () => {
  it("deleting a digit regroups and keeps the caret after the same digit", () => {
    expect(backspace("1,234", 5, "INR")).toEqual({ value: "123", caret: 3 });
    // 1,23,456 with the caret after the 5 (index 7): the 5 goes → digits 12346 → 12,346, caret after the 4 (4th digit)
    expect(backspace("1,23,456", 7, "INR")).toEqual({ value: "12,346", caret: 5 });
  });

  it("Backspace right after a comma removes the comma and the digit before it (so it never looks stuck)", () => {
    // 12,345 with the caret just after the comma (index 3): Backspace → the 2 goes too → 1,345, caret after the 1
    expect(backspace("12,345", 3, "INR")).toEqual({ value: "1,345", caret: 1 });
    // 1,23,456 with the caret after the first comma: the 1 goes → 23,456, caret at the start
    expect(backspace("1,23,456", 2, "INR")).toEqual({ value: "23,456", caret: 0 });
  });

  it("Delete just before a comma removes the comma and the digit after it", () => {
    // 12,345 with the caret just before the comma (index 2): Delete → the 3 goes → 1,245, caret after the 2
    expect(del("12,345", 2, "INR")).toEqual({ value: "1,245", caret: 3 });
  });

  it("clearing the box leaves it empty", () => {
    expect(backspace("1", 1, "INR")).toEqual({ value: "", caret: 0 });
  });
});

describe("pasting", () => {
  it("'17618.19' shows 17,618.19 (Indian grouping for rupees)", () => {
    expect(editAmountInput("17618.19", 8, "INR", { prev: "" })).toEqual({ value: "17,618.19", caret: 9 });
  });
  it("'1,23,456.5' pastes as 1,23,456.5 in rupees and 123,456.5 in baht", () => {
    expect(editAmountInput("1,23,456.5", 10, "INR", { prev: "" })).toEqual({ value: "1,23,456.5", caret: 10 });
    expect(editAmountInput("1,23,456.5", 10, "THB", { prev: "" })).toEqual({ value: "123,456.5", caret: 9 });
  });
  it("a pasted '12,50' is read as 12.50, the same way parseAmount reads it; '1,234' is a thousand-separator", () => {
    expect(editAmountInput("12,50", 5, "INR", { prev: "" }).value).toBe("12.50");
    expect(editAmountInput("1,234", 5, "INR", { prev: "" }).value).toBe("1,234");
    expect(editAmountInput("₹ 1,500", 7, "INR", { prev: "" }).value).toBe("1,500");
  });
  it("a pasted yen amount with a point keeps the whole part only", () => {
    expect(editAmountInput("1,234.50", 8, "JPY", { prev: "" }).value).toBe("1,234");
  });
});

describe("values set by the program", () => {
  it("regroupAmount groups a plain value and never cuts decimals (a currency change must not change an amount silently)", () => {
    expect(regroupAmount("17618.19", "INR")).toBe("17,618.19");
    expect(regroupAmount("123456", "INR")).toBe("1,23,456");
    expect(regroupAmount("123456", "THB")).toBe("123,456");
    expect(regroupAmount("1,23,456", "THB")).toBe("123,456"); // changing currency regroups
    expect(regroupAmount("12.5", "JPY")).toBe("12.5"); // left as it is: saving then says "no decimals" instead of changing it
    expect(regroupAmount("", "INR")).toBe("");
    expect(regroupAmount("12,50", "INR")).toBe("12.50");
  });
  it("the 'Read as' line says nothing for a value already shown in its grouped form", () => {
    expect(amountEchoFor("17,618.19", "INR")).toBeNull();
    expect(amountEchoFor("1500", "INR")).toBeNull();
    expect(amountEchoFor("12,50", "INR")).toBe("₹12.50");
  });
});

describe("what the server gets is the same amount", () => {
  it("parseAmount reads grouped text exactly as the plain digits", () => {
    // Hand-worked: 1,23,456.50 rupees = 12,345,650 paise; 17,618.19 = 1,761,819 paise; yen 12,345 = 12,345.
    expect(parseAmount("1,23,456.50", "INR")).toBe(12345650);
    expect(parseAmount("17,618.19", "INR")).toBe(1761819);
    expect(parseAmount("12,345", "JPY")).toBe(12345);
    expect(parseAmount("123,456.5", "THB")).toBe(12345650);
  });
  it("whatever is typed, the box's text parses to the same amount as the digits typed", () => {
    for (const [typed, cur] of [["1", "INR"], ["999", "INR"], ["1000", "INR"], ["12345.6", "INR"], ["9876543.21", "INR"], ["100000", "USD"], ["1234567", "JPY"], ["1.5", "KWD"], ["20000000", "INR"]] as const) {
      const shown = typeAll(typed, cur).value;
      expect(parseAmount(shown, cur), `${typed} ${cur} → ${shown}`).toBe(parseAmount(typed, cur));
    }
  });
  it("it holds when the commas are typed away and digits removed too", () => {
    let box = typeAll("1234567", "INR"); // 12,34,567
    box = backspace(box.value, box.value.length, "INR"); // 12,34,56
    expect(box.value).toBe("1,23,456"); // 123456 regrouped; ₹1,23,456 = 12,345,600 paise
    expect(parseAmount(box.value, "INR")).toBe(12345600);
  });
});

describe("big amounts get a smaller size, so they always fit on one line", () => {
  it("the payment amount steps down by length", () => {
    const sizes = ["1", "1,234", "12,345", "1,23,456", "12,34,567", "1,23,45,678", "1,23,45,678.50", "12,34,56,789.50"].map((t) => amountSizeClass(t, "pay"));
    expect(sizes[0]).toBe("text-[clamp(34px,10vw,40px)]");
    expect(sizes[2]).toBe("text-[clamp(34px,10vw,40px)]"); // 6 characters
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(4);
    expect(amountSizeClass("12,34,56,789.50", "pay")).toBe("text-[clamp(16px,4.8vw,20px)]");
  });
  it("the Add expense amount steps down too, and every size is smaller than the one before", () => {
    const px = (t: string) => Number(/clamp\((\d+)px/.exec(amountSizeClass(t, "hero"))![1]);
    const lens = ["1", "1,234,567", "1,23,456", "12,34,567", "12,34,567.5", "12,34,56,789", "12,34,56,789.50"];
    const small = lens.map(px);
    expect(small[0]).toBeGreaterThan(small[2]);
    for (let i = 3; i < small.length; i++) expect(small[i]).toBeLessThanOrEqual(small[i - 1]);
  });
});

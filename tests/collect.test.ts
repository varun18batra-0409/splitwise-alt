import { describe, expect, it } from "vitest";
import { checkNewCollection, cleanPayLink, cleanUpi, newCollectCode, personalReminder, phonesFor, progress, reminderText, upiLink, whatsappTo } from "@/lib/collect-rules";

const form = (over: Partial<Parameters<typeof checkNewCollection>[0]> = {}) => ({
  title: "Teacher's Day gift",
  note: "",
  currency: "INR",
  amount: "300",
  dueDate: "",
  upiId: "asha@okicici",
  payLink: "",
  names: "Ravi\nmeera, Ravi\n\n  Kabir  ",
  ...over,
});

describe("Collect: the form", () => {
  it("cleans the names (no blanks or repeats) and turns ₹300 into paise", () => {
    const r = checkNewCollection(form());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.names).toEqual(["Ravi", "meera", "Kabir"]);
    expect(r.data.amount).toBe(30000);
    expect(r.data.upiId).toBe("asha@okicici");
  });

  it("an empty amount means 'any amount'", () => {
    const r = checkNewCollection(form({ amount: "" }));
    expect(r.ok && r.data.amount).toBe(0);
  });

  it("needs a name, a real amount and a real date", () => {
    expect(checkNewCollection(form({ title: "  " })).ok).toBe(false);
    expect(checkNewCollection(form({ amount: "abc" })).ok).toBe(false);
    expect(checkNewCollection(form({ dueDate: "2026-02-31" })).ok).toBe(false);
    const ok = checkNewCollection(form({ dueDate: "2026-11-05" }), new Date("2026-10-22T10:00:00Z"));
    expect(ok.ok && ok.data.dueDate).toBe("2026-11-05");
  });

  it("an unknown currency falls back to INR", () => {
    const r = checkNewCollection(form({ currency: "XXX" }));
    expect(r.ok && r.data.currency).toBe("INR");
  });
});

describe("Collect: where the money goes", () => {
  it("accepts real UPI IDs and refuses anything else", () => {
    expect(cleanUpi(" Asha@OKICICI ")).toBe("asha@okicici");
    expect(cleanUpi("9876543210@ybl")).toBe("9876543210@ybl");
    expect(cleanUpi("")).toBe("");
    expect(cleanUpi("asha")).toBeNull();
    expect(cleanUpi("javascript:alert(1)@x")).toBeNull();
    expect(cleanUpi("a@b@c")).toBeNull();
  });

  it("only allows well-known payment links, always https", () => {
    expect(cleanPayLink("paypal.me/asha")).toBe("https://paypal.me/asha");
    expect(cleanPayLink("https://venmo.com/u/asha")).toBe("https://venmo.com/u/asha");
    expect(cleanPayLink("http://paypal.me/asha")).toBeNull();
    expect(cleanPayLink("https://paypal.me.evil.com/asha")).toBeNull();
    expect(cleanPayLink("https://evil.com/?paypal.me")).toBeNull();
    expect(cleanPayLink("javascript:alert(1)")).toBeNull();
    expect(cleanPayLink("")).toBe("");
  });

  it("the UPI link opens a payment app with the amount and a note filled in", () => {
    const link = upiLink({ upiId: "asha@okicici", organiser: "Asha K", title: "Gift & cake" }, 30050);
    expect(link).toBe("upi://pay?pa=asha%40okicici&pn=Asha%20K&am=300.50&cu=INR&tn=Gift%20%26%20cake");
    expect(upiLink({ upiId: "a@b", organiser: "A", title: "T" }, 0)).not.toContain("am=");
  });

  it("codes are long enough not to guess, and safe in a link", () => {
    const a = newCollectCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(newCollectCode()).not.toBe(a);
  });
});

describe("Collect: the progress bar and reminder", () => {
  const entries = [
    { name: "Ravi", amount: 30000, status: "confirmed" },
    { name: "Meera", amount: 30000, status: "paid" },
    { name: "Kabir", amount: 0, status: "due" },
    { name: "Zoya", amount: 0, status: "due" },
  ];

  it("counts paid (ticked or checked), still to pay, and the money so far", () => {
    expect(progress(entries, 30000)).toEqual({ paidCount: 2, dueCount: 2, people: 4, collected: 60000, target: 120000, checked: 1 });
    expect(progress([], 30000).target).toBe(0);
    expect(progress(entries, 0).target).toBe(0); // any amount: no target
  });

  it("the WhatsApp reminder names who's left and links back", () => {
    const t = reminderText({ title: "Gift", organiser: "Asha", amount: 30000, currency: "INR", dueDate: "2026-11-05" }, ["Kabir", "Zoya"], "https://loopinapps.com/c/abc");
    expect(t).toBe("Gift: ₹300 each by 5 Nov.\nStill to pay: Kabir, Zoya\nPay and tick your name here: https://loopinapps.com/c/abc");
  });
});

describe("Collect: people from contacts, and WhatsApp", () => {
  it("keeps each listed person's number; adds +91 to Indian mobiles; ignores junk", () => {
    const picked = JSON.stringify([
      { name: "Ravi Kumar", tel: "98765 43210" },
      { name: "meera", tel: "+44 7700 900123" },
      { name: "Kabir", tel: "09876543211" },
      { name: "Not listed", tel: "+919999999999" },
      { name: "Zoya", tel: "12" },
      "nonsense",
    ]);
    expect(phonesFor(["Ravi Kumar", "Meera", "Kabir", "Zoya"], picked, "INR")).toEqual({ "Ravi Kumar": "+919876543210", Meera: "+447700900123", Kabir: "+919876543211" });
    expect(phonesFor(["Ravi Kumar"], picked, "USD")).toEqual({ "Ravi Kumar": "9876543210" }); // no guessing a country outside rupees
    expect(phonesFor(["Ravi"], "not json", "INR")).toEqual({});
  });

  it("opens a chat with that person, the message typed in", () => {
    const c = { title: "Diwali fund", amount: 30000, currency: "INR", dueDate: "2026-11-05" };
    const text = personalReminder(c, "Ravi Kumar", "https://loopinapps.com/c/abc");
    expect(text).toBe("Hi Ravi! ₹300 for Diwali fund by 5 Nov. Pay and tick your name here: https://loopinapps.com/c/abc");
    expect(whatsappTo("+919876543210", "hi")).toBe("https://wa.me/919876543210?text=hi");
    expect(whatsappTo("9876543210", "hi")).toBe("https://wa.me/?text=hi"); // no country code: WhatsApp lets them pick
  });
});

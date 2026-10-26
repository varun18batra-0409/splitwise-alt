import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { cleanPayWays, payButtons, payLinkLabel } from "@/lib/pay-links";
import { nudgeMessage } from "@/lib/nudge";
import { confirmPayment, needsOkFor, rejectPayment, waitingForMe } from "@/lib/payment-ok";

describe("Pay buttons", () => {
  it("checks what people type on the You page", () => {
    expect(cleanPayWays({ upiId: " Asha@OKICICI ", payLink: "paypal.me/asha" })).toEqual({ ok: true, ways: { upiId: "asha@okicici", payLink: "https://paypal.me/asha" } });
    expect(cleanPayWays({ upiId: "", payLink: "" })).toEqual({ ok: true, ways: { upiId: "", payLink: "" } });
    expect(cleanPayWays({ upiId: "asha", payLink: "" }).ok).toBe(false);
    expect(cleanPayWays({ upiId: "", payLink: "https://evil.com/paypal.me" }).ok).toBe(false);
  });

  it("UPI opens the payment app with the amount, name and group filled in (rupees only)", () => {
    const b = payButtons({ upiId: "asha@okicici", payLink: "" }, { amount: 30050, currency: "INR", toName: "Asha K", note: "Goa trip" });
    expect(b).toEqual([{ kind: "upi", label: "UPI", href: "upi://pay?pa=asha%40okicici&pn=Asha%20K&am=300.50&cu=INR&tn=Goa%20trip" }]);
    expect(payButtons({ upiId: "asha@okicici", payLink: "" }, { amount: 3000, currency: "USD", toName: "Asha", note: "x" })).toEqual([]);
  });

  it("PayPal, Venmo, Cash App and Monzo get the amount; others just open", () => {
    const opts = (currency: string) => ({ amount: 2550, currency, toName: "Sam", note: "NYC trip" });
    expect(payButtons({ upiId: "", payLink: "https://paypal.me/sam" }, opts("USD"))[0]).toEqual({ kind: "paypal", label: "PayPal", href: "https://paypal.me/sam/25.50USD" });
    expect(payButtons({ upiId: "", payLink: "https://venmo.com/u/sam-k" }, opts("USD"))[0].href).toBe("https://venmo.com/sam-k?txn=pay&amount=25.50&note=NYC%20trip");
    expect(payButtons({ upiId: "", payLink: "https://cash.app/$samk" }, opts("USD"))[0].href).toBe("https://cash.app/$samk/25.50");
    expect(payButtons({ upiId: "", payLink: "https://monzo.me/sam" }, opts("GBP"))[0].href).toBe("https://monzo.me/sam/25.50");
    expect(payButtons({ upiId: "", payLink: "https://revolut.me/sam" }, opts("EUR"))[0]).toEqual({ kind: "revolut", label: "Revolut", href: "https://revolut.me/sam" });
    // Venmo is dollars only: in rupees the profile just opens.
    expect(payButtons({ upiId: "", payLink: "https://venmo.com/u/sam" }, opts("INR"))[0].href).toBe("https://venmo.com/u/sam");
    expect(payButtons({ upiId: "", payLink: "https://paypal.me/sam" }, { ...opts("JPY"), amount: 1500 })[0].href).toBe("https://paypal.me/sam/1500JPY");
    expect(payButtons(null, opts("USD"))).toEqual([]);
    expect(payLinkLabel("https://www.paypal.me/x")).toBe("PayPal");
  });

  it("the WhatsApp reminder carries how to pay and where to mark it paid", () => {
    expect(nudgeMessage("Ravi", "₹500", "Goa", { ways: { upiId: "asha@okicici", payLink: "https://paypal.me/asha" }, link: "https://www.loopinapps.com/groups/g/settle" })).toBe(
      "Hey Ravi! 👋 Quick one from Loopin: you owe me ₹500 for “Goa”. Settle whenever you can, thanks!\nUPI: asha@okicici\nPayPal: https://paypal.me/asha\nPaid? Mark it here: https://www.loopinapps.com/groups/g/settle",
    );
    expect(nudgeMessage("Ravi", "₹500", "Goa")).not.toContain("\n");
  });
});

describe("Payment tracking (real database)", () => {
  const groups: string[] = [];
  afterAll(async () => {
    await eraseGroups(groups);
  });

  it("only joined people are asked; the person paid confirms or says not received (off the balances)", async () => {
    const g = await db.group.create({
      data: { name: "Track", currency: "INR", inviteCode: `track-${Date.now()}-${Math.random()}`, members: { create: [{ name: "Asha", claimedAt: new Date() }, { name: "Ravi", claimedAt: new Date() }, { name: "Dev" }] } },
      include: { members: true },
    });
    groups.push(g.id);
    const id = (n: string) => g.members.find((m) => m.name === n)!;
    const [asha, ravi, dev] = [id("Asha"), id("Ravi"), id("Dev")];
    expect(needsOkFor(asha, ravi.id)).toBe(true); // Ravi records paying Asha: Asha is asked
    expect(needsOkFor(asha, asha.id)).toBe(false); // Asha records it herself: nothing to ask
    expect(needsOkFor(dev, asha.id)).toBe(false); // Dev is just a name: can't tap anything

    const p1 = await db.payment.create({ data: { groupId: g.id, fromId: ravi.id, toId: asha.id, amount: 30000, createdById: ravi.id, needsOk: true } });
    const p2 = await db.payment.create({ data: { groupId: g.id, fromId: ravi.id, toId: asha.id, amount: 5000, createdById: ravi.id, needsOk: true } });
    expect((await waitingForMe(g.id, asha.id)).map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());

    expect((await confirmPayment(p1.id, ravi.id)).ok).toBe(false); // only Asha
    expect((await confirmPayment(p1.id, asha.id)).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p1.id } })).okAt).not.toBeNull();
    expect((await rejectPayment(p1.id, asha.id)).ok).toBe(false); // already confirmed

    const r = await rejectPayment(p2.id, asha.id);
    expect(r.ok).toBe(true);
    const gone = await db.payment.findUniqueOrThrow({ where: { id: p2.id } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.deletedById).toBe(asha.id);
    expect(await waitingForMe(g.id, asha.id)).toEqual([]);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: g.id, kind: "payment_deleted" } });
    expect(ev.text).toBe("hasn’t received ₹50 from Ravi, so it’s off the balances");
    expect(JSON.parse(ev.undo)).toEqual({ type: "payment_restore", paymentId: p2.id });
  });
});

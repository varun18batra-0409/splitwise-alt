import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Batch C guards (in the style of payments-guard.test.ts): the "I've paid" note machinery stays gone, the only payments that still ask the
// person paid are a flat move-out's, only the one place takes payments off, and the old waiting-for-confirmation words don't come back.
// These read the source files, so a future change that brings any of it back fails here and says where.

const root = path.resolve(__dirname, "..");
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" || name === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx|mjs)$/.test(name) ? [full] : [];
  });
}
const files = (dir: string) => walk(path.join(root, dir)).map(rel);
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const filesWith = (dir: string, test: (text: string) => boolean) => files(dir).filter((f) => test(read(f)));

describe("the note machinery is gone", () => {
  it("no code in src or scripts makes, confirms, declines or withdraws an 'I've paid' note, or reopens one", () => {
    const names = ["makeClaim", "confirmClaim", "declineClaim", "withdrawClaim", "claimPaidAction", "confirmClaimAction", "declineClaimAction", "withdrawClaimAction", "reopenCoveredClaims"];
    for (const name of names) {
      const offenders = [...filesWith("src", (t) => t.includes(name)), ...filesWith("scripts", (t) => t.includes(name))];
      expect(offenders, `${name} is back in: ${offenders.join(", ")}`).toEqual([]);
    }
  });

  it("nothing writes a new note: paymentClaim.create / createMany / upsert are not in src or scripts", () => {
    const write = /paymentClaim\s*\.\s*(create|createMany|upsert)\b/;
    const offenders = [...filesWith("src", (t) => write.test(t)), ...filesWith("scripts", (t) => write.test(t))];
    expect(offenders, `A new "I've paid" note is made in: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("only a flat move-out still asks the person paid", () => {
  it("asksReceiver is used only by the move-out (moving-db.ts) and defined in payments.ts", () => {
    const users = filesWith("src", (t) => t.includes("asksReceiver")).sort();
    expect(users).toEqual(["src/lib/home/moving-db.ts", "src/lib/payments.ts"]);
  });

  it("createPayment never sets needsOk from anything but asksReceiver", () => {
    const text = read("src/lib/payments.ts");
    expect(text).toContain("needsOk: Boolean(p.asksReceiver)");
    expect(text).not.toMatch(/needsOk\??:\s*(boolean|true)/); // no free 'needsOk' input any more
  });
});

describe("payments are taken off in a small set of places", () => {
  // A payment's soft delete (deletedAt set to a date, not null): the person-facing path is payment-change.ts. The others: "Not received" and
  // the answer to a move-out (payment-ok.ts), the move-out's own undo (moving-db.ts), the bulk Undo/Redo of Mark all paid and Settle everything
  // (settle-all.ts), and the data script that puts a conversion back (convert-claims.ts).
  const ALLOWED = new Set(["src/lib/payment-change.ts", "src/lib/payment-ok.ts", "src/lib/home/moving-db.ts", "src/lib/settle-all.ts", "src/lib/convert-claims.ts"]);
  // Looks only inside each payment.update / updateMany call's own brackets, at its `data:` part.
  const softDelete = {
    test(text: string): boolean {
      const call = /\.payment\s*\.\s*(update|updateMany)\s*\(/g;
      for (let m = call.exec(text); m; m = call.exec(text)) {
        let depth = 1;
        let i = m.index + m[0].length;
        const start = i;
        for (; i < text.length && depth > 0; i++) depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
        const inside = text.slice(start, i);
        const at = inside.indexOf("data:");
        if (at >= 0 && /deletedAt\s*:\s*(new Date|at\b|now\b)/.test(inside.slice(at))) return true;
      }
      return false;
    },
  };

  it("no other code in src sets a payment's deletedAt to a date", () => {
    const offenders = files("src").filter((f) => !ALLOWED.has(f)).filter((f) => softDelete.test(read(f)));
    expect(offenders, `Take payments off through changePayment (src/lib/payment-change.ts), not in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the detector sees the pattern, and the allowed places still use it", () => {
    expect(softDelete.test("await tx.payment.updateMany({ where: { id }, data: { deletedAt: new Date(), deletedById: a } });")).toBe(true);
    expect(softDelete.test("await tx.payment.updateMany({ where: { id }, data: { okAt: new Date() } });")).toBe(false);
    for (const f of ["src/lib/payment-change.ts", "src/lib/payment-ok.ts", "src/lib/home/moving-db.ts"]) expect(softDelete.test(read(f)), f).toBe(true);
  });

  it("every route to delete or restore a payment goes through payment-change.ts", () => {
    expect(read("src/lib/save-expense.ts")).toContain("changePayment(");
    expect(read("src/app/pay-link-actions.ts")).toContain("changePayment(");
  });
});

describe("the old 'waiting for them to confirm' words stay out of the screens", () => {
  // The move-out page, the collections pages and CollectBits.tsx keep their own "confirm" wording (a collection really does wait for its organiser).
  const SKIP = (f: string) => f.includes("/move/") || f.includes("CollectBits") || f.includes("/c/") || f.includes("/collect") || f.includes("Collect");
  const PHRASES = ["to be confirmed", "it counts once they do", "Your balance updates after", "confirms receipt", "Confirm it in the box above", "asked to confirm received", "They're asked to confirm", "They’re asked to confirm"];

  it("none of the banned phrases is in src/app or src/components", () => {
    const hits: string[] = [];
    for (const f of [...files("src/app"), ...files("src/components")].filter((x) => !SKIP(x))) {
      const text = read(f);
      for (const p of PHRASES) if (text.includes(p)) hits.push(`${f}: "${p}"`);
    }
    expect(hits).toEqual([]);
  });
});

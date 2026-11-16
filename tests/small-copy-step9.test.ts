import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskEmail } from "@/lib/stats";
import { wholeListNote } from "@/lib/wishes";

// Small wording and safety items: SA-14, AS-13, SA-15, OP-10, CB-3.
describe("small items", () => {
  it("SA-14: the reports page masks emails (the reply-to stays whole for support)", () => {
    expect(maskEmail("asha.k@gmail.com")).toBe("as•••@gmail.com");
    const src = readFileSync("src/app/stats/reports/page.tsx", "utf8");
    expect(src).toContain("maskEmail(p.email)");
    expect(src).not.toContain("(${p.email})");
    expect(src).toContain("Reply to: {r.contact}");
  });

  it("SA-15: the moment screen says who sees it", () => {
    expect(readFileSync("src/app/groups/[id]/moments/new/page.tsx", "utf8")).toContain(
      "One photo and a few words. People in this group see it, and so does anyone who was in the group when you added it.",
    );
  });

  it("OP-10: the privacy page says what an I've-paid link shows", () => {
    const src = readFileSync("src/app/privacy/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(src).toContain("Whoever has it sees the group’s name, the two people’s names, the amount owed and how the person owed asked to be paid (their UPI ID or pay link, with a QR code), and can tap “I’ve paid”.");
  });

  it("CB-3: the share sheet says who already sees the whole list", () => {
    expect(wholeListNote([])).toBe("");
    expect(wholeListNote(["Nupur"])).toBe("Nupur sees your whole list, so sees it too.");
    expect(wholeListNote(["Nupur", "Ravi"])).toBe("Nupur and Ravi see your whole list, so they see it too.");
    expect(wholeListNote(["Nupur", "Ravi", "Meera"])).toBe("Nupur, Ravi and 1 other see your whole list, so they see it too.");
    expect(wholeListNote(["Nupur", "Ravi", "Meera", "Zoe"])).toBe("Nupur, Ravi and 2 others see your whole list, so they see it too.");
    const sheet = readFileSync("src/components/want/WishShareSheet.tsx", "utf8");
    expect(sheet).toContain("Friends you tick can see ${one?.name ?? \"this place\"} on your list.");
    expect(sheet).toContain("wholeListNote(wholeList)");
  });

  it("AS-13: invite emails have a fixed subject, and names carry no links or addresses", async () => {
    const { mailSafe } = await import("@/lib/mail-safe");
    const out = mailSafe("Refund pending – claim at evil.example");
    expect(out).not.toContain("evil.example");
    expect(out).toBe("Refund pending – claim at");
    expect(mailSafe("Win now https://evil.example/x?a=1 today")).toBe("Win now today");
    expect(mailSafe("www.evil.example")).toBe("Someone");
    expect(mailSafe("pay evil@ybl now")).toBe("pay now");
    expect(mailSafe("Goa trip 2026")).toBe("Goa trip 2026");
    expect(mailSafe("  ", "a group")).toBe("a group");
    const invites = readFileSync("src/lib/invites.ts", "utf8");
    expect(invites.match(/"You've been added to a group on Loopin"/g)).toHaveLength(2);
    expect(invites).not.toContain("`${actor.name} added you to ${group.name} on Loopin`");
    const direct = readFileSync("src/lib/direct-db.ts", "utf8");
    expect(direct).toContain('"Expenses shared with you on Loopin"');
    expect(direct).not.toContain("shared expenses with you on Loopin`,\n");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INVITE_EMAIL_HINT, invitedNotice } from "@/lib/invite-label";

// N3: one honest reply for every email invite (a block can't be told apart), never "sent" or "emailed" as if confirmed.
describe("invite notice wording", () => {
  it("says we are emailing, and what to do if it doesn't arrive", () => {
    expect(invitedNotice("x@y.com")).toBe("We’re emailing an invitation to x@y.com. If it doesn’t arrive, share the invite link.");
    expect(invitedNotice("")).toBe("We’re emailing an invitation. If it doesn’t arrive, share the invite link.");
  });
  it("never claims it was sent", () => {
    for (const t of [invitedNotice("x@y.com"), INVITE_EMAIL_HINT]) expect(t).not.toMatch(/\b(sent|emailed)\b/i);
  });
  it("every screen that shows the result uses it", () => {
    for (const f of ["src/app/groups/[id]/people/page.tsx", "src/app/groups/[id]/invite/page.tsx"]) expect(readFileSync(f, "utf8")).toContain("invitedNotice(");
    expect(readFileSync("src/components/AddPeople.tsx", "utf8")).toContain("INVITE_EMAIL_HINT");
    expect(readFileSync("src/components/AddPeople.tsx", "utf8")).not.toContain("emailed an invitation");
  });
});

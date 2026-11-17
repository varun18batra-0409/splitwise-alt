import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// B5 part A: checks on the source of screens that can't be drawn here. They guard the exact thing each fix changed.
const src = (p: string) => readFileSync(p, "utf8");

describe("D1-2 / OP-7: the Updates page marks things read only on the All tab", () => {
  const s = src("src/app/notifications/page.tsx");
  it("works out the tab before it marks anything", () => {
    expect(s.indexOf("const tab:")).toBeGreaterThan(-1);
    expect(s.indexOf("const tab:")).toBeLessThan(s.indexOf("markNotificationsSeen(memberships)"));
  });
  it("marks inside an All-tab check", () => {
    expect(s).toMatch(/if \(tab === "all"\) await Promise\.all\(\[markNotificationsSeen\(memberships\)/);
    expect(s.match(/markNotificationsSeen\(memberships\)/g)).toHaveLength(1);
    expect(s.match(/markNotesSeen\(account\.id\)/g)).toHaveLength(1);
  });
});

describe("D1-6 / VA2-17: the Send tab is held to the same rules as Next", () => {
  const c = src("src/app/postcards/new/Composer.tsx");
  it("both step bars use toStep and pass what is done", () => {
    expect(c.match(/onStep=\{toStep\} done=\{done\}/g)).toHaveLength(2);
    expect(c).not.toMatch(/onStep=\{goStep\}/);
  });
  it("Next and toStep share one reason (sendBlock)", () => {
    expect(c).toContain("const sendBlock = ()");
    expect(c.match(/sendBlock\(\)/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("a blocked Send goes to where the message is written", () => {
    expect(c).toMatch(/return goStep\(oneSide \? "front" : "back"\)/);
  });
  it("the Note step is ticked only when the message is fine", () => {
    expect(c).toContain("back: messageOk");
    const t = src("src/app/postcards/new/editor/TopBar.tsx");
    expect(t.match(/done\?\.\[s\.id\] !== false/g)).toHaveLength(2);
  });
});

describe("A13: a phone that can't get notifications says so", () => {
  const p = src("src/components/PushControls.tsx");
  const text = "Until then, this device won’t get notifications, even with the switches below turned on.";
  it("uses the agreed words (with a curly apostrophe)", () => expect(p).toContain(text));
  it("shows it for iPhone-not-installed and blocked; an unsupported browser says the switches won't work here", () => {
    const uses = p.match(/\{PHONE_NOT_READY\}/g) ?? [];
    expect(uses).toHaveLength(2);
    expect(p).toContain("This browser can’t show notifications, so the switches below won’t do anything here.");
  });
});

describe("AS-10: the collections switch only mutes two items", () => {
  it("push.ts no longer filters every account on collectPush", () => {
    const s = src("src/lib/push.ts");
    expect(s).not.toContain("collectPush: true }, select");
    expect(s).toContain('new Set(["payments.collect", "memories.passport"])');
  });
});

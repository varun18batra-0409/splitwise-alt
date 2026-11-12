import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// POL-01: nothing goes to the AI (Anthropic) until the person said yes. Checked on the server, for signed-in people (the answer
// is on the account) and for phone-only people (the answer is a cookie). The AI call is counted by a fake fetch; no real call is made.

const state = vi.hoisted(() => ({ session: "", ai: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "sw_me" && state.session ? { value: state.session } : n === "loopin_ai" && state.ai ? { value: state.ai } : undefined),
    set: (n: string, v: string) => {
      if (n === "loopin_ai") state.ai = v;
    },
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { readLineAction, setAiConsentAction, getAiConsentAction } = await import("@/app/ai-actions");
const { aiConsentFor, consentRefusal, cleanConsent } = await import("@/lib/ai-consent");
const { encodeSession, today } = await import("@/lib/session");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
process.env.ANTHROPIC_API_KEY = "test-key-not-real";

let calls = 0;
beforeEach(() => {
  calls = 0;
  state.ai = "";
  state.session = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "expense", input: { name: "Dinner", amount: 2400, currency: "", paid_by: "", for_ids: null } }] }), { status: 200 });
    }),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function setup(label: string, opts: { signedIn: boolean }) {
  const acc = await db.account.create({ data: { email: `ai-${label}-${stamp}@example.test`, name: label } });
  accountIds.push(acc.id);
  const g = await db.group.create({
    data: { name: `AI ${label} ${stamp}`, inviteCode: `ai-${label}-${stamp}`, members: { create: [{ name: label, accountId: opts.signedIn ? acc.id : null, claimedAt: new Date() }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  state.session = await encodeSession({ m: { [g.id]: g.members[0].id }, ...(opts.signedIn ? { a: acc.id, v: 0 } : {}), t: today() });
  return { acc, group: g };
}

describe("AI consent: signed-in people", () => {
  it("existing accounts start unanswered (empty, no time), and unanswered counts as no", async () => {
    const { acc } = await setup("old", { signedIn: true });
    const row = await db.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(row.aiConsent).toBe("");
    expect(row.aiConsentAt).toBeNull();
    expect(await aiConsentFor(acc.id)).toBe("");
    expect(await getAiConsentAction()).toBe("");
  });

  it("unanswered: the screen is told to ask, and Anthropic is called zero times", async () => {
    const { group } = await setup("ask", { signedIn: true });
    const r = await readLineAction(group.id, "dinner twenty four hundred");
    expect(r).toMatchObject({ ok: false, needsConsent: true });
    expect(calls).toBe(0);
  });

  it("Not now (no): zero Anthropic calls, however often it is tried, and the answer is stamped", async () => {
    const { acc, group } = await setup("decline", { signedIn: true });
    expect(await setAiConsentAction("no")).toEqual({ ok: true });
    for (let i = 0; i < 3; i++) expect(await readLineAction(group.id, "dinner twenty four hundred")).toMatchObject({ ok: false, consent: "no", needsConsent: false });
    expect(calls).toBe(0);
    const row = await db.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(row.aiConsent).toBe("no");
    expect(row.aiConsentAt).not.toBeNull();
  });

  it("Allow (yes): the call happens once and the answer is used", async () => {
    const { group } = await setup("accept", { signedIn: true });
    await setAiConsentAction("yes");
    const r = await readLineAction(group.id, "dinner twenty four hundred");
    expect(calls).toBe(1);
    expect(r).toMatchObject({ ok: true, name: "Dinner", amount: "2400" });
  });

  it("changing the answer later switches it off again", async () => {
    const { group } = await setup("change", { signedIn: true });
    await setAiConsentAction("yes");
    await setAiConsentAction("no");
    expect(await readLineAction(group.id, "dinner twenty four hundred")).toMatchObject({ ok: false, consent: "no" });
    expect(calls).toBe(0);
  });

  it("nonsense answers are ignored", async () => {
    await setup("junk", { signedIn: true });
    expect(await setAiConsentAction("maybe")).toEqual({ ok: false });
    expect(cleanConsent("maybe")).toBe("");
  });
});

describe("AI consent: phone-only people (cookie)", () => {
  it("no cookie: asks, zero calls", async () => {
    const { group } = await setup("phoneA", { signedIn: false });
    expect(await readLineAction(group.id, "dinner twenty four hundred")).toMatchObject({ ok: false, needsConsent: true });
    expect(calls).toBe(0);
  });

  it("cookie says no: zero calls. Cookie says yes (set by Allow): the call happens", async () => {
    const { group } = await setup("phoneB", { signedIn: false });
    await setAiConsentAction("no");
    expect(state.ai).toBe("no");
    expect(await readLineAction(group.id, "dinner twenty four hundred")).toMatchObject({ ok: false, consent: "no" });
    expect(calls).toBe(0);
    await setAiConsentAction("yes");
    expect(state.ai).toBe("yes");
    expect(await readLineAction(group.id, "dinner twenty four hundred")).toMatchObject({ ok: true });
    expect(calls).toBe(1);
  });

  it("a made-up cookie value counts as unanswered", async () => {
    state.ai = "sure";
    expect(await aiConsentFor(null)).toBe("");
  });
});

describe("what the screen is told", () => {
  it("only yes goes ahead", () => {
    expect(consentRefusal("yes")).toBeNull();
    expect(consentRefusal("")).toMatchObject({ needsConsent: true });
    expect(consentRefusal("no")).toMatchObject({ needsConsent: false });
  });
});

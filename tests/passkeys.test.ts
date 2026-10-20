import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { checkSignIn, registrationOptions, relyingParty, removePasskey, signInOptions } from "@/lib/passkeys";

// Fingerprint / face sign-in: the site check, single-use challenges, and
// people only ever touching their own passkeys. (The full sign-in with a
// virtual fingerprint reader is in the tap-through test.)

describe("which site a passkey belongs to", () => {
  it("loopinapps.com and www share one; plain http is refused except on localhost", () => {
    expect(relyingParty("https://loopinapps.com")).toEqual({ rpID: "loopinapps.com", origin: "https://loopinapps.com" });
    expect(relyingParty("https://www.loopinapps.com")).toEqual({ rpID: "loopinapps.com", origin: "https://www.loopinapps.com" });
    expect(relyingParty("http://localhost:3000")).toEqual({ rpID: "localhost", origin: "http://localhost:3000" });
    expect(relyingParty("http://loopinapps.com")).toBeNull();
    expect(relyingParty("nonsense")).toBeNull();
  });
});

describe("challenges and ownership", () => {
  let a = "", b = "";
  beforeAll(async () => {
    a = (await db.account.create({ data: { email: `pk-a-${Date.now()}@test.dev` } })).id;
    b = (await db.account.create({ data: { email: `pk-b-${Date.now()}@test.dev` } })).id;
    await db.passkey.create({ data: { id: `cred-${Date.now()}`, accountId: a, publicKey: "AAAA" } });
  });
  afterAll(async () => {
    await db.passkey.deleteMany({ where: { accountId: { in: [a, b] } } });
    await db.account.deleteMany({ where: { id: { in: [a, b] } } });
  });
  it("hands out a fresh challenge each time, kept for one use", async () => {
    const o1 = await signInOptions("https://loopinapps.com");
    const o2 = await signInOptions("https://loopinapps.com");
    expect(o1?.challenge).toBeTruthy();
    expect(o1?.challenge).not.toBe(o2?.challenge);
    expect(await db.requestKey.count({ where: { key: `pk:${o1!.challenge}` } })).toBe(1);
    const reg = await registrationOptions(a, "https://loopinapps.com");
    expect(reg?.rp.id).toBe("loopinapps.com");
    expect(reg?.excludeCredentials?.length).toBe(1); // the phone won't make a second one for the same account
  });
  it("refuses a sign-in with an unknown challenge or credential", async () => {
    const fake = { id: "nope", rawId: "nope", type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: Buffer.from(JSON.stringify({ challenge: "not-a-real-challenge-xyz" })).toString("base64url"), authenticatorData: "", signature: "" } };
    expect(await checkSignIn("https://loopinapps.com", fake as never)).toBeNull();
  });
  it("only removes your own passkey", async () => {
    const mine = await db.passkey.findFirstOrThrow({ where: { accountId: a } });
    expect(await removePasskey(b, mine.id)).toBe(false);
    expect(await removePasskey(a, mine.id)).toBe(true);
  });
});

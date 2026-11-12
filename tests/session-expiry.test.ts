import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { LEGACY_T, SESSION_COOKIE, decodeSession, encodeSession, today } from "@/lib/session";
import { middleware } from "@/middleware";

// SEC-06: a signed sign-in is good for 365 days after it was last stamped (t = days since 1970), checked on the server.
// A stamp more than a day in the future is refused too. A token with no stamp (older releases) counts as stamped on
// LEGACY_T, the day of this release (2026-11-12 = day 20769).
//
// Hand-worked with now = day 21000 (any hour of it): t = 21000-365 = 20635 accepted; 20634 refused;
// t = 21001 (tomorrow) accepted; 21002 refused. No stamp: now = day 20769+365 = 21134 accepted; day 21135 refused.

const DAY = 86_400_000;
const at = (day: number) => day * DAY + 5 * 3_600_000; // 05:00 UTC on that day
const tok = (t?: number) => encodeSession({ m: { g: "m" }, ...(t === undefined ? {} : { t }) });

describe("server-side session expiry", () => {
  it("the release day is 2026-11-12", () => {
    expect(LEGACY_T).toBe(20769);
    expect(Date.UTC(2026, 10, 12) / DAY).toBe(20769);
  });
  it("a stamp 365 days old is accepted, 366 is not", async () => {
    expect(await decodeSession(await tok(21000 - 365), at(21000))).not.toBeNull();
    expect(await decodeSession(await tok(21000 - 366), at(21000))).toBeNull();
  });
  it("a stamp one day ahead is accepted (clock differences), two days is not", async () => {
    expect(await decodeSession(await tok(21001), at(21000))).not.toBeNull();
    expect(await decodeSession(await tok(21002), at(21000))).toBeNull();
  });
  it("no stamp: counted from LEGACY_T, 365 days accepted, 366 not", async () => {
    expect(await decodeSession(await tok(), at(LEGACY_T + 365))).not.toBeNull();
    expect(await decodeSession(await tok(), at(LEGACY_T + 366))).toBeNull();
  });
  it("a tampered or expired token is never read as a person", async () => {
    const raw = await tok(21000 - 400);
    expect(await decodeSession(raw, at(21000))).toBeNull();
    expect(await decodeSession(`${raw.slice(0, -3)}abc`, at(21000))).toBeNull();
  });
});

describe("the middleware only renews what still decodes", () => {
  const req = async (raw: string) => new NextRequest("https://loopinapps.com/", { headers: { cookie: `${SESSION_COOKIE}=${raw}`, host: "loopinapps.com" } });
  it("does not renew an expired token", async () => {
    const res = await middleware(await req(await tok(today() - 400)));
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
  it("renews a valid month-old token with a fresh stamp", async () => {
    const res = await middleware(await req(await tok(today() - 40)));
    const fresh = res.cookies.get(SESSION_COOKIE)?.value;
    expect(fresh).toBeTruthy();
    expect((await decodeSession(fresh))?.t).toBe(today());
  });
  it("renews a token with no stamp (an older release) while it is still inside its year", async () => {
    // Only meaningful while today is inside LEGACY_T + 365 (until 2027-11-12); after that such a token is expired by design.
    const res = await middleware(await req(await tok()));
    if (today() <= LEGACY_T + 365) expect((await decodeSession(res.cookies.get(SESSION_COOKIE)?.value))?.t).toBe(today());
    else expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

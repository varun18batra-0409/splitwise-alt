import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkGoogleClaims, decodeJwtPayload, exchangeGoogleCode, googleAuthUrl, newGoogleRequest, packAttempt, unpackAttempt } from "@/lib/google";

// "Continue with Google": only a real, current, verified Google sign-in for
// Loopin is accepted.

const now = 1_800_000_000;
const good = { aud: "loopin-id", iss: "https://accounts.google.com", exp: now + 600, email: "Riya.Sharma@Gmail.com", email_verified: true, given_name: "Riya" };

describe("who Google says it is", () => {
  it("accepts a verified email for our app, and keeps the first name", () => {
    expect(checkGoogleClaims(good, "loopin-id", now)).toEqual({ email: "riya.sharma@gmail.com", name: "Riya" });
    expect(checkGoogleClaims({ ...good, iss: "accounts.google.com", email_verified: "true" }, "loopin-id", now)).not.toBeNull();
  });
  it("refuses another app's token, another issuer, an expired one, or an unverified email", () => {
    expect(checkGoogleClaims({ ...good, aud: "someone-else" }, "loopin-id", now)).toBeNull();
    expect(checkGoogleClaims({ ...good, iss: "https://evil.example" }, "loopin-id", now)).toBeNull();
    expect(checkGoogleClaims({ ...good, exp: now - 1 }, "loopin-id", now)).toBeNull();
    expect(checkGoogleClaims({ ...good, email_verified: false }, "loopin-id", now)).toBeNull();
    expect(checkGoogleClaims({ ...good, email: "not an email" }, "loopin-id", now)).toBeNull();
    expect(checkGoogleClaims(null, "loopin-id", now)).toBeNull();
  });
});

describe("the round trip to Google", () => {
  it("asks for the right things, with PKCE", () => {
    const r = newGoogleRequest();
    expect(r.challenge).toBe(createHash("sha256").update(r.verifier).digest("base64url"));
    const u = new URL(googleAuthUrl("loopin-id", "https://loopinapps.com/api/auth/google/callback", r.state, r.challenge));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "loopin-id",
      redirect_uri: "https://loopinapps.com/api/auth/google/callback",
      response_type: "code",
      scope: "openid email profile",
      state: r.state,
      code_challenge_method: "S256",
    });
  });
  it("remembers the attempt (state, PKCE, where to go back) and rejects junk", () => {
    expect(unpackAttempt(packAttempt("st", "ver", "/join/abc?x=1"))).toEqual({ state: "st", verifier: "ver", back: "/join/abc?x=1" });
    expect(unpackAttempt(undefined)).toBeNull();
    expect(unpackAttempt("only.two")).toBeNull();
  });
  it("swaps the code for the ID token, sending the PKCE verifier", async () => {
    const payload = Buffer.from(JSON.stringify(good)).toString("base64url");
    let sent = "";
    const fakeFetch = (async (_url: string, init: { body: URLSearchParams }) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ id_token: `x.${payload}.sig` }), { status: 200 });
    }) as unknown as typeof fetch;
    const claims = await exchangeGoogleCode("the-code", "the-verifier", "https://loopinapps.com/api/auth/google/callback", fakeFetch);
    expect(claims).toEqual(good);
    expect(sent).toContain("code_verifier=the-verifier");
    expect(sent).toContain("grant_type=authorization_code");
    const refused = (async () => new Response("no", { status: 400 })) as unknown as typeof fetch;
    expect(await exchangeGoogleCode("bad", "v", "https://x", refused)).toBeNull();
    expect(decodeJwtPayload("garbage")).toBeNull();
  });
});

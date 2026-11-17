import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hideSecrets, hideSecretsIn } from "@/lib/log-paths";
import { routeShape } from "@/lib/speed";

// Invite, Collect and "I've paid" codes are the secret in those addresses: never logged (OA-4, AS-11).
describe("codes in addresses are never logged", () => {
  it("hideSecrets replaces the code after /join, /c and /p", () => {
    expect(hideSecrets("/join/AbCdEfGh")).toBe("/join/:code");
    expect(hideSecrets("/c/AbCdEfGhIjK")).toBe("/c/:code");
    expect(hideSecrets("/p/abcdefghij_klmnopqrstu")).toBe("/p/:code");
    expect(hideSecrets("/join/AbCdEfGh?e=asha@example.com&as=1")).toBe("/join/:code");
    expect(hideSecrets("/join/AbCdEfGh/extra")).toBe("/join/:code/extra");
  });
  it("a doubled slash does not hide a code", () => {
    expect(hideSecrets("//join/AbCdEfGh")).toBe("/join/:code");
    expect(hideSecrets("/join//AbCdEfGh")).toBe("/join/:code");
    expect(routeShape("//c/AbCdEfGhIjK")).toBe("/c/:code");
  });
  it("hideSecretsIn hides a code anywhere in an error message", () => {
    expect(hideSecretsIn("Failed to load /join/AbCdEfGh?x=1")).toBe("Failed to load /join/:code?x=1");
    expect(hideSecretsIn("GET https://loopin.app/c/AbCdEfGhIjK failed, then //p/abcdefghij_klmnopqrstu")).toBe("GET https://loopin.app/c/:code failed, then /p/:code");
    expect(hideSecretsIn("Unique constraint on Member.groupId")).toBe("Unique constraint on Member.groupId");
    expect(hideSecretsIn("fetch /groups/g1/people failed")).toBe("fetch /groups/g1/people failed");
  });
  it("the error log runs the message through it as well as the path", () => {
    expect(readFileSync("src/instrumentation.ts", "utf8")).toContain("scrub(hideSecretsIn(String(e?.message ?? err)))");
  });
  it("leaves other addresses alone", () => {
    expect(hideSecrets("/groups/abc/people")).toBe("/groups/abc/people");
    expect(hideSecrets("/")).toBe("/");
    expect(hideSecrets("/join")).toBe("/join");
    expect(hideSecrets("/c")).toBe("/c");
    expect(hideSecrets("/people/p/x")).toBe("/people/p/x");
  });
  it("the speed log keeps the shape, not the code (a code with no digit used to be kept)", () => {
    expect(routeShape("/join/AbCdEfGh")).toBe("/join/:code");
    expect(routeShape("/c/AbCdEfGhIjK?x=1")).toBe("/c/:code");
    expect(routeShape("/p/abcdefghij_klmnopqrstu")).toBe("/p/:code");
    expect(routeShape("/join/abc123")).toBe("/join/:code");
    expect(routeShape("/groups/cmh1abcdefghijklmnopqrst/people")).toBe("/groups/:id/people");
  });
  it("the error log and the public Live-stats output use it", () => {
    const inst = readFileSync("src/instrumentation.ts", "utf8");
    expect(inst).toContain("hideSecrets(request.path)");
    expect(inst.indexOf("hideSecrets(request.path)")).toBeLessThan(inst.indexOf("scrub(`${request.method}") + 80);
    const stats = readFileSync("scripts/live-stats.mjs", "utf8");
    expect(stats).toContain("hideCodes(r.route)");
    expect(stats).toContain("hideCodes(String(r.path)");
  });
  it("the Live-stats regex hides a code in a logged error path", () => {
    const hideCodes = (t: string) => String(t).replace(/(^|\s)\/(join|c|p)\/[^/\s]+/g, "$1/$2/:code");
    expect(hideCodes("GET /join/AbCdEfGh")).toBe("GET /join/:code");
    expect(hideCodes("/c/AbCdEfGhIjK")).toBe("/c/:code");
    expect(hideCodes("GET /groups/x/people")).toBe("GET /groups/x/people");
  });
});

describe("codes printed as fields in an error message are hidden too", () => {
  it("inviteCode, token and code values", () => {
    expect(hideSecretsIn('Invalid `prisma.group.findUnique()` invocation: where: { inviteCode: "AbCdEfGh" }')).toBe('Invalid `prisma.group.findUnique()` invocation: where: { inviteCode: ":code" }');
    expect(hideSecretsIn("token: 'abcdefghij_klmnopqrstu'")).toBe("token: ':code'");
    expect(hideSecretsIn('{ "code": "AbCd12" }')).toBe('{ "code": ":code" }');
    expect(hideSecretsIn("failed for code=AbCd12&x=1")).toBe("failed for code=:code&x=1");
    expect(hideSecretsIn("Unique constraint failed on the fields: (`groupId`)")).toBe("Unique constraint failed on the fields: (`groupId`)");
    expect(hideSecretsIn("decoded 5 of 10")).toBe("decoded 5 of 10");
  });
});

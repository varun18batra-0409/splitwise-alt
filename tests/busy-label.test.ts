import { describe, expect, it } from "vitest";
import { isBusy } from "@/lib/once";

// The libsql adapter reports a busy database through Prisma 6.19 as P2010 "unknown variant `SocketTimeout`".
describe("a busy database is recognised, so money saves try again", () => {
  it("knows the libsql 'SocketTimeout' label as busy", () => {
    const e = Object.assign(new Error("Raw query failed. Code: `InvalidArg`. Message: `unknown variant `SocketTimeout`, expected one of `GenericJs`"), { code: "P2010" });
    expect(isBusy(e)).toBe(true);
  });
  it("still knows the older forms, and not an ordinary error", () => {
    expect(isBusy(new Error("Socket timeout"))).toBe(true);
    expect(isBusy(new Error("database is locked"))).toBe(true);
    expect(isBusy(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))).toBe(false);
  });
});

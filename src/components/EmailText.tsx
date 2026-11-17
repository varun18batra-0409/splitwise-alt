import { Fragment } from "react";
import { emailParts } from "@/lib/format";

// An email address that may only break after the "@" or a "." (a <wbr> is the hint), never in the middle of a name or number.
// Pair it with `break-words` on the parent: that is only a last resort for a single part that is wider than the screen.
export function EmailText({ email }: { email: string }) {
  const parts = emailParts(email);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {p}
        </Fragment>
      ))}
    </>
  );
}

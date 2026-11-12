"use client";

import { useState } from "react";

// A rounded amount (₹68,263) that can show its exact amount (₹68,263.10).
// Screen readers always get the exact amount: the button's spoken name is the exact figure, the same as the group
// cards do. On a phone (no hover) a tap on the amount swaps in the exact one right where it is. It is only the amount
// that is tappable, so it never sits over the buttons underneath.
export function ExactAmount({ amount, exact }: { amount: string; exact: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-label={exact}
      aria-pressed={open}
      title={exact}
      className="inline cursor-pointer appearance-none bg-transparent p-0 text-inherit [font:inherit] [letter-spacing:inherit]"
    >
      <span aria-hidden>{open ? exact : amount}</span>
    </button>
  );
}

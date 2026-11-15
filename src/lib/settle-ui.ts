// Plain constants for the all-groups Settle up cards. Kept out of the "use client" component file so a server page can import them.

export const TONE = { owe: "text-owe", owed: "text-owed" } as const;
// A long amount (₹1,23,456.78) must still fit a 320px phone: the size follows the number of characters.
const SIZE = {
  xl: "text-[34px] min-[360px]:text-[40px]",
  l: "text-[30px] min-[360px]:text-[34px]",
  m: "text-[24px] min-[360px]:text-[28px]",
} as const;
export function amountSize(text: string): string {
  const n = [...text].length;
  return SIZE[n <= 9 ? "xl" : n <= 12 ? "l" : "m"];
}

export const BIG_CREAM = "pop flex h-[52px] w-full min-w-0 items-center justify-center whitespace-nowrap bg-fg px-4 text-[16px] font-semibold text-canvas [--pop-edge:#6e6b63]";
export const BIG_OUTLINE =
  "flex h-[52px] w-full min-w-0 items-center justify-center whitespace-nowrap rounded-full border border-fg/30 px-4 text-[16px] font-semibold text-fg transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

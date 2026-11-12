// What makes one Notice "the same message" as another: if this changes, a notice someone closed comes back.
// Plain text children count by their words; anything richer counts by the remember key and the address markers only.
export function noticeText(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(noticeText).join("");
  return "";
}

export function noticeIdentity(remember: string | undefined, params: string[], children: unknown): string {
  return [remember ?? "", params.join(","), noticeText(children)].join("|");
}

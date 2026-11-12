// Where "Contact support" goes: the privacy/support email when one is set (SUPPORT_EMAIL or PRIVACY_EMAIL in the hosting settings),
// otherwise a small form on /support that emails the operator.
export function supportEmail(): string | null {
  const v = (process.env.SUPPORT_EMAIL || process.env.PRIVACY_EMAIL || "").trim();
  return /^[^\s@{}]+@[^\s@{}]+\.[^\s@{}]+$/.test(v) ? v : null;
}
export const supportHref = (): string => {
  const e = supportEmail();
  return e ? `mailto:${e}` : "/support";
};

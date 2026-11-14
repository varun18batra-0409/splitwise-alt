import { formatMoney } from "@/lib/money";
import { overviewMoney } from "@/lib/money-display";

// An amount on an overview screen: whole units from 1,000 up (display only). The exact amount stays in the
// tooltip and `data-exact`, for tests, tools and anyone who asks. Never use this where the exact figure is the point
// (Settle up, Record payment, pay links, expense forms).
export function Amt({ minor, currency = "INR", className }: { minor: number; currency?: string; className?: string }) {
  const exact = formatMoney(minor, currency);
  return (
    <span className={className} title={exact} data-exact={exact}>
      {overviewMoney(minor, currency)}
    </span>
  );
}

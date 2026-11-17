import { allocateByWeights } from "../split";
import { decimalsOf } from "../money";
import { monthsBetween } from "./bills";

// Savings goals (pure): how much a month gets you there, and each person's part.
export function goalPlan(g: { currency?: string; target: number; saved: number; today: string; byDate: string; createdAt: string; weights: Record<string, number> }) {
  const left = Math.max(0, g.target - g.saved);
  let months = 0;
  if (g.byDate && /^\d{4}-\d{2}-\d{2}$/.test(g.byDate)) {
    months = monthsBetween(g.today.slice(0, 7), g.byDate.slice(0, 7)) - (g.byDate.slice(8, 10) < g.today.slice(8, 10) ? 1 : 0);
    months = Math.max(1, months);
  }
  // The plan is in whole rupees (₹42,667 a month, not ₹42,666.67): rounded up to a whole unit, and shared out in whole units.
  const unit = 10 ** decimalsOf(g.currency ?? "INR");
  const perMonth = left && months ? Math.ceil(left / months / unit) * unit : 0;
  const perPerson = perMonth
    ? allocateByWeights(perMonth / unit, Object.entries(g.weights).map(([memberId, weight]) => ({ memberId, weight }))).map((a) => ({ ...a, amount: a.amount * unit }))
    : [];
  const soFar = Math.max(1, monthsBetween(g.createdAt.slice(0, 7), g.today.slice(0, 7)) + 1);
  const onTrack = left === 0 || !months || g.saved / soFar >= perMonth;
  return { left, months, perMonth, perPerson, onTrack };
}

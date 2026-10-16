import { allocateByWeights } from "../split";
import { monthsBetween } from "./bills";

// Savings goals (pure): how much a month gets you there, and each person's part.
export function goalPlan(g: { target: number; saved: number; today: string; byDate: string; createdAt: string; weights: Record<string, number> }) {
  const left = Math.max(0, g.target - g.saved);
  let months = 0;
  if (g.byDate && /^\d{4}-\d{2}-\d{2}$/.test(g.byDate)) {
    months = monthsBetween(g.today.slice(0, 7), g.byDate.slice(0, 7)) - (g.byDate.slice(8, 10) < g.today.slice(8, 10) ? 1 : 0);
    months = Math.max(1, months);
  }
  const perMonth = left && months ? Math.ceil(left / months) : 0;
  const perPerson = perMonth ? allocateByWeights(perMonth, Object.entries(g.weights).map(([memberId, weight]) => ({ memberId, weight }))) : [];
  const soFar = Math.max(1, monthsBetween(g.createdAt.slice(0, 7), g.today.slice(0, 7)) + 1);
  const onTrack = left === 0 || !months || g.saved / soFar >= perMonth;
  return { left, months, perMonth, perPerson, onTrack };
}

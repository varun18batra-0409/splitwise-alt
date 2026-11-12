import { allow } from "./rate-limit";
import { decimalsOf, isSupportedCurrency } from "./money";

// Reading bills and spoken expenses with Claude (Anthropic). Off unless the
// ANTHROPIC_API_KEY is set in the hosting settings; then a fast model reads
// first and a stronger one tries again only if the first couldn't. Daily
// ceilings keep the bill small: for the whole app and for each person.
// Only the photo or the line is sent; Anthropic doesn’t train on what apps send it.

const API = "https://api.anthropic.com/v1/messages";
const FAST = process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-5-5";
const STRONG = process.env.ANTHROPIC_MODEL_STRONG || "claude-sonnet-5-5";

export const aiReady = () => Boolean(process.env.ANTHROPIC_API_KEY);

// Calls for the whole app per day (AI_DAILY_CAP), and per person per day.
export async function aiAllowed(who: string): Promise<string | null> {
  if (!aiReady()) return "Reading bills isn’t switched on yet.";
  const cap = Number(process.env.AI_DAILY_CAP ?? 400);
  if (!(await allow(`ai:person:${who}`, 25, 86_400))) return "You’ve used today’s bill reading. Fill this one in by hand; it’s back tomorrow.";
  if (!(await allow("ai:all", Math.max(1, cap), 86_400))) return "Bill reading is resting for today. Fill this one in by hand.";
  return null;
}

type Content = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type Tool = { name: string; description: string; input_schema: Record<string, unknown> };

// One structured answer: the model must fill in `tool`'s fields.
async function call<T>(model: string, system: string, content: Content[], tool: Tool, maxTokens: number): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25_000);
  try {
    const res = await fetch(API, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }], tools: [tool], tool_choice: { type: "tool", name: tool.name } }),
    });
    if (!res.ok) {
      console.error("ai: request failed", res.status);
      return null;
    }
    const body = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    const use = body.content?.find((c) => c.type === "tool_use" && c.name === tool.name);
    return (use?.input as T) ?? null;
  } catch (err) {
    console.error("ai: request error", String(err).slice(0, 120));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Bills ----------------------------------------------------------------

export type ReadBill = {
  merchant: string;
  total: number | null; // in the bill's currency, e.g. 1180.5
  currency: string; // ISO code, or "" if the bill doesn't say
  date: string; // YYYY-MM-DD, or ""
  items: { name: string; price: number }[];
  extras: number; // tax + service + tip, already inside the total
};

const BILL_TOOL: Tool = {
  name: "bill",
  description: "What the photographed bill says.",
  input_schema: {
    type: "object",
    properties: {
      is_bill: { type: "boolean", description: "false if this isn't a bill, receipt or invoice" },
      merchant: { type: "string", description: "The shop or restaurant name, short (\"Toit\", \"DMart\"). Empty if unclear." },
      total: { type: ["number", "null"], description: "The final amount paid, including tax, service and tip. A plain number." },
      currency: { type: "string", description: "ISO 4217 code, from the symbol or the country on the bill. Empty if unknown." },
      date: { type: "string", description: "The bill's date as YYYY-MM-DD, or empty." },
      items: {
        type: "array",
        description: "Each line item with its final line price (quantity × unit price). At most 40. Leave out tax, service and tip lines.",
        items: { type: "object", properties: { name: { type: "string" }, price: { type: "number" } }, required: ["name", "price"] },
      },
      extras: { type: "number", description: "Tax, service charge and tip together, as included in the total. 0 if none." },
    },
    required: ["is_bill", "merchant", "total", "currency", "date", "items", "extras"],
  },
};

const BILL_SYSTEM =
  "You read photos of bills and receipts (often Indian: GST, CGST/SGST, service charge, round-off) for a bill-splitting app. Read the numbers exactly as printed; never guess a total that isn't there. Item names short and readable, as on the bill.";

export function cleanBill(raw: Record<string, unknown> | null): ReadBill | null {
  if (!raw || raw.is_bill === false) return null;
  // Up to 3 decimals (dinar, rial); a currency with fewer is rounded to its own, so the form never gets a number it would refuse.
  const currency = /^[A-Z]{3}$/.test(String(raw.currency ?? "").toUpperCase()) ? String(raw.currency).toUpperCase() : "";
  const scale = 10 ** (currency && isSupportedCurrency(currency) ? decimalsOf(currency) : 3);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v * scale) / scale : null);
  const total = num(raw.total);
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((x) => ({ name: String((x as { name?: unknown })?.name ?? "").trim().slice(0, 40), price: num((x as { price?: unknown })?.price) ?? 0 }))
    .filter((x) => x.name && x.price > 0)
    .slice(0, 40);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? "")) ? String(raw.date) : "";
  return { merchant: String(raw.merchant ?? "").trim().slice(0, 60), total, currency, date, items, extras: num(raw.extras) ?? 0 };
}

// Fast model first; the stronger one only if it read a bill but found no total.
export async function readBill(image: Uint8Array, type: string): Promise<ReadBill | null> {
  const content: Content[] = [
    { type: "image", source: { type: "base64", media_type: type, data: Buffer.from(image).toString("base64") } },
    { type: "text", text: "Read this bill." },
  ];
  const raw = await call<Record<string, unknown>>(FAST, BILL_SYSTEM, content, BILL_TOOL, 1500);
  const first = cleanBill(raw);
  if (first?.total) return first;
  // The stronger model only when the fast one did read a bill but found no total:
  // not for a photo that isn't a bill, and not after a failed call (each is a paid call).
  if (!raw || raw.is_bill === false) return null;
  return cleanBill(await call<Record<string, unknown>>(STRONG, BILL_SYSTEM, content, BILL_TOOL, 1500)) ?? first;
}

// ---- A spoken or typed line ---------------------------------------------

export type ReadLine = { name: string; amount: number | null; currency: string; paidBy: string; forIds: string[] | null };

const LINE_TOOL: Tool = {
  name: "expense",
  description: "The expense described in the sentence.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "What it was for, 1–4 words, e.g. \"Dinner\", \"Cab to airport\"." },
      amount: { type: ["number", "null"], description: "The amount, a plain number. null if none was said." },
      currency: { type: "string", description: "ISO code only if one was said (\"dollars\" = USD, \"baht\" = THB), else empty." },
      paid_by: { type: "string", description: "The id of the person who paid, or empty if not said. \"I\" / \"me\" = the speaker." },
      for_ids: { type: ["array", "null"], items: { type: "string" }, description: "Ids of who it's for (split equally), or null if not said. \"everyone\" = all ids." },
    },
    required: ["name", "amount", "currency", "paid_by", "for_ids"],
  },
};

export async function readLine(text: string, people: { id: string; name: string }[], meId: string): Promise<ReadLine | null> {
  const list = people.map((p) => `${p.id}: ${p.name}${p.id === meId ? " (the speaker)" : ""}`).join("\n");
  const raw = await call<Record<string, unknown>>(
    FAST,
    "You turn one spoken or typed sentence (English, Hindi or Hinglish) into an expense for a bill-splitting app. Only use the ids listed. Never invent an amount.",
    [{ type: "text", text: `People in the group:\n${list}\n\nSentence: ${text.slice(0, 300)}` }],
    LINE_TOOL,
    400,
  );
  if (!raw) return null;
  const ids = new Set(people.map((p) => p.id));
  const amount = typeof raw.amount === "number" && Number.isFinite(raw.amount) && raw.amount > 0 && raw.amount < 1e9 ? Math.round(raw.amount * 1000) / 1000 : null;
  const forIds = Array.isArray(raw.for_ids) ? [...new Set(raw.for_ids.map(String).filter((x) => ids.has(x)))] : null;
  return {
    name: String(raw.name ?? "").trim().slice(0, 80),
    amount,
    currency: /^[A-Z]{3}$/.test(String(raw.currency ?? "").toUpperCase()) ? String(raw.currency).toUpperCase() : "",
    paidBy: ids.has(String(raw.paid_by ?? "")) ? String(raw.paid_by) : "",
    forIds: forIds && forIds.length ? forIds : null,
  };
}

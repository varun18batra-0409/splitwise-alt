import { expenseIcon } from "@/lib/expense-icons";

// The picture next to an expense: a clean line icon on a softly tinted tile,
// coloured by category (instead of a cartoon emoji). Which icon comes from the
// same words as before ("Flight" → plane, "Chai" → cup), so nothing to relearn.

type Glyph = keyof typeof PATHS;

// 24 × 24 line drawings (stroke only), in the style of the app's other icons.
const PATHS = {
  plane: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
  train: "M5 15V7a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM5 11h14M9 14.5h.01M15 14.5h.01M8 22l2-4M16 22l-2-4",
  bus: "M6 17V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v11M4 17h16M6 11h12M8 20v-3M16 20v-3M8.5 14h.01M15.5 14h.01",
  car: "M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2M9 17h6M7 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM17 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  scooter: "M5 18a2 2 0 1 0 0-.01M19 18a2 2 0 1 0 0-.01M7 17h8l3-6h-4M14 7h3l1 4M9 17l-2-6H4",
  fuel: "M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.8a2 2 0 0 0-.6-1.4L18 5",
  boat: "M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M19.4 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.9 5.3 2.8 7.8M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6M12 10v4M12 2v3",
  road: "M4 22 8 2M20 22 16 2M12 4v3M12 11v3M12 18v3",
  parking: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 17V7h4a3 3 0 0 1 0 6H9",
  food: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7",
  coffee: "M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2",
  drink: "M8 22h8M7 10h10M12 15v7M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5z",
  dessert: "m7 11 4.1 10.4a1 1 0 0 0 1.8 0L17 11M17 7A5 5 0 0 0 7 7M17 7a2 2 0 0 1 0 4H7a2 2 0 0 1 0-4",
  delivery: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  bed: "M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9",
  house: "M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10",
  palm: "M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v8a2 2 0 0 0 4 0",
  bag: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  shirt: "M20.4 6.6 16 4a4 4 0 0 1-8 0L3.6 6.6a1 1 0 0 0-.5 1.2l1 3a1 1 0 0 0 1.3.6L7 11v10h10V11l1.6.4a1 1 0 0 0 1.3-.6l1-3a1 1 0 0 0-.5-1.2z",
  gift: "M3 8h18v4H3zM12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5",
  phone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01",
  cart: "M8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM2 2h2l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22 7H5.1",
  leaf: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10zM2 21c0-3 1.9-5.4 5.2-6.1",
  ticket: "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2zM13 5v2M13 17v2M13 11v2",
  film: "M4 11v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8zM4 11l-.9-2.9a2 2 0 0 1 1.3-2.5l11.5-3.5a2 2 0 0 1 2.5 1.3l.9 2.9zM6.6 5l3.4 4.2M11.9 3.4l3.4 4.2",
  mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  mountain: "M8 3l4 8 5-5 5 15H2z",
  landmark: "M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z",
  spa: "M9.9 15.5a2 2 0 0 0-1.4-1.4l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6a2 2 0 0 0 1.4-1.4l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0zM20 3v4M22 5h-4",
  wave: "M2 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 18c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M12 2v4",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9z",
  drop: "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5 12 2.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z",
  wifi: "M12 20h.01M2 8.8a15 15 0 0 1 20 0M5 12.9a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0",
  tv: "M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM17 2l-5 5-5-5",
  flame: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.4 1.6 1.7 2.8 3.5 2.8z",
  broom: "M19 3 9.5 12.5M14 18l-5-5-5 2 0 0 3 7 7-4zM9 13l2-2",
  receipt: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM16 8H8M16 12H8M13 16H8",
} as const;

// The emoji the rules pick → the matching line icon.
const FROM_EMOJI: Record<string, Glyph> = {
  "✈️": "plane", "🚆": "train", "🚇": "train", "🚌": "bus", "🚗": "car", "🚕": "car", "🛺": "car", "🛵": "scooter", "⛽": "fuel",
  "🅿️": "parking", "🛣️": "road", "⛴️": "boat",
  "🍽️": "food", "☕": "coffee", "🍻": "drink", "🍨": "dessert", "🥡": "delivery", "🍕": "food", "🍔": "food", "🍜": "food", "🍣": "food", "🍛": "food", "🥐": "coffee",
  "🏨": "bed", "🛏️": "bed", "🏠": "house", "🏖️": "palm",
  "🛍️": "bag", "👕": "shirt", "🎁": "gift", "📱": "phone",
  "🛒": "cart", "🍎": "leaf", "🥛": "cart", "🥦": "leaf",
  "🎟️": "ticket", "🎬": "film", "🎤": "mic", "🥾": "mountain", "🏛️": "landmark", "💆": "spa", "🤿": "wave", "🎢": "ticket",
  "💡": "bolt", "⚡": "bolt", "💧": "drop", "📶": "wifi", "📺": "tv", "🔥": "flame", "🧹": "broom",
  "📦": "receipt",
};

// Soft tints per category (tile background at low strength, icon at full).
export const CATEGORY_TINT: Record<string, string> = {
  food: "#f5b562",
  transport: "#7cc4ff",
  accommodation: "#b79cff",
  shopping: "#ff8fc7",
  groceries: "#9fdc6a",
  activities: "#5fdccb",
  bills: "#ffd66b",
  other: "#b9b4a8",
};

export function ExpenseGlyph({ title, category, size = 40, className = "" }: { title: string; category: string; size?: number; className?: string }) {
  const glyph = FROM_EMOJI[expenseIcon(title, category)] ?? "receipt";
  const tint = CATEGORY_TINT[category] ?? CATEGORY_TINT.other;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-[14px] ${className}`}
      style={{ width: size, height: size, background: `${tint}1f`, color: tint, boxShadow: `inset 0 0 0 1px ${tint}26` }}
    >
      <svg width={size * 0.48} height={size * 0.48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS[glyph]} />
      </svg>
    </span>
  );
}

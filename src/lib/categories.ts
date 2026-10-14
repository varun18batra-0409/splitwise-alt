// Expense categories. The app guesses one from the expense name
// ("dinner" → Food & Drinks, "uber" → Transport) and the person can change it.
// Runs inside the app — no paid AI service. Add words to the lists to teach it more.

export type Category = { id: string; label: string; short: string; emoji: string; words: string[] };

export const CATEGORIES: Category[] = [
  {
    id: "food", label: "Food & Drinks", short: "Food", emoji: "🍽️",
    words: ["food", "dinner", "lunch", "breakfast", "brunch", "meal", "restaurant", "dhaba", "cafe", "coffee",
      "tea", "chai", "snack", "pizza", "burger", "biryani", "dosa", "idli", "momo", "thali", "paratha", "maggi",
      "noodle", "sandwich", "dessert", "cake", "sweet", "ice cream", "icecream", "swiggy", "zomato", "kfc",
      "mcdonalds", "dominos", "starbucks", "takeaway", "dine", "street food", "pad thai", "pho", "ramen", "sushi",
      "drink", "beer", "wine", "whisky", "whiskey", "vodka", "rum", "gin", "tequila", "shot", "cocktail",
      "alcohol", "liquor", "daru", "booze", "bar", "pub", "brewery", "theka", "juice", "smoothie"],
  },
  {
    id: "transport", label: "Transport", short: "Transport", emoji: "🚕",
    words: ["uber", "ola", "rapido", "grab", "bolt", "taxi", "cab", "auto", "rickshaw", "tuk tuk", "tuktuk",
      "metro", "bts", "mrt", "bus", "train", "petrol", "diesel", "fuel", "parking", "toll", "fastag", "ride",
      "scooty", "scooter", "bike rental", "car rental", "flight", "airline", "airport", "indigo", "vistara",
      "air india", "airasia", "irctc", "ferry", "transfer"],
  },
  {
    id: "accommodation", label: "Accommodation", short: "Stay", emoji: "🏨",
    words: ["hotel", "airbnb", "hostel", "resort", "stay", "room", "oyo", "homestay", "villa", "lodge",
      "guesthouse", "guest house", "accommodation", "booking"],
  },
  {
    id: "shopping", label: "Shopping", short: "Shopping", emoji: "🛍️",
    words: ["shopping", "amazon", "flipkart", "myntra", "ajio", "nykaa", "clothes", "shirt", "jeans", "shoe",
      "gift", "souvenir", "mall", "market", "electronics", "sim card", "sim"],
  },
  {
    id: "groceries", label: "Groceries", short: "Groceries", emoji: "🛒",
    words: ["grocery", "groceries", "vegetable", "veggies", "sabzi", "fruit", "milk", "egg", "bread", "kirana",
      "supermarket", "blinkit", "zepto", "bigbasket", "instamart", "dmart", "7-eleven", "7 eleven", "seven eleven"],
  },
  {
    id: "activities", label: "Activities & Tickets", short: "Activities", emoji: "🎟️",
    words: ["ticket", "entry", "entrance", "museum", "temple", "palace", "park", "tour", "trip", "sightseeing",
      "boat", "cruise", "trek", "snorkel", "snorkeling", "diving", "scuba", "spa", "massage", "show", "movie",
      "cinema", "film", "pvr", "inox", "concert", "party", "club", "bowling", "game", "gaming", "event",
      "cover charge", "activity", "excursion", "safari"],
  },
  {
    id: "bills", label: "Bills & Utilities", short: "Bills", emoji: "💡",
    words: ["rent", "electricity", "wifi", "internet", "broadband", "recharge", "phone bill", "mobile bill",
      "gas", "cylinder", "maintenance", "maid", "laundry", "subscription", "netflix", "spotify", "hotstar",
      "bill", "utilities", "insurance", "visa"],
  },
  { id: "other", label: "Other", short: "Other", emoji: "📦", words: [] },
];

// Categories used before this list existed, mapped to their new home.
export const LEGACY_CATEGORY_MAP: Record<string, string> = {
  drinks: "food",
  travel: "transport",
  stay: "accommodation",
  fun: "activities",
  health: "other",
};

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = CATEGORIES.filter((c) => c.words.length > 0).map((c) => ({
  id: c.id,
  // whole words only, allowing plurals: "beers", "buses"
  re: new RegExp(`\\b(?:${c.words.map(escape).join("|")})(?:s|es)?\\b`, "i"),
}));

// Picks the category whose word appears FIRST, so "flight tickets" → Transport.
export function guessCategory(description: string): string {
  let best: { id: string; index: number } | null = null;
  for (const p of PATTERNS) {
    const m = p.re.exec(description);
    if (m && (best === null || m.index < best.index)) best = { id: p.id, index: m.index };
  }
  return best?.id ?? "other";
}

export function getCategory(id: string): Category {
  return BY_ID.get(id) ?? BY_ID.get(LEGACY_CATEGORY_MAP[id] ?? "other")!;
}

export function isCategory(id: string): boolean {
  return BY_ID.has(id);
}

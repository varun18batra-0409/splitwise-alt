// Smart "buckets": guesses a category from the description, e.g.
// "dinner" → Food, "beer" → Drinks, "uber" → Transport.
// Runs inside the app — no paid AI service. Add words to the lists to teach it more.

export type Category = { id: string; label: string; emoji: string; words: string[] };

export const CATEGORIES: Category[] = [
  {
    id: "food", label: "Food", emoji: "🍽️",
    words: ["food", "dinner", "lunch", "breakfast", "brunch", "meal", "restaurant", "dhaba", "cafe", "coffee",
      "tea", "chai", "snack", "pizza", "burger", "biryani", "dosa", "idli", "momo", "thali", "paratha", "maggi",
      "noodle", "sandwich", "dessert", "cake", "sweet", "ice cream", "icecream", "swiggy", "zomato", "kfc",
      "mcdonalds", "dominos", "starbucks", "takeaway", "dine"],
  },
  {
    id: "drinks", label: "Drinks", emoji: "🍺",
    words: ["drink", "beer", "wine", "whisky", "whiskey", "vodka", "rum", "gin", "tequila", "shot", "cocktail",
      "alcohol", "liquor", "daru", "booze", "bar", "pub", "brewery", "theka"],
  },
  {
    id: "groceries", label: "Groceries", emoji: "🛒",
    words: ["grocery", "groceries", "vegetable", "veggies", "sabzi", "fruit", "milk", "egg", "bread", "kirana",
      "supermarket", "blinkit", "zepto", "bigbasket", "instamart", "dmart"],
  },
  {
    id: "transport", label: "Transport", emoji: "🚕",
    words: ["uber", "ola", "rapido", "taxi", "cab", "auto", "rickshaw", "metro", "bus", "train", "petrol",
      "diesel", "fuel", "parking", "toll", "fastag", "ride", "scooty"],
  },
  {
    id: "travel", label: "Travel", emoji: "✈️",
    words: ["flight", "airline", "airport", "indigo", "vistara", "air india", "irctc", "visa", "trip", "tour",
      "sightseeing", "boat", "cruise", "trek"],
  },
  {
    id: "stay", label: "Stay", emoji: "🏨",
    words: ["hotel", "airbnb", "hostel", "resort", "stay", "room", "oyo", "homestay", "villa", "lodge"],
  },
  {
    id: "fun", label: "Entertainment", emoji: "🎬",
    words: ["movie", "cinema", "film", "pvr", "inox", "netflix", "spotify", "hotstar", "concert", "party", "club",
      "bowling", "game", "gaming", "show", "event", "cover charge"],
  },
  {
    id: "shopping", label: "Shopping", emoji: "🛍️",
    words: ["shopping", "amazon", "flipkart", "myntra", "ajio", "nykaa", "clothes", "shirt", "jeans", "shoe",
      "gift", "mall", "electronics"],
  },
  {
    id: "bills", label: "Bills", emoji: "💡",
    words: ["rent", "electricity", "wifi", "internet", "broadband", "recharge", "phone bill", "mobile bill",
      "gas", "cylinder", "maintenance", "maid", "laundry", "subscription", "bill"],
  },
  {
    id: "health", label: "Health", emoji: "💊",
    words: ["medicine", "pharmacy", "chemist", "doctor", "hospital", "clinic", "gym", "medical"],
  },
  { id: "other", label: "Other", emoji: "📦", words: [] },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = CATEGORIES.filter((c) => c.words.length > 0).map((c) => ({
  id: c.id,
  // whole words only, allowing plurals: "beers", "buses"
  re: new RegExp(`\\b(?:${c.words.map(escape).join("|")})(?:s|es)?\\b`, "i"),
}));

// Picks the category whose word appears FIRST, so "dinner and drinks" → Food.
export function guessCategory(description: string): string {
  let best: { id: string; index: number } | null = null;
  for (const p of PATTERNS) {
    const m = p.re.exec(description);
    if (m && (best === null || m.index < best.index)) best = { id: p.id, index: m.index };
  }
  return best?.id ?? "other";
}

export function getCategory(id: string): Category {
  return BY_ID.get(id) ?? BY_ID.get("other")!;
}

export function isCategory(id: string): boolean {
  return BY_ID.has(id);
}

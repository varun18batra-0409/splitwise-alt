// Expense categories. The app guesses one from the expense name
// ("dinner" → Food & Drinks, "uber" → Transport) and the person can change it.
// It also copes with typos ("dinnr", "petrl", "grocries") and suggests the
// correct spelling. Runs inside the app — no paid AI service.
// To teach it more, add words to the lists below.

export type Category = { id: string; label: string; short: string; emoji: string; words: string[] };

export const CATEGORIES: Category[] = [
  {
    id: "food", label: "Food & Drinks", short: "Food", emoji: "🍽️",
    words: ["food", "dinner", "lunch", "breakfast", "brunch", "meal", "restaurant", "dhaba", "cafe", "coffee",
      "tea", "chai", "snack", "pizza", "burger", "biryani", "dosa", "idli", "momo", "thali", "paratha", "maggi",
      "noodle", "sandwich", "dessert", "cake", "pastry", "bakery", "sweet", "ice cream", "icecream", "swiggy",
      "zomato", "uber eats", "eatsure", "faasos", "kfc", "mcdonalds", "dominos", "pizza hut", "starbucks", "haldiram",
      "takeaway", "dine", "dining", "buffet", "barbeque", "barbecue", "bbq", "street food", "pad thai", "pho", "ramen",
      "sushi", "nashta", "khana", "tiffin", "chicken", "mutton", "paneer", "pork", "fish", "seafood", "lassi",
      "drink", "beer", "wine", "whisky", "whiskey", "vodka", "rum", "gin", "tequila", "shot", "cocktail",
      "alcohol", "liquor", "daru", "booze", "bar", "pub", "brewery", "theka", "juice", "smoothie", "soda"],
  },
  {
    id: "transport", label: "Transport", short: "Transport", emoji: "🚕",
    words: ["uber", "ola", "rapido", "grab", "bolt", "taxi", "cab", "auto", "rickshaw", "tuk tuk", "tuktuk",
      "metro", "bts", "mrt", "bus", "redbus", "train", "irctc", "petrol", "diesel", "fuel", "cng", "ev charging",
      "parking", "toll", "fastag", "ride", "scooty", "scooter", "bike rental", "car rental", "flight", "airline",
      "airport", "air ticket", "airfare", "air fare", "plane", "rail", "railway", "boat", "rental car", "car hire", "indigo", "vistara", "air india", "akasa", "spicejet", "airasia", "ferry", "transfer",
      "travel"],
  },
  {
    id: "accommodation", label: "Accommodation", short: "Stay", emoji: "🏨",
    words: ["hotel", "airbnb", "hostel", "zostel", "resort", "stay", "room", "oyo", "treebo", "fabhotels", "agoda",
      "booking.com", "goibibo", "homestay", "villa", "lodge", "guesthouse", "guest house", "accommodation", "booking"],
  },
  {
    id: "shopping", label: "Shopping", short: "Shopping", emoji: "🛍️",
    words: ["shopping", "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "decathlon", "ikea", "croma",
      "clothes", "shirt", "tshirt", "jeans", "dress", "shoe", "gift", "souvenir", "mall", "market", "electronics",
      "sim card", "sim"],
  },
  {
    id: "groceries", label: "Groceries", short: "Groceries", emoji: "🛒",
    words: ["grocery", "groceries", "vegetable", "veggies", "sabzi", "fruit", "milk", "egg", "bread", "atta", "rice",
      "dal", "kirana", "supermarket", "blinkit", "zepto", "bigbasket", "big basket", "jiomart", "amazon fresh",
      "instamart", "dmart", "reliance fresh", "7-eleven", "7 eleven", "seven eleven"],
  },
  {
    id: "activities", label: "Activities & Tickets", short: "Activities", emoji: "🎟️",
    words: ["ticket", "entry", "entrance", "museum", "temple", "palace", "fort", "park", "zoo", "beach", "tour",
      "trip", "sightseeing", "boat", "cruise", "trek", "snorkel", "snorkeling", "diving", "scuba", "rafting",
      "paragliding", "go karting", "gokarting", "adventure", "spa", "massage", "show", "movie", "cinema", "film",
      "pvr", "inox", "bookmyshow", "book my show", "concert", "party", "club", "bowling", "game", "gaming", "event",
      "cover charge", "activity", "excursion", "safari"],
  },
  {
    id: "bills", label: "Bills & Utilities", short: "Bills", emoji: "💡",
    words: ["rent", "room rent", "house rent", "flat rent", "electricity", "electric", "light bill", "water bill",
      "gas bill", "gas", "lpg", "cylinder", "wifi", "internet", "broadband", "recharge", "jio", "airtel", "dth",
      "phone bill", "mobile bill", "maintenance", "society", "maid", "cook", "laundry", "dry clean", "ironing",
      "subscription", "netflix", "prime", "spotify", "hotstar", "youtube premium", "emi", "insurance", "bill",
      "utilities", "visa"],
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
const ORDER = new Map(CATEGORIES.map((c, i) => [c.id, i]));

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYWORDS = CATEGORIES.flatMap((c) =>
  c.words.map((word) => ({
    word,
    category: c.id,
    // whole words only, allowing plurals: "beers", "buses"
    re: new RegExp(`(?<![a-z0-9])${escape(word)}(?:s|es)?(?![a-z0-9])`, "i"),
  })),
);
// Where you were rather than what you bought: these lose to any other word.
const WEAK = new Set(["market", "mall"]);

// Single words long enough to be worth typo-matching ("dinner", "petrol", "groceries").
const FUZZY = KEYWORDS.filter((k) => /^[a-z]+$/.test(k.word) && k.word.length >= 4);
const KNOWN = new Set(KEYWORDS.map((k) => k.word));

// Real English words that look like typos of a keyword but aren't
// ("rest" ≠ "rent", "full" ≠ "fuel"). They're never "corrected".
const COMMON = new Set([
  "thai", "goa", "rest", "test", "best", "west", "nest", "full", "fill", "fell", "fall", "call", "cell", "hall", "ball", "wall",
  "tall", "card", "cart", "care", "sale", "same", "lake", "make", "take", "fake", "line", "fine", "mine", "nine",
  "wine", "dine", "time", "home", "come", "some", "game", "came", "name", "part", "port", "post", "past", "fast",
  "last", "mast", "show", "slow", "snow", "stay", "star", "stop", "shop", "ship", "trap", "tram", "team", "tram",
  "cash", "paid", "pain", "rain", "gain", "main", "maid", "mail", "said", "sold", "gold", "cold", "hold", "told",
  "with", "from", "this", "that", "they", "them", "then", "than", "when", "what", "were", "here", "there", "share",
  "split", "total", "extra", "other", "misc", "money", "bank", "card", "pay", "payment", "refund", "back", "food",
]);

// How many single-letter edits (with swapped neighbours counting as one) turn a into b.
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

export type CategoryGuess = {
  category: string;
  // Set when a word looked misspelled: e.g. { wrong: "Dinnr", right: "Dinner" }.
  suggestion?: { wrong: string; right: string };
};

// Works out the category from an expense name, and spots a likely typo.
export function analyzeName(name: string): CategoryGuess {
  const text = name.trim();
  if (!text) return { category: "other" };

  // 1. Exact words. The earliest one wins; at the same spot the longer one
  //    wins ("room rent" → Bills, not "room" → Stay).
  //    Place words ("market", "mall") only decide when nothing else does:
  //    "Night market dinner" is Food, "Mall" alone is Shopping.
  let best: { category: string; index: number; length: number } | null = null;
  for (const k of [...KEYWORDS.filter((k) => !WEAK.has(k.word)), ...KEYWORDS.filter((k) => WEAK.has(k.word))]) {
    if (best && WEAK.has(k.word)) break;
    const m = k.re.exec(text);
    if (!m) continue;
    const better =
      best === null ||
      m.index < best.index ||
      (m.index === best.index && (m[0].length > best.length || (m[0].length === best.length && ORDER.get(k.category)! < ORDER.get(best.category)!)));
    if (better) best = { category: k.category, index: m.index, length: m[0].length };
  }
  // 2. Words split by a space that belong together ("Air bnb", "Big Basket").
  const wordHits = [...text.matchAll(/[A-Za-z]+/g)];
  const words = wordHits.map((m) => m[0]);
  let joinedCategory: string | null = null;
  for (let i = 0; i < words.length - 1 && !joinedCategory; i++) {
    for (const span of [3, 2]) {
      if (words.length - i < span) continue;
      const joined = words.slice(i, i + span).join("").toLowerCase();
      const hit = KEYWORDS.find((k) => k.word === joined);
      if (hit) {
        joinedCategory = hit.category;
        break;
      }
    }
  }

  // 3. Typos: one wrong, missing, extra or swapped letter (two for long words).
  //    Checked even when another word already decided the category, so the
  //    spelling can still be offered.
  let typo: { category: string; index: number; suggestion: { wrong: string; right: string } } | null = null;
  for (const hit of wordHits) {
    const original = hit[0];
    const w = original.toLowerCase();
    if (w.length < 4 || COMMON.has(w) || KNOWN.has(w) || KNOWN.has(w.replace(/(es|s)$/, ""))) continue;
    const stem = w.replace(/(es|s)$/, "");
    let found: { word: string; category: string; dist: number } | null = null;
    for (const k of FUZZY) {
      const limit = k.word.length >= 8 ? 2 : 1;
      const dist = Math.min(editDistance(w, k.word), stem.length >= 4 ? editDistance(stem, k.word) : 99);
      if (dist <= limit && (found === null || dist < found.dist || (dist === found.dist && k.word.length > found.word.length))) {
        found = { word: k.word, category: k.category, dist };
      }
    }
    if (found) {
      const right = original[0] === original[0].toUpperCase() ? found.word[0].toUpperCase() + found.word.slice(1) : found.word;
      typo = { category: found.category, index: hit.index ?? 0, suggestion: { wrong: original, right } };
      break;
    }
  }

  // A misspelt word that comes before the first exact word decides, as it
  // would have if spelt right ("Dinnr at the market" → Food, not Shopping).
  const typoFirst = typo && best && typo.index < best.index && typo.suggestion.wrong.length >= 5;
  const bestIsWeak = best !== null && WEAK.has(text.slice(best.index, best.index + best.length).toLowerCase().replace(/(es|s)$/, ""));
  const category =
    (typoFirst ? typo!.category : null) ?? (bestIsWeak ? (joinedCategory ?? typo?.category) : null) ?? best?.category ?? joinedCategory ?? typo?.category ?? "other";
  return typo ? { category, suggestion: typo.suggestion } : { category };
}

export function guessCategory(description: string): string {
  return analyzeName(description).category;
}

// Replaces the misspelled word in the name with the suggestion.
export function applySuggestion(name: string, s: { wrong: string; right: string }): string {
  return name.replace(new RegExp(`(?<![A-Za-z])${escape(s.wrong)}(?![A-Za-z])`), s.right);
}

export function getCategory(id: string): Category {
  return BY_ID.get(id) ?? BY_ID.get(LEGACY_CATEGORY_MAP[id] ?? "other")!;
}

export function isCategory(id: string): boolean {
  return BY_ID.has(id);
}

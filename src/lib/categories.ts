// Expense categories. The app guesses one from the expense name
// ("dinner" → Bites & Sips, "uber" → Wheels & Wings: cabs, trains, flights…) and the person can change it.
// It also copes with typos ("dinnr", "petrl", "grocries") and suggests the
// correct spelling. Runs inside the app — no paid AI service.
// To teach it more, add words to the lists below.

export type Category = { id: string; label: string; short: string; emoji: string; words: string[] };

export const CATEGORIES: Category[] = [
  {
    id: "food", label: "Bites & Sips", short: "Bites & Sips", emoji: "🍽️",
    words: ["food", "dinner", "lunch", "breakfast", "brunch", "meal", "restaurant", "dhaba", "cafe", "coffee",
      "tea", "chai", "snack", "pizza", "burger", "biryani", "dosa", "idli", "momo", "thali", "paratha", "maggi",
      "noodle", "sandwich", "dessert", "cake", "pastry", "bakery", "sweet", "ice cream", "icecream", "swiggy",
      "zomato", "uber eats", "eatsure", "faasos", "kfc", "mcdonalds", "dominos", "pizza hut", "starbucks", "haldiram",
      "takeaway", "dine", "dining", "buffet", "barbeque", "barbecue", "bbq", "street food", "pad thai", "pho", "ramen",
      "sushi", "nashta", "khana", "tiffin", "chicken", "mutton", "paneer", "pork", "fish", "seafood", "lassi",
      "drink", "beer", "wine", "whisky", "whiskey", "vodka", "rum", "gin", "tequila", "shot", "cocktail",
      "alcohol", "liquor", "daru", "booze", "bar", "pub", "brewery", "theka", "juice", "smoothie", "soda",
      "supper", "bite", "bites", "eatery", "canteen", "bistro", "diner", "brasserie", "trattoria", "taco", "burrito", "kebab", "kabab", "shawarma", "falafel", "pasta", "salad", "soup", "curry", "chaat", "pani puri", "golgappa", "vada pav", "pav bhaji", "samosa", "pakora", "bhel", "kulfi", "gelato", "waffle", "pancake", "bagel", "croissant", "doughnut", "donut", "fries", "nachos", "steak", "dim sum", "dumpling", "hot pot", "naan", "roti", "tandoori", "subway", "burger king", "taco bell", "chipotle", "dunkin", "costa", "ccd", "cafe coffee day", "chaayos", "third wave", "blue tokai", "barista", "domino", "papa johns", "nandos", "pret", "greggs", "deliveroo", "doordash", "grubhub", "foodpanda", "talabat", "just eat", "drinks", "mocktail", "champagne", "prosecco", "sake", "soju", "toddy", "feni", "hookah", "sheesha", "shisha", "water bottle", "mineral water", "coke", "pepsi", "red bull", "energy drink", "milkshake", "shake", "bubble tea", "boba", "beverage", "refreshment", "eat", "eating", "ate", "feast", "treat", "dinner party", "barbecue night", "food court", "chips", "crisps", "popcorn", "water", "drinking water"],
  },
  {
    id: "transport", label: "Wheels & Wings", short: "Wheels & Wings", emoji: "🚕",
    words: ["uber", "ola", "rapido", "grab", "bolt", "taxi", "cab", "auto", "rickshaw", "tuk tuk", "tuktuk",
      "metro", "bts", "mrt", "bus", "redbus", "train", "irctc", "petrol", "diesel", "fuel", "cng", "ev charging",
      "parking", "toll", "fastag", "ride", "scooty", "scooter", "bike rental", "car rental", "flight", "airline",
      "airport", "air ticket", "airfare", "air fare", "plane", "rail", "railway", "boat", "rental car", "car hire", "indigo", "vistara", "air india", "akasa", "spicejet", "airasia", "ferry", "transfer",
      "travel",
      "fare", "cab fare", "taxi fare", "lyft", "careem", "blablacar", "zoomcar", "revv", "yulu", "bounce", "vogo", "namma yatri", "blusmart", "blu smart", "meru", "savaari", "local train", "sleeper", "tatkal", "vande bharat", "shatabdi", "rajdhani", "volvo", "ksrtc", "msrtc", "apsrtc", "tsrtc", "gsrtc", "hrtc", "greyhound", "flixbus", "megabus", "amtrak", "eurostar", "eurail", "shinkansen", "jr pass", "oyster", "tube", "underground", "tram", "cable car", "ropeway", "gondola", "helicopter", "chopper", "jeep", "car", "bike", "motorbike", "royal enfield", "activa", "gas station", "petrol pump", "charging", "emirates", "qatar airways", "etihad", "lufthansa", "british airways", "american airlines", "southwest", "ryanair", "easyjet", "singapore airlines", "thai airways", "vietjet", "scoot", "jetstar", "baggage", "excess baggage", "car wash", "car service", "puncture", "tyre", "tire", "valet", "commute", "drop", "pickup", "pick up", "airport drop", "airport pickup", "shuttle", "driver fare", "fuel", "gas refill"],
  },
  {
    id: "accommodation", label: "Beds & Bunks", short: "Beds & Bunks", emoji: "🏨",
    words: ["hotel", "airbnb", "hostel", "zostel", "resort", "stay", "room", "oyo", "treebo", "fabhotels", "agoda",
      "booking.com", "goibibo", "homestay", "villa", "lodge", "guesthouse", "guest house", "accommodation", "booking",
      "staying", "overnight", "night stay", "check in", "checkin", "check-in", "checkout", "check out", "room charges", "room service", "suite", "inn", "motel", "b&b", "bnb", "bed and breakfast", "campsite", "camping", "camp", "tent", "glamping", "cottage", "cabin", "chalet", "bungalow", "farmhouse", "farm stay", "farmstay", "haveli", "dharamshala", "dharmshala", "paying guest", "dorm", "dormitory", "bunk", "houseboat", "vrbo", "expedia", "hotels.com", "makemytrip", "mmt", "cleartrip", "easemytrip", "yatra", "trivago", "hostelworld", "taj hotel", "vivanta", "oberoi", "trident", "itc hotel", "leela", "marriott", "jw marriott", "ritz", "sheraton", "westin", "hyatt", "hilton", "conrad", "holiday inn", "crowne plaza", "radisson", "novotel", "ibis", "sofitel", "lemon tree", "ginger hotel", "fortune hotel", "club mahindra", "mahindra resort", "moustache hostel", "the hosteller", "gostops", "zo rooms", "fab hotel", "fabhotel", "lodging", "accomodation", "rooms", "nights", "night"],
  },
  {
    id: "shopping", label: "Bags & Bling", short: "Bags & Bling", emoji: "🛍️",
    words: ["shopping", "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "decathlon", "ikea", "croma",
      "clothes", "shirt", "tshirt", "jeans", "dress", "shoe", "gift", "souvenir", "mall", "market", "electronics",
      "sim card", "sim", "fridge", "refrigerator", "washing machine", "microwave", "mattress", "appliance", "tv", "television", "furniture", "sofa", "curtains",
      "purchase", "bought", "buy", "store", "shop", "boutique", "outlet", "duty free", "dutyfree", "perfume", "cosmetics", "makeup", "jewellery", "jewelry", "sunglasses", "bag", "backpack", "luggage", "suitcase", "trolley bag", "phone case", "charger", "power bank", "headphones", "earphones", "book", "stationery", "toy", "decor", "furniture", "h&m", "zara", "uniqlo", "westside", "pantaloons", "shoppers stop", "tata cliq", "nike", "adidas", "puma", "apple store", "handicraft", "saree", "sari", "kurta", "lehenga", "jacket", "sweater", "hoodie", "cap", "hat", "slippers", "sandals", "sneakers", "umbrella", "raincoat", "sunscreen", "toiletries", "gadget", "phone", "laptop"],
  },
  {
    id: "groceries", label: "Pantry Run", short: "Pantry Run", emoji: "🛒",
    words: ["grocery", "groceries", "vegetable", "veggies", "sabzi", "fruit", "milk", "egg", "bread", "atta", "rice",
      "dal", "kirana", "supermarket", "blinkit", "zepto", "bigbasket", "big basket", "jiomart", "amazon fresh",
      "instamart", "dmart", "reliance fresh", "7-eleven", "7 eleven", "seven eleven",
      "vegetables", "veg", "onion", "tomato", "potato", "aloo", "pyaz", "flour", "oil", "ghee", "sugar", "salt", "masala", "spices", "curd", "dahi", "butter", "cheese", "eggs", "household", "cleaning supplies", "detergent", "soap", "shampoo", "toothpaste", "tissue", "toilet paper", "dishwash", "harpic", "natures basket", "more supermarket", "spencers", "star bazaar", "ratnadeep", "walmart", "costco", "tesco", "sainsbury", "aldi", "lidl", "whole foods", "trader joe", "kroger", "safeway", "coles", "woolworths", "fairprice", "lulu", "carrefour", "provisions", "ration", "general store", "swiggy instamart", "dunzo", "bb daily", "milkbasket", "country delight", "water can", "bisleri", "grocery run"],
  },
  {
    id: "activities", label: "Thrills & Tickets", short: "Thrills & Tickets", emoji: "🎟️",
    words: ["ticket", "entry", "entrance", "museum", "temple", "palace", "fort", "park", "zoo", "beach", "tour",
      "trip", "sightseeing", "boat", "cruise", "trek", "snorkel", "snorkeling", "diving", "scuba", "rafting",
      "paragliding", "go karting", "gokarting", "adventure", "spa", "massage", "show", "movie", "cinema", "film",
      "pvr", "inox", "bookmyshow", "book my show", "concert", "party", "club", "bowling", "game", "gaming", "event",
      "cover charge", "activity", "excursion", "safari", "guide", "poker", "buy-in", "buy in", "buyin", "teen patti", "casino",
      "entry fee", "entry ticket", "admission", "day pass", "theme park", "water park", "amusement park", "wonderla", "imagica", "disney", "universal studios", "legoland", "aquarium", "gallery", "exhibition", "monument", "taj mahal", "heritage", "tour guide", "boat ride", "jet ski", "banana ride", "parasailing", "bungee", "zipline", "zip line", "skydiving", "hot air balloon", "camel ride", "elephant ride", "horse ride", "ski", "skiing", "snowboard", "surfing", "kayak", "kayaking", "canoe", "hiking", "hike", "climbing", "yoga class", "workshop", "lesson", "match", "stadium", "ipl", "cricket", "football", "golf", "casino", "karaoke", "escape room", "arcade", "laser tag", "paintball", "nightclub", "festival", "fest", "gig", "standup", "stand-up", "comedy", "theatre", "theater", "opera", "photoshoot", "sauna", "sightseeing tour", "city tour", "safari jeep"],
  },
  {
    id: "bills", label: "Bills & Bits", short: "Bills & Bits", emoji: "💡",
    words: ["rent", "room rent", "house rent", "flat rent", "electricity", "electric", "light bill", "water bill", "tanker", "water tanker", "water can", "travel insurance", "plumber", "electrician", "carpenter", "repair",
      "gas bill", "gas", "lpg", "cylinder", "wifi", "internet", "broadband", "recharge", "jio", "airtel", "dth",
      "phone bill", "mobile bill", "maintenance", "society", "maid", "cook", "laundry", "dry clean", "ironing",
      "subscription", "netflix", "prime", "spotify", "hotstar", "youtube premium", "emi", "insurance", "bill",
      "utilities", "visa",
      "electricity bill", "power bill", "bescom", "msedcl", "tata power", "adani electricity", "torrent power", "bses", "piped gas", "mgl", "igl", "postpaid", "prepaid", "mobile recharge", "data pack", "vodafone", "bsnl", "act fibernet", "hathway", "excitel", "tata play", "dish tv", "deposit", "security deposit", "brokerage", "society maintenance", "property tax", "municipal", "water tax", "house help", "driver salary", "nanny", "cleaner", "cleaning service", "urban company", "urbanclap", "plumber", "electrician", "carpenter", "repair", "servicing", "pest control", "dry cleaning", "laundromat", "gym", "membership", "fees", "school fees", "tuition", "doctor", "medicine", "medicines", "pharmacy", "chemist", "hospital", "clinic", "medical", "apollo", "1mg", "pharmeasy", "dentist", "health insurance", "premium", "loan", "credit card bill", "tax", "gst", "challan", "penalty", "bank charges", "convenience fee", "visa fee", "passport fee", "courier", "postage", "water bill"],
  },
  { id: "other", label: "Odds & Ends", short: "Odds & Ends", emoji: "📦", words: [] },
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
    // also "staying", "rented", "booked" for words of 4+ letters
    re: new RegExp(`(?<![a-z0-9])${escape(word)}(?:s|es${word.length >= 4 && /[a-z]$/.test(word) ? "|ing|ed|d" : ""})?(?![a-z0-9])`, "i"),
  })),
);
// Where you were rather than what you bought: these lose to any other word.
// General buying and place words ("buy", "shop", "store", "night") also only decide when nothing else does:
// "Buy groceries" is Pantry Run, "Store" alone is Bags & Bling.
const WEAK = new Set(["market", "mall", "buy", "bought", "purchase", "store", "shop", "night", "nights", "rooms", "drop", "pickup", "pick up", "water", "fees", "car", "bike", "eat", "eating", "ate", "treat", "match", "lesson", "phone"]);

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
  "cash", "cards", "cardz", "data", "paid", "pain", "rain", "gain", "main", "maid", "mail", "said", "sold", "gold", "cold", "hold", "told",
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

// The names before 23 Oct 2026 (in spreadsheets people downloaded), so they still import to the right place.
export const OLD_LABELS: Record<string, string> = {
  "food & drinks": "food", food: "food", transport: "transport", accommodation: "accommodation", stay: "accommodation",
  shopping: "shopping", groceries: "groceries", "activities & tickets": "activities", activities: "activities",
  "bills & utilities": "bills", bills: "bills", other: "other",
};

// Plain words for each category, so searching "food" or "transport" still finds them under the fun names.
export const PLAIN_WORDS: Record<string, string> = {
  food: "food drinks", transport: "transport travel", accommodation: "accommodation stay hotel", shopping: "shopping",
  groceries: "groceries", activities: "activities tickets", bills: "bills utilities", other: "other",
};

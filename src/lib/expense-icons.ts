import { getCategory } from "./categories";

// The little picture next to an expense: from what it says ("Airfare" → ✈️,
// "Train to Agra" → 🚆, "Car rental" → 🚗, "Dinner" → 🍽️), else its
// category's own. A word only counts when it fits the expense's category
// (or the category is "Other"), so a "Flight snacks" filed under Food stays food.
// To teach it more, add words below.

type Rule = { cat: string; icon: string; words: string[] };

const RULES: Rule[] = [
  // Transport
  { cat: "transport", icon: "✈️", words: ["flight", "flights", "airfare", "air fare", "air ticket", "airline", "plane", "indigo", "vistara", "akasa", "spicejet", "air india", "airasia", "emirates", "boarding"] },
  { cat: "transport", icon: "🚆", words: ["train", "irctc", "rail", "railway", "vande bharat", "shatabdi", "rajdhani", "duronto", "sleeper"] },
  { cat: "transport", icon: "🚇", words: ["metro", "subway", "bts", "mrt", "tube", "underground"] },
  { cat: "transport", icon: "🚌", words: ["bus", "redbus", "volvo", "coach", "shuttle"] },
  { cat: "transport", icon: "🚗", words: ["car rental", "rental car", "rent a car", "car hire", "self drive", "self-drive", "zoomcar", "revv", "hertz", "avis"] },
  { cat: "transport", icon: "🛵", words: ["scooty", "scooter", "bike rental", "activa", "moped"] },
  { cat: "transport", icon: "⛽", words: ["petrol", "diesel", "fuel", "cng", "gas station", "ev charging"] },
  { cat: "transport", icon: "🅿️", words: ["parking"] },
  { cat: "transport", icon: "🛣️", words: ["toll", "fastag"] },
  { cat: "transport", icon: "⛴️", words: ["ferry", "boat", "cruise", "longtail", "speedboat", "speed boat"] },
  { cat: "transport", icon: "🛺", words: ["auto", "rickshaw", "tuk tuk", "tuktuk", "tuk-tuk"] },
  // Food & drinks
  { cat: "food", icon: "☕", words: ["coffee", "cafe", "café", "chai", "tea", "starbucks", "latte", "cappuccino"] },
  { cat: "food", icon: "🥐", words: ["breakfast", "brunch", "bakery", "pastry", "croissant"] },
  { cat: "food", icon: "🍕", words: ["pizza", "dominos", "domino's", "pizza hut"] },
  { cat: "food", icon: "🍔", words: ["burger", "mcdonalds", "mcdonald's", "kfc", "fries"] },
  { cat: "food", icon: "🍻", words: ["beer", "beers", "bar", "pub", "brewery", "drinks", "cocktail", "cocktails", "wine", "whisky", "whiskey", "vodka", "rum", "daru", "shots"] },
  { cat: "food", icon: "🍨", words: ["ice cream", "icecream", "dessert", "gelato", "cake", "sweets", "mithai"] },
  { cat: "food", icon: "🍜", words: ["noodles", "ramen", "pho", "pad thai", "maggi"] },
  { cat: "food", icon: "🍣", words: ["sushi"] },
  { cat: "food", icon: "🍛", words: ["biryani", "thali", "curry", "dosa", "idli"] },
  { cat: "food", icon: "🥡", words: ["swiggy", "zomato", "takeaway", "take away", "delivery", "uber eats"] },
  // Stay
  { cat: "accommodation", icon: "🏠", words: ["airbnb", "homestay", "home stay", "villa", "apartment"] },
  { cat: "accommodation", icon: "🛏️", words: ["hostel", "zostel", "dorm"] },
  { cat: "accommodation", icon: "🏖️", words: ["resort", "beach hut"] },
  // Activities
  { cat: "activities", icon: "🎬", words: ["movie", "movies", "cinema", "pvr", "inox", "film"] },
  { cat: "activities", icon: "🎢", words: ["theme park", "water park", "amusement", "wonderla", "imagica"] },
  { cat: "activities", icon: "🤿", words: ["snorkel", "snorkelling", "snorkeling", "diving", "scuba"] },
  { cat: "activities", icon: "🏛️", words: ["museum", "temple", "palace", "fort", "monument", "gallery"] },
  { cat: "activities", icon: "💆", words: ["spa", "massage"] },
  { cat: "activities", icon: "🎤", words: ["concert", "gig", "show", "festival"] },
  { cat: "activities", icon: "🥾", words: ["trek", "trekking", "hike", "hiking", "safari", "rafting"] },
  // Shopping
  { cat: "shopping", icon: "🎁", words: ["gift", "gifts", "present"] },
  { cat: "shopping", icon: "👕", words: ["clothes", "shirt", "tshirt", "t-shirt", "jeans", "dress", "shoes", "myntra"] },
  { cat: "shopping", icon: "📱", words: ["sim", "sim card", "phone", "charger"] },
  // Groceries
  { cat: "groceries", icon: "🥛", words: ["milk", "dairy", "curd", "paneer"] },
  { cat: "groceries", icon: "🥦", words: ["vegetables", "veggies", "sabzi", "sabji"] },
  { cat: "groceries", icon: "🍎", words: ["fruit", "fruits"] },
  // Bills
  { cat: "bills", icon: "⚡", words: ["electricity", "power", "bijli", "electric"] },
  { cat: "bills", icon: "💧", words: ["water", "water bill"] },
  { cat: "bills", icon: "📶", words: ["wifi", "wi-fi", "internet", "broadband", "jio fiber", "airtel"] },
  { cat: "bills", icon: "🔥", words: ["gas", "lpg", "cylinder", "png"] },
  { cat: "bills", icon: "🏠", words: ["rent"] },
  { cat: "bills", icon: "🧹", words: ["maid", "cleaning", "cook", "help"] },
  { cat: "bills", icon: "📺", words: ["netflix", "prime", "hotstar", "ott", "dth", "tata play", "spotify", "youtube"] },
  { cat: "bills", icon: "📱", words: ["mobile", "recharge", "phone bill", "postpaid"] },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPILED = RULES.map((r) => ({ ...r, re: new RegExp(`(?<![\\p{L}\\p{N}])(${r.words.map(esc).join("|")})(?![\\p{L}\\p{N}])`, "iu") }));

export function expenseIcon(title: string, category: string): string {
  const cat = getCategory(category);
  const t = String(title ?? "");
  if (t) for (const r of COMPILED) if ((r.cat === cat.id || cat.id === "other") && r.re.test(t)) return r.icon;
  return cat.emoji;
}

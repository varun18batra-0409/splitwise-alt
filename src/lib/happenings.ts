// What's on where you're going: festivals and big moments that change a trip
// (in a good way, or "book early"). Dates are inclusive: "MM-DD" repeats every
// year, "YYYY-MM-DD" is one year only (moving festivals). Wording says
// "usually" when the exact days change year to year. Only well-known,
// reliable ones; nothing is better than a wrong date.

type Happening = { where: string[]; from: string; to: string; name: string; line: string };

const H: Happening[] = [
  // India
  { where: ["goa"], from: "12-20", to: "12-31", name: "Christmas & New Year in Goa", line: "Goa’s liveliest, busiest week. Book stays and cabs early." },
  { where: ["goa"], from: "2027-02-06", to: "2027-02-09", name: "Goa Carnival", line: "Floats, music and street parties before Lent." },
  { where: ["goa"], from: "11-20", to: "11-28", name: "Film festival week", line: "IFFI, India’s big film festival, is on in Panaji." },
  { where: ["pushkar", "rajasthan"], from: "2026-11-17", to: "2026-11-24", name: "Pushkar Camel Fair", line: "Camels, music and the lake lit up for the full moon." },
  { where: ["varanasi"], from: "2026-11-24", to: "2026-11-24", name: "Dev Deepawali", line: "The ghats are lit with lakhs of diyas tonight." },
  { where: ["IN"], from: "2027-03-21", to: "2027-03-23", name: "Holi", line: "Colours everywhere. Wear clothes you don’t mind losing." },
  { where: ["IN"], from: "2027-10-27", to: "2027-10-30", name: "Diwali", line: "Lights, sweets, fireworks. Trains and flights fill up fast." },
  { where: ["kashmir"], from: "03-25", to: "04-20", name: "Tulip season", line: "Asia’s biggest tulip garden is usually open in Srinagar." },
  { where: ["darjeeling", "sikkim"], from: "10-10", to: "12-15", name: "Clear-sky season", line: "The best chance of Kanchenjunga at sunrise." },
  { where: ["chennai"], from: "12-01", to: "12-31", name: "December music season", line: "Hundreds of Carnatic concerts across the city." },
  { where: ["rishikesh"], from: "03-01", to: "03-07", name: "International Yoga Festival", line: "Classes and evening aarti by the Ganga." },
  { where: ["jaipur"], from: "01-20", to: "01-27", name: "Jaipur Literature Festival", line: "Usually late January. Check the dates; the city gets busy." },
  { where: ["jaisalmer"], from: "02-01", to: "02-28", name: "Desert Festival", line: "Usually held in February. Check this year’s dates." },
  { where: ["alleppey", "kerala"], from: "08-08", to: "08-14", name: "Snake-boat race", line: "The Nehru Trophy race is usually the second Saturday of August." },
  // Asia
  { where: ["TH"], from: "04-13", to: "04-15", name: "Songkran", line: "Thai New Year: the whole country has a water fight. Keep your phone in a pouch." },
  { where: ["TH"], from: "2026-11-24", to: "2026-11-24", name: "Loy Krathong", line: "Floating lanterns and candles on the rivers tonight." },
  { where: ["chiang mai"], from: "2026-11-23", to: "2026-11-25", name: "Yi Peng", line: "Thousands of sky lanterns over Chiang Mai." },
  { where: ["tokyo", "JP"], from: "03-24", to: "04-07", name: "Cherry blossom", line: "Usually peak sakura in Tokyo. Parks are full; go early." },
  { where: ["kyoto", "osaka"], from: "03-26", to: "04-10", name: "Cherry blossom", line: "Usually peak sakura. Temples are busiest at weekends." },
  { where: ["kyoto", "osaka", "tokyo", "JP"], from: "11-15", to: "12-05", name: "Autumn leaves", line: "Maples at their reddest. Temple gardens are lit up at night." },
  { where: ["JP"], from: "04-29", to: "05-05", name: "Golden Week", line: "Japan’s busiest holiday. Book trains and stays early." },
  { where: ["SG", "singapore", "hong kong", "MY", "KR", "hanoi", "ho chi minh city", "da nang", "hoi an", "ha long"], from: "2027-02-05", to: "2027-02-08", name: "Lunar New Year", line: "Festive streets; some shops close for a few days." },
  { where: ["singapore", "SG"], from: "11-15", to: "12-31", name: "Christmas on Orchard Road", line: "The whole street lit up for the season." },
  { where: ["dubai", "abu dhabi", "AE"], from: "12-15", to: "01-28", name: "Dubai Shopping Festival", line: "Usually on now: big sales, night markets and fireworks." },
  { where: ["dubai", "AE"], from: "12-31", to: "12-31", name: "New Year’s Eve", line: "Fireworks at the Burj Khalifa. Get there hours early." },
  { where: ["AE", "dubai", "abu dhabi", "EG", "TR", "MY", "maldives", "MV"], from: "2027-02-08", to: "2027-03-09", name: "Ramadan", line: "Days are quieter and many places open late; iftar evenings are special." },
  // Europe
  { where: ["DE", "AT", "CZ", "prague", "CH", "FR", "paris"], from: "11-25", to: "12-23", name: "Christmas markets", line: "Mulled wine, lights and wooden stalls in every old town." },
  { where: ["DE"], from: "2027-09-18", to: "2027-10-03", name: "Oktoberfest", line: "In Munich. Book a table and a room months ahead." },
  { where: ["edinburgh"], from: "08-06", to: "08-30", name: "Edinburgh Festival Fringe", line: "The world’s biggest arts festival. Rooms sell out early." },
  { where: ["edinburgh"], from: "12-29", to: "01-01", name: "Hogmanay", line: "Scotland’s New Year: street party and fireworks." },
  { where: ["london", "GB"], from: "12-31", to: "12-31", name: "New Year’s Eve", line: "Fireworks over the Thames (ticketed)." },
  { where: ["paris", "FR"], from: "07-14", to: "07-14", name: "Bastille Day", line: "Parade in the morning, fireworks at the Eiffel Tower at night." },
  { where: ["venice"], from: "2027-01-30", to: "2027-02-09", name: "Venice Carnival", line: "Masks and costumes everywhere. The busiest time of year." },
  { where: ["ES"], from: "2027-08-25", to: "2027-08-25", name: "La Tomatina", line: "The tomato fight in Buñol, near Valencia." },
  { where: ["barcelona"], from: "09-20", to: "09-24", name: "La Mercè", line: "Barcelona’s big festival: human towers, fire runs, free concerts." },
  { where: ["IS"], from: "09-01", to: "03-31", name: "Northern lights season", line: "Dark, clear nights give the best chance. Check the aurora forecast." },
  // Americas, Oceania
  { where: ["new york"], from: "2027-11-25", to: "2027-11-25", name: "Thanksgiving parade", line: "Macy’s parade down Central Park West in the morning." },
  { where: ["new york"], from: "12-01", to: "01-06", name: "Holiday lights", line: "The Rockefeller tree, skating and window displays." },
  { where: ["new york"], from: "12-31", to: "12-31", name: "New Year’s Eve", line: "The ball drop in Times Square. Plan for crowds." },
  { where: ["sydney"], from: "12-31", to: "12-31", name: "New Year’s Eve", line: "Fireworks over the Harbour Bridge. Pick a spot early." },
  { where: ["sydney"], from: "05-22", to: "06-13", name: "Vivid Sydney", line: "Usually on now: light shows across the harbour." },
];

const md = (key: string) => key.slice(5);
const inRange = (day: string, from: string, to: string) => {
  if (from.length === 10) return day >= from && day <= to;
  const d = md(day);
  return from <= to ? d >= from && d <= to : d >= from || d <= to; // wraps the new year
};

// What's on during a trip (start..end, "YYYY-MM-DD"), at its stops. At most
// `max`, the ones overlapping the most days first.
export function happeningsFor(stops: { city: string; country: string }[], start: string, end?: string | null, max = 2): { name: string; line: string }[] {
  const keys = new Set(stops.flatMap((s) => [s.city.trim().toLowerCase(), s.country.toUpperCase()]).filter(Boolean));
  const last = end && end >= start ? end : start;
  const days: string[] = [];
  for (let t = Date.parse(`${start}T12:00:00Z`), stop = Date.parse(`${last}T12:00:00Z`); t <= stop && days.length < 31; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const hits = H.filter((h) => h.where.some((w) => keys.has(w)))
    .map((h) => ({ h, n: days.filter((d) => inRange(d, h.from, h.to)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const seen = new Set<string>();
  return hits.filter((x) => (seen.has(x.h.name) ? false : (seen.add(x.h.name), true))).slice(0, max).map((x) => ({ name: x.h.name, line: x.h.line }));
}

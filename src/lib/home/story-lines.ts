// The words on a trip's story slides, picked for the place, the kind of trip and the size of the
// crew, so the stories write themselves. Lines never describe what's in a photo (the photo changes,
// the words wouldn't), only the place, the trip and the people. Pure, so it can be tested.

export type Line = [kicker: string, line: string];

// For places Loopin has photos of (the slot names in places.ts, without "place-").
const PLACE: Record<string, Line[]> = {
  goa: [["Susegad mode", "Life moves slower here. The bill doesn't."], ["Local tip", "Rent the scooty. Wear the helmet."], ["Goa rules", "Fish thali for lunch is not optional"], ["Plot twist", "The beach shack is the fancy dinner"]],
  thailand: [["Sawasdee", "Pad thai count: rising 🍜"], ["Local tip", "7-Eleven toasties at 2am are a rite of passage"], ["Island time", "Ferry tickets, tuk-tuks, repeat"], ["Plot twist", "Someone buys elephant pants. Everyone buys elephant pants"]],
  bali: [["Selamat datang", "Villa with a pool, obviously 🌴"], ["Local tip", "Scooter, sunscreen, Nasi goreng. In that order."], ["Bali belly", "Nobody's ordering the street salad"], ["Plot twist", "The swing photo takes 45 minutes"]],
  dubai: [["Marhaba", "Everything here is the tallest, biggest or shiniest"], ["Local tip", "Metro is cheap. Taxis are not."], ["Desert plans", "Dune bashing first, buffet after"], ["Plot twist", "The mall has a ski slope. Of course it does"]],
  manali: [["Hello hills", "Cold enough for two hoodies 🧣"], ["Local tip", "Old Manali cafés beat Mall Road"], ["Snow check", "Rohtang permits: someone sort it"], ["Plot twist", "Maggi at the top tastes like a five-star meal"]],
  ladakh: [["Julley!", "Altitude: high. Phone signal: low."], ["Local tip", "Day one is for resting. Seriously."], ["Road trip", "Khardung La or bust 🏍️"], ["Plot twist", "Everyone's an amateur photographer now"]],
  kerala: [["Namaskaram", "Backwaters, banana chips, zero rush 🌴"], ["Local tip", "The houseboat lunch is the best meal of the trip"], ["God's own country", "Monsoon or not, it's green"], ["Plot twist", "Someone gets a full Ayurvedic massage and never recovers"]],
  singapore: [["Hello Singapore", "Clean streets, cold air-con, hot food"], ["Local tip", "Hawker centres > fancy restaurants"], ["Rules", "No chewing gum. Yes, really."], ["Plot twist", "Marina Bay at night. Every night."]],
  maldives: [["Island mode", "Water so blue it looks edited"], ["Local tip", "The seaplane is the tour"], ["Packing list", "Swimsuits. More swimsuits."], ["Plot twist", "Nobody checks the time for five days"]],
  vietnam: [["Xin chào", "Pho for breakfast is the right choice 🍜"], ["Local tip", "You'll be a dong millionaire. Spend wisely."], ["Coffee check", "Egg coffee: try it once"], ["Plot twist", "Crossing the road is the adventure sport"]],
  srilanka: [["Ayubowan", "Tea country, beaches, and a train ride for the ages"], ["Local tip", "Kandy to Ella by train. Book early."], ["Food check", "Kottu roti, every night"], ["Plot twist", "Everyone comes home with tea"]],
  japan: [["Konnichiwa", "Bullet trains and convenience-store snacks 🍙"], ["Local tip", "Get a Suica card on day one"], ["Food check", "Ramen counts as three meals"], ["Plot twist", "Vending machines everywhere. Everyone tries all of them"]],
  london: [["Cheers!", "Bring an umbrella. Then bring another."], ["Local tip", "Tap your card on the Tube. No ticket needed."], ["Pub o'clock", "One pint turns into a pub crawl"], ["Plot twist", "Everything costs pounds. Nobody converts."]],
  jaipur: [["Padharo", "Pink City, fort views, chai stops"], ["Local tip", "Bargain at Johari Bazaar. Then bargain again."], ["Food check", "Dal baati churma, extra ghee"], ["Plot twist", "Someone buys a bedsheet they absolutely did not need"]],
  nepal: [["Namaste", "Mountains, momos, monasteries"], ["Local tip", "Thamel for gear, Pokhara for slowing down"], ["Trek talk", "Every step up is a step closer to dal bhat"], ["Plot twist", "Everyone falls in love with the momos"]],
  andaman: [["Island time", "Ferries, beaches and very clear water"], ["Local tip", "Book the Havelock ferry early"], ["Dive in", "Scuba once, talk about it forever"], ["Plot twist", "Phone signal? What phone signal?"]],
  rishikesh: [["Ganga calling", "Rafting by day, aarti by evening"], ["Local tip", "Cafés by the river, open till late"], ["Adventure", "Someone's doing the bungee. Someone's filming."], ["Plot twist", "The quiet trip turns into a camping trip"]],
  newyork: [["Hello NYC", "Walk everywhere. Seriously, everywhere."], ["Local tip", "The subway is faster than any cab"], ["Food check", "A dollar slice is a real meal"], ["Plot twist", "Times Square is louder than you thought"]],
  santorini: [["Yassou", "White walls, blue domes, golden evenings"], ["Local tip", "Oia gets packed by sunset. Go early."], ["Food check", "Gyros on the go, seafood by the water"], ["Plot twist", "Everyone's camera roll triples"]],
  bhutan: [["Kuzuzangpo", "The happiest country, officially"], ["Local tip", "Tiger's Nest: start early, go slow"], ["Food check", "Ema datshi is spicy. Like, really spicy."], ["Plot twist", "Nobody wants to leave"]],
  meghalaya: [["Khublei", "Clouds, waterfalls and living root bridges"], ["Local tip", "Shillong cafés are the warm-up"], ["Rain check", "Pack a raincoat. Pack two."], ["Plot twist", "The 3,000 steps to the root bridge are worth it"]],
  switzerland: [["Grüezi", "Mountains, trains and very good chocolate"], ["Local tip", "The Swiss Travel Pass pays for itself"], ["Food check", "Fondue is a whole evening"], ["Plot twist", "Everything is on time. Including the bill."]],
  ahmedabad: [["Kem cho", "Thepla, dhokla, Manek Chowk at midnight"], ["Local tip", "The old-city heritage walk starts early"], ["Food check", "Gujarati thali, unlimited refills"]],
  alibaug: [["Weekend mode", "Ferry across, flip-flops on"], ["Local tip", "The ro-ro ferry beats the drive"], ["Plot twist", "The weekend somehow becomes three days"]],
  amritsar: [["Sat Sri Akal", "Langar, lassi and Amritsari kulcha"], ["Local tip", "The Golden Temple at dawn is unreal"], ["Food check", "One kulcha is never enough"]],
  chikmagalur: [["Coffee country", "Estates, mist and filter coffee ☕"], ["Local tip", "Mullayanagiri for the sunrise"], ["Plot twist", "Everyone buys coffee to take home"]],
  coorg: [["Scotland of India", "Coffee, mist and homestays"], ["Local tip", "Try the pandi curry"], ["Plot twist", "Nobody wants to drive back"]],
  corbett: [["Jungle time", "Safari at dawn, stories by night"], ["Local tip", "Book the safari zone early"], ["Plot twist", "Everyone swears they saw a tiger"]],
  darjeeling: [["Hello hills", "Toy train, tea gardens, Kanchenjunga"], ["Local tip", "Tiger Hill for sunrise, early alarm"], ["Food check", "Momos and Darjeeling tea, on repeat"]],
  delhi: [["Dilli darshan", "Parathas, monuments and Metro rides"], ["Local tip", "The Metro beats traffic, every time"], ["Food check", "Chandni Chowk on an empty stomach"]],
  gokarna: [["Beach hopping", "Om, Kudle, Half Moon, Paradise"], ["Local tip", "Trek between the beaches"], ["Plot twist", "Goa's quieter cousin steals the show"]],
  hampi: [["Boulder land", "Ruins, rocks and a coracle ride"], ["Local tip", "Rent a cycle, go slow"], ["Plot twist", "Sunset at Hemakuta hill becomes a ritual"]],
  hyderabad: [["Biryani capital", "Charminar, chai and Irani biscuits"], ["Local tip", "Paradise is good. Ask locals for better."], ["Food check", "Haleem season? You're lucky."]],
  jaisalmer: [["Golden city", "Fort, dunes and a camp under the stars"], ["Local tip", "Sam dunes for the camel ride"], ["Plot twist", "Sand in everything. Everything."]],
  kashmir: [["Jannat", "Shikara rides, kahwa and snow peaks"], ["Local tip", "Gulmarg gondola, go early"], ["Food check", "Wazwan is a feast. Pace yourself."]],
  kodaikanal: [["Hill escape", "Lakes, pine forests, homemade chocolate"], ["Local tip", "Cycle around the lake"], ["Plot twist", "Everyone buys too much chocolate"]],
  kolkata: [["Joy Kolkata", "Trams, sweets and adda"], ["Local tip", "Kathi rolls on Park Street"], ["Food check", "Rosogolla vs sandesh: pick a side"]],
  kutch: [["White desert", "Rann Utsav, starry nights, crafts"], ["Local tip", "Full moon nights on the Rann"], ["Plot twist", "Everyone brings home a mirror-work cushion"]],
  lonavala: [["Monsoon mode", "Chikki, pakoras and waterfalls"], ["Local tip", "Tiger Point for the view"], ["Plot twist", "A day trip that ends at midnight"]],
  mahabaleshwar: [["Strawberry season", "Strawberries with cream, cool air"], ["Local tip", "Arthur's Seat for the view"], ["Plot twist", "Everyone comes back with jam"]],
  matheran: [["No cars here", "Toy train, horses, red-earth paths"], ["Local tip", "Walk to the viewpoints"], ["Plot twist", "Silence. It's suspicious."]],
  mumbai: [["Aamchi Mumbai", "Vada pav, local trains, sea face"], ["Local tip", "Marine Drive at night"], ["Food check", "Pav bhaji at Juhu, cutting chai anywhere"]],
  mussoorie: [["Queen of hills", "Mall Road, momos and misty views"], ["Local tip", "Landour for the quiet side"], ["Plot twist", "Everyone needs one more jacket"]],
  mysore: [["Royal city", "The palace lights up on Sundays"], ["Local tip", "Mysore pak from the original shop"], ["Food check", "Masala dosa, extra butter"]],
  nainital: [["Lake town", "Boat rides, Mall Road, cool air"], ["Local tip", "Snow View point by cable car"], ["Plot twist", "Everyone rows the boat in circles"]],
  ooty: [["Nilgiris", "Toy train, tea estates, eucalyptus"], ["Local tip", "Doddabetta for the view"], ["Food check", "Homemade chocolate, by the kilo"]],
  pondicherry: [["Bonjour Pondy", "French streets, cafés and promenade walks"], ["Local tip", "Rent a cycle in White Town"], ["Plot twist", "Everyone takes the same yellow-wall photo"]],
  pune: [["Punekar mode", "Misal, wada and a day at Sinhagad"], ["Local tip", "Sinhagad at sunrise, bhakri after"], ["Food check", "Bun maska at the Irani café"]],
  sikkim: [["Hello mountains", "Monasteries, momos and Tsomgo Lake"], ["Local tip", "Permits for North Sikkim, sorted early"], ["Plot twist", "Everyone says 'I'm moving here'"]],
  udaipur: [["City of lakes", "Palaces, boat rides and rooftop dinners"], ["Local tip", "Ambrai Ghat at sunset"], ["Plot twist", "Every dinner is a rooftop dinner"]],
  varanasi: [["Har Har Mahadev", "Ghats, aarti, kachori breakfast"], ["Local tip", "A boat at dawn on the Ganga"], ["Food check", "Banarasi paan, once"]],
};

// When the place isn't one Loopin knows: by the kind of trip.
const MOOD: Record<"beach" | "hills" | "city" | "any", Line[]> = {
  beach: [["Forecast", "100% chance of flip-flops 🩴"], ["Packing list", "Sunscreen. More sunscreen. A hat you'll lose."], ["Beach rules", "Coconut water counts as hydration"], ["Plot twist", "The beach shack is the fancy dinner"]],
  hills: [["Forecast", "Cold enough for two hoodies 🧣"], ["Packing list", "Warm socks. Maggi. A speaker for the drive."], ["Spotted", "Chai at altitude hits different ☕"], ["Plot twist", "Nobody packed the charger"]],
  city: [["Forecast", "High chance of street food 🌮"], ["Packing list", "Comfy shoes. You'll walk 20,000 steps."], ["After dark", "The city looks better at night. So do the bills."], ["Plot twist", "Someone gets lost. It's always the same someone"]],
  any: [["Forecast", "Good times, with a chance of receipts 🧾"], ["Packing list", "Charger, ID, snacks. In that order."], ["Spotted", "The group chat, already planning outfits"], ["Plot twist", "Loopin keeps the maths. You keep the memories"]],
};

// About the people: two of you, a few, or a whole squad.
function crewLines(people: number): Line[] {
  if (people <= 2) return [["Just you two", "Table for two, every night 💛"], ["Couple goals", "One splits the bill, one picks the place"]];
  if (people <= 4) return [["Small crew", `${people} of you. Perfect car size.`], ["Group decision", "It takes 20 minutes to pick a restaurant"]];
  if (people <= 8) return [["The squad", `${people} of you. Somebody's always late.`], ["Group chat", `${people} opinions on where to eat`]];
  return [["Full house", `${people} of you. That's a lot of receipts.`], ["Headcount", "Count everyone before you leave. Twice."]];
}

// A steady shuffle: the same trip on the same day always gets the same lines, and the next day different ones.
function pick<T>(list: T[], seed: string, n: number): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

// The lines for one trip story: the place's own first, then the kind of trip, then the crew.
export function storyLines(o: { place?: string | null; mood?: "beach" | "hills" | "city" | "any"; people: number; seed: string; n?: number }): Line[] {
  const own = (o.place && PLACE[o.place.replace(/^place-/, "")]) || [];
  const mood = MOOD[o.mood ?? "any"];
  const n = o.n ?? 4;
  // Up to 3 about the place, then the trip's kind, then one about the crew.
  const placeLines = pick(own, o.seed, Math.min(3, own.length));
  const crew = pick(crewLines(o.people), `${o.seed}c`, 1);
  const rest = pick(mood, `${o.seed}m`, Math.max(0, n - placeLines.length - crew.length));
  return [...placeLines, ...rest, ...crew].slice(0, n);
}

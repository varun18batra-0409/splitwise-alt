// The words on a trip's story slides, picked for the place, the kind of trip and the size of the
// crew, so the stories write themselves. Lines never describe what's in a photo (the photo changes,
// the words wouldn't), only the place, the trip and the people. Pure, so it can be tested.

import { climateFor } from "../climate";

export type Line = [kicker: string, line: string];

// For places Loopin has photos of (the slot names in places.ts, without "place-").
const PLACE: Record<string, Line[]> = {
  goa: [
    ["Susegad mode", "Life moves slower here. The bill doesn't."], ["Local tip", "Rent the scooty. Wear the helmet."], ["Goa rules", "Fish thali for lunch is not optional"],
    ["Plot twist", "The beach shack is the fancy dinner"], ["North or south?", "Parties up north, peace down south. Pick a side."], ["Food check", "Prawn curry rice, then a very long nap"],
    ["Sweet tooth", "Bebinca, one layer at a time"], ["Old Goa", "Pastel houses in Fontainhas, made for photos"], ["Fort views", "Sunset from a fort wall beats any rooftop"],
    ["Night market", "You came for nothing. You left with a hat."], ["Day one", "Someone gets sunburnt. It's always day one."], ["Beach hopping", "One more beach, then lunch. Then one more."],
  ],
  thailand: [["Sawasdee", "Pad thai count: rising 🍜"], ["Local tip", "7-Eleven toasties at 2am are a rite of passage"], ["Island time", "Ferry tickets, tuk-tuks, repeat"], ["Plot twist", "Someone buys elephant pants. Everyone buys elephant pants"]],
  bali: [["Selamat datang", "Villa with a pool, obviously 🌴"], ["Local tip", "Scooter, sunscreen, Nasi goreng. In that order."], ["Bali belly", "Nobody's ordering the street salad"], ["Plot twist", "The swing photo takes 45 minutes"]],
  dubai: [["Marhaba", "Everything here is the tallest, biggest or shiniest"], ["Local tip", "Metro is cheap. Taxis are not."], ["Desert plans", "Dune bashing first, buffet after"], ["Plot twist", "The mall has a ski slope. Of course it does"]],
  manali: [["Hello Manali", "Snow on the peaks, chai in hand 🧣"], ["Local tip", "Old Manali cafés beat Mall Road"], ["Snow check", "Rohtang permits: someone sort it"], ["Plot twist", "Maggi at the top tastes like a five-star meal"]],
  ladakh: [["Julley!", "Altitude: high. Phone signal: low."], ["Local tip", "Day one is for resting. Seriously."], ["Road trip", "Khardung La or bust 🏍️"], ["Plot twist", "Everyone's an amateur photographer now"]],
  kerala: [["Namaskaram", "Backwaters, banana chips, zero rush 🌴"], ["Local tip", "The houseboat lunch is the best meal of the trip"], ["God's own country", "Monsoon or not, it's green"], ["Plot twist", "Someone gets a full Ayurvedic massage and never recovers"]],
  singapore: [["Hello Singapore", "Clean streets, cold air-con, hot food"], ["Local tip", "Hawker centres > fancy restaurants"], ["Rules", "Gum's restricted. Yes, really."], ["Plot twist", "Marina Bay at night. Every night."]],
  maldives: [["Island mode", "Water so blue it looks edited"], ["Local tip", "The seaplane is the tour"], ["Packing list", "Swimsuits. More swimsuits."], ["Plot twist", "Nobody checks the time for five days"], ["Snorkel check", "Fish count: too many to count"], ["Reef rules", "Reef-safe sunscreen, look don't touch"]],
  vietnam: [["Xin chào", "Pho for breakfast is the right choice 🍜"], ["Local tip", "You'll be a dong millionaire. Spend wisely."], ["Coffee check", "Egg coffee: try it once"], ["Plot twist", "Crossing the road is the adventure sport"]],
  srilanka: [["Ayubowan", "Tea country, beaches, and a train ride for the ages"], ["Local tip", "Kandy to Ella by train. Book early."], ["Food check", "Hoppers for breakfast, kottu for dinner"], ["Plot twist", "Everyone comes home with tea"]],
  japan: [["Konnichiwa", "Bullet trains and convenience-store snacks 🍙"], ["Local tip", "Get a Suica card on day one"], ["Food check", "Ramen counts as three meals"], ["Plot twist", "Vending machines everywhere. Everyone tries all of them"]],
  london: [["Cheers!", "Bring an umbrella. Then bring another."], ["Local tip", "Tap your card on the Tube. No ticket needed."], ["Pub o'clock", "One pint turns into a pub crawl"], ["Plot twist", "Everything costs pounds. Nobody converts."]],
  jaipur: [["Padharo", "Pink City, fort views, chai stops"], ["Local tip", "Bargain at Johari Bazaar. Then bargain again."], ["Food check", "Dal baati churma, extra ghee"], ["Plot twist", "Someone buys a bedsheet they absolutely did not need"]],
  nepal: [["Namaste", "Mountains, momos, monasteries"], ["Local tip", "Thamel for gear, Pokhara for slowing down"], ["Trek talk", "Every step up is a step closer to dal bhat"], ["Plot twist", "Everyone falls in love with the momos"]],
  andaman: [["Island life", "Ferries, beaches and very clear water"], ["Local tip", "Book the Havelock ferry early"], ["Dive in", "Scuba once, talk about it forever"], ["Plot twist", "Phone signal? What phone signal?"], ["Sunset spot", "Radhanagar at sunset, worth the wait"], ["Food check", "Fresh fish, grilled your way"]],
  rishikesh: [["Ganga calling", "Rafting by day, aarti by evening"], ["Local tip", "Cafés by the river, open till late"], ["Adventure", "Someone's doing the bungee. Someone's filming."], ["Plot twist", "The quiet trip turns into a camping trip"]],
  newyork: [["Hello NYC", "Walk everywhere. Seriously, everywhere."], ["Local tip", "The subway is faster than any cab"], ["Food check", "A dollar slice is a real meal"], ["Plot twist", "Times Square is louder than you thought"]],
  santorini: [["Yassou", "White walls, blue domes, golden evenings"], ["Local tip", "Oia gets packed by sunset. Go early."], ["Food check", "Gyros on the go, seafood by the water"], ["Plot twist", "Everyone's camera roll triples"]],
  bhutan: [["Kuzuzangpo", "A country that measures happiness, officially"], ["Local tip", "Tiger's Nest: start early, go slow"], ["Food check", "Ema datshi is spicy. Like, really spicy."], ["Plot twist", "Nobody wants to leave"]],
  meghalaya: [["Khublei", "Clouds, waterfalls and living root bridges"], ["Local tip", "Shillong cafés are the warm-up"], ["Rain check", "Pack a raincoat. Pack two."], ["Plot twist", "The 3,000 steps to the root bridge are worth it"]],
  switzerland: [["Grüezi", "Mountains, trains and very good chocolate"], ["Local tip", "The Swiss Travel Pass can pay for itself"], ["Food check", "Raclette, fondue, repeat"], ["Plot twist", "Everything is on time. Including the bill."]],
  ahmedabad: [["Kem cho", "Thepla, dhokla, Manek Chowk at midnight"], ["Local tip", "The old-city heritage walk starts early"], ["Food check", "Gujarati thali, unlimited refills"]],
  alibaug: [["Weekend mode", "Ferry across, chappals on"], ["Local tip", "The ro-ro ferry beats the drive"], ["Plot twist", "The weekend somehow becomes three days"], ["Food check", "Fresh catch, Konkan style"], ["Low tide", "Walk out to Kolaba fort when the sea lets you"]],
  amritsar: [["Sat Sri Akal", "Langar, lassi and Amritsari kulcha"], ["Local tip", "The Golden Temple at dawn is unreal"], ["Food check", "One kulcha is never enough"]],
  chikmagalur: [["Coffee country", "Estates, mist and filter coffee ☕"], ["Local tip", "Mullayanagiri for the sunrise"], ["Plot twist", "Everyone buys coffee to take home"]],
  coorg: [["Scotland of India", "Coffee, mist and homestays"], ["Local tip", "Try the pandi curry"], ["Plot twist", "Nobody wants to drive back"]],
  corbett: [["Jungle time", "Safari at dawn, stories by night"], ["Local tip", "Book the safari zone early"], ["Plot twist", "Everyone swears they saw a tiger"]],
  darjeeling: [["Hello hills", "Toy train, tea gardens, Kanchenjunga"], ["Local tip", "Tiger Hill for sunrise, early alarm"], ["Food check", "Momos and Darjeeling tea, on repeat"]],
  delhi: [["Dilli darshan", "Parathas, monuments and Metro rides"], ["Local tip", "The Metro beats traffic, every time"], ["Food check", "Chandni Chowk on an empty stomach"]],
  gokarna: [["Beach trail", "Om, Kudle, Half Moon, Paradise"], ["Local tip", "Trek between the beaches"], ["Plot twist", "Goa's quieter cousin steals the show"], ["Temple town", "Temple in the morning, beach by noon"], ["Food check", "Thali at a beach café, banana pancakes after"]],
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
  pondicherry: [["Bonjour Pondy", "French streets, cafés and promenade walks"], ["Local tip", "Rent a cycle in White Town"], ["Plot twist", "Everyone takes the same yellow-wall photo"], ["Food check", "Croissant for breakfast, fish curry for dinner"], ["Early start", "Rock Beach at sunrise, before the heat"]],
  pune: [["Punekar mode", "Misal, wada and a day at Sinhagad"], ["Local tip", "Sinhagad at sunrise, bhakri after"], ["Food check", "Bun maska at the Irani café"]],
  sikkim: [["Hello mountains", "Monasteries, momos and Tsomgo Lake"], ["Local tip", "Permits for North Sikkim, sorted early"], ["Plot twist", "Everyone says 'I'm moving here'"]],
  udaipur: [["City of lakes", "Palaces, boat rides and rooftop dinners"], ["Local tip", "Ambrai Ghat at sunset"], ["Plot twist", "Every dinner is a rooftop dinner"]],
  varanasi: [["Har Har Mahadev", "Ghats, aarti, kachori breakfast"], ["Local tip", "A boat at dawn on the Ganga"], ["Food check", "Banarasi paan, once"]],
};


// For any country in the world: a hello, the local money and one local thing to try, for the places
// people travel to most. Every other country still gets lines built from its name and flag.
const FLAVOUR: Record<string, { hi: string; money: string; thing?: string }> = {
  TH: { hi: "Sawasdee", money: "baht", thing: "Mango sticky rice, at least once a day" },
  ID: { hi: "Selamat pagi", money: "rupiah", thing: "Nasi goreng for breakfast, lunch or both" },
  VN: { hi: "Xin chào", money: "dong", thing: "Banh mi from a street cart" },
  MY: { hi: "Selamat datang", money: "ringgit", thing: "Nasi lemak and teh tarik" },
  SG: { hi: "Hello lah", money: "Singapore dollars", thing: "Chilli crab, then a hawker centre" },
  JP: { hi: "Konnichiwa", money: "yen", thing: "Konbini snacks count as a meal" },
  KR: { hi: "Annyeong", money: "won", thing: "Korean BBQ, then karaoke" },
  CN: { hi: "Nǐ hǎo", money: "yuan", thing: "Dumplings, as many as you can carry" },
  HK: { hi: "Neih hou", money: "Hong Kong dollars", thing: "Dim sum for breakfast" },
  TW: { hi: "Nǐ hǎo", money: "Taiwan dollars", thing: "Night market bubble tea" },
  PH: { hi: "Kumusta", money: "pesos", thing: "Mango shake by the beach" },
  LK: { hi: "Ayubowan", money: "rupees", thing: "Kottu roti, every night" },
  NP: { hi: "Namaste", money: "Nepali rupees", thing: "Momos, obviously" },
  BT: { hi: "Kuzuzangpo", money: "ngultrum", thing: "Ema datshi, if you like it hot" },
  MV: { hi: "Assalaamu alaikum", money: "rufiyaa", thing: "Fresh tuna, every way" },
  AE: { hi: "Marhaba", money: "dirhams", thing: "Shawarma at midnight" },
  QA: { hi: "Marhaba", money: "riyals", thing: "Souq Waqif after dark" },
  OM: { hi: "Marhaba", money: "rials", thing: "Shuwa and Omani halwa" },
  SA: { hi: "Marhaba", money: "riyals", thing: "Kabsa with the whole crew" },
  BH: { hi: "Marhaba", money: "dinars", thing: "Machboos and karak chai" },
  TR: { hi: "Merhaba", money: "lira", thing: "Turkish breakfast takes two hours" },
  EG: { hi: "Ahlan", money: "Egyptian pounds", thing: "Koshari, the national comfort food" },
  GB: { hi: "Cheers", money: "pounds", thing: "A Sunday roast, then a pub" },
  IE: { hi: "Dia duit", money: "euros", thing: "A pint and live music" },
  FR: { hi: "Bonjour", money: "euros", thing: "Croissant first, questions later" },
  IT: { hi: "Ciao", money: "euros", thing: "Gelato counts as lunch" },
  ES: { hi: "Hola", money: "euros", thing: "Tapas crawl, dinner at 10pm" },
  PT: { hi: "Olá", money: "euros", thing: "Pastel de nata, warm" },
  DE: { hi: "Hallo", money: "euros", thing: "Pretzels and a beer garden" },
  NL: { hi: "Hallo", money: "euros", thing: "Stroopwafels and a bike ride" },
  CH: { hi: "Grüezi", money: "Swiss francs", thing: "Fondue is a whole evening" },
  AT: { hi: "Servus", money: "euros", thing: "Apfelstrudel and coffee" },
  GR: { hi: "Yassou", money: "euros", thing: "Gyros on the go" },
  CZ: { hi: "Ahoj", money: "koruna", thing: "Trdelník in the old town" },
  HU: { hi: "Szia", money: "forint", thing: "Langos and the thermal baths" },
  PL: { hi: "Cześć", money: "złoty", thing: "Pierogi, every filling" },
  HR: { hi: "Bok", money: "euros", thing: "Seafood by the Adriatic" },
  IS: { hi: "Halló", money: "Icelandic krónur", thing: "Hot dogs and hot springs" },
  NO: { hi: "Hei", money: "Norwegian kroner", thing: "Fjord views, waffles after" },
  SE: { hi: "Hej", money: "Swedish kronor", thing: "Fika: coffee and a cinnamon bun" },
  DK: { hi: "Hej", money: "Danish kroner", thing: "Smørrebrød and a canal walk" },
  FI: { hi: "Moi", money: "euros", thing: "Sauna, then a cold dip" },
  US: { hi: "Hey there", money: "dollars", thing: "A diner breakfast, bottomless coffee" },
  CA: { hi: "Hello, eh", money: "Canadian dollars", thing: "Poutine, no regrets" },
  MX: { hi: "Hola", money: "pesos", thing: "Tacos al pastor from a street stand" },
  BR: { hi: "Olá", money: "reais", thing: "Açaí bowls and a beach day" },
  AR: { hi: "Hola", money: "pesos", thing: "Steak and Malbec" },
  PE: { hi: "Hola", money: "soles", thing: "Ceviche, as fresh as it gets" },
  AU: { hi: "G'day", money: "Australian dollars", thing: "Flat white and a beach walk" },
  NZ: { hi: "Kia ora", money: "NZ dollars", thing: "Fish and chips by the water" },
  ZA: { hi: "Howzit", money: "rand", thing: "A braai, if you're invited" },
  KE: { hi: "Jambo", money: "Kenyan shillings", thing: "Safari at sunrise" },
  TZ: { hi: "Jambo", money: "Tanzanian shillings", thing: "Zanzibar spice tour" },
  MA: { hi: "Salam", money: "dirhams", thing: "Mint tea in the medina" },
  MU: { hi: "Bonzour", money: "Mauritian rupees", thing: "Dholl puri on the go" },
  KH: { hi: "Suostei", money: "riel (and dollars)", thing: "Fish amok and Angkor at dawn" },
  LA: { hi: "Sabaidee", money: "kip", thing: "Slow boat down the Mekong" },
  MM: { hi: "Mingalaba", money: "kyat", thing: "Tea-shop breakfast" },
  KZ: { hi: "Sálem", money: "tenge", thing: "Mountains just outside the city" },
  GE: { hi: "Gamarjoba", money: "lari", thing: "Khachapuri, the cheesy boat" },
  AZ: { hi: "Salam", money: "manat", thing: "Tea with jam in the old city" },
  RU: { hi: "Privet", money: "roubles", thing: "Blini with everything" },
  BE: { hi: "Hallo", money: "euros", thing: "Waffles, fries and chocolate. In any order." },
  LU: { hi: "Moien", money: "euros" },
  MC: { hi: "Bonjour", money: "euros", thing: "People-watching by the harbour" },
  MT: { hi: "Merħba", money: "euros", thing: "Pastizzi, warm from the oven" },
  CY: { hi: "Yassou", money: "euros", thing: "Halloumi, grilled, everywhere" },
  SI: { hi: "Živjo", money: "euros", thing: "Lake Bled cream cake" },
  SK: { hi: "Ahoj", money: "euros" },
  EE: { hi: "Tere", money: "euros", thing: "A walk through Tallinn's old town" },
  LV: { hi: "Sveiki", money: "euros" },
  LT: { hi: "Labas", money: "euros" },
  RO: { hi: "Bună", money: "lei", thing: "Sarmale and a castle visit" },
  BG: { hi: "Zdravei", money: "euros", thing: "Banitsa for breakfast" },
  RS: { hi: "Zdravo", money: "dinars", thing: "Ćevapi and a late night out" },
  ME: { hi: "Zdravo", money: "euros", thing: "The Bay of Kotor at golden hour" },
  AL: { hi: "Përshëndetje", money: "lek", thing: "Byrek and the Riviera" },
  JO: { hi: "Marhaba", money: "dinars", thing: "Petra at dawn, mansaf after" },
  IL: { hi: "Shalom", money: "shekels", thing: "Hummus, still warm" },
  LB: { hi: "Marhaba", money: "Lebanese pounds", thing: "Mezze that never ends" },
  PK: { hi: "Assalam o alaikum", money: "rupees", thing: "Karahi, straight from the pan" },
  BD: { hi: "Nomoskar", money: "taka", thing: "Hilsa, if it's the season" },
  UZ: { hi: "Salom", money: "som", thing: "Plov from the big pot" },
  MN: { hi: "Sain baina uu", money: "tögrög", thing: "A night in a ger" },
  NG: { hi: "Hello", money: "naira", thing: "Jollof rice. Pick a side." },
  GH: { hi: "Akwaaba", money: "cedis", thing: "Jollof and kelewele" },
  ET: { hi: "Selam", money: "birr", thing: "A coffee ceremony" },
  RW: { hi: "Muraho", money: "Rwandan francs", thing: "Gorilla trek, if you're lucky" },
  UG: { hi: "Oli otya", money: "Ugandan shillings", thing: "A rolex. The street-food kind." },
  SC: { hi: "Bonzour", money: "Seychelles rupees", thing: "Creole curry by the sea" },
  CU: { hi: "Hola", money: "pesos", thing: "Old cars and live son music" },
  CO: { hi: "Hola", money: "pesos", thing: "Arepas and very good coffee" },
  CL: { hi: "Hola", money: "pesos", thing: "Empanadas and a glass of red" },
  EC: { hi: "Hola", money: "dollars", thing: "The Galápagos, if you can" },
  CR: { hi: "Pura vida", money: "colones", thing: "Gallo pinto for breakfast" },
  PA: { hi: "Hola", money: "balboas (and dollars)", thing: "Watch a ship cross the canal" },
  DO: { hi: "Hola", money: "pesos", thing: "Beach, bachata, repeat" },
  JM: { hi: "Wah gwaan", money: "Jamaican dollars", thing: "Jerk chicken by the beach" },
  FJ: { hi: "Bula", money: "Fijian dollars", thing: "Kava with the locals" },
  CK: { hi: "Kia orana", money: "NZ dollars" },
  PF: { hi: "Ia ora na", money: "francs", thing: "Overwater everything" },
  IN: { hi: "Namaste", money: "rupees", thing: "Chai at every stop" },
};

// Lines for any country (and its city, when Loopin knows it), built from its name, flag and flavour.
// `home` is the viewer's own country: "a new stamp", "learn the word" and "carry local money" are for trips abroad only, so they are left
// out at home, and when the viewer's home isn't known (nothing is guessed, and never India).
function worldLines(country?: string | null, city?: string | null, countryName?: string | null, flag?: string | null, home?: string | null): Line[] {
  const out: Line[] = [];
  const cc = (country ?? "").toUpperCase();
  const f = cc ? FLAVOUR[cc] : undefined;
  const name = countryName ?? "";
  const abroad = Boolean(home) && Boolean(cc) && cc !== home!.toUpperCase();
  if (city) out.push(["City mode", `${city} by day, ${city} by night`], ["Explore", `Get a little lost in ${city}. On purpose.`]);
  if (name && abroad) out.push(["New stamp", `${name} ${flag ?? ""}: one more for the passport`.trim()]);
  if (f) {
    if (abroad) out.push(["Say it", `Learn one word: “${f.hi}”`], ["Local tip", `Carry a little ${f.money} for the small stuff`]);
    if (f.thing) out.push(["Food check", f.thing]);
  } else if (name) {
    out.push(["Food check", `Eat where the locals eat in ${name}`]);
    if (abroad) out.push(["Local tip", "Carry a little local cash for the small stuff"]);
  }
  return out;
}

// When the place isn't one Loopin knows: by the kind of trip.
const MOOD: Record<"beach" | "hills" | "city" | "any", Line[]> = {
  beach: [
    ["Forecast", "100% chance of flip‑flops 🩴"], ["Packing list", "Sunscreen. More sunscreen. A hat you'll lose."], ["Beach rules", "Last one in the water buys the coconuts"],
    ["Plot twist", "The sand comes home with you"], ["Dress code", "Shorts at breakfast, shorts at dinner"], ["Snack check", "Roasted corn by the water"],
    ["Tide check", "Move the towels before the wave does"], ["Beach day", "Find shade early. Defend it all day."], ["Swim check", "Someone swears the water isn't cold"],
    ["Slow day", "The only plan is no plan"],
  ],
  hills: [["Forecast", "Two hoodies, minimum 🧣"], ["Packing list", "Warm socks. Maggi. A speaker for the drive."], ["Spotted", "Chai at altitude hits different ☕"], ["Plot twist", "Nobody packed the charger"]],
  city: [["Forecast", "High chance of street food 🌮"], ["Packing list", "Comfy shoes. You'll walk 20,000 steps."], ["After dark", "The city looks better at night. So do the bills."], ["Plot twist", "Someone gets lost. It's always the same someone"]],
  any: [["Forecast", "Good times, with a chance of receipts 🧾"], ["Packing list", "Charger, ID, snacks. In that order."], ["Spotted", "The group chat, already planning outfits"], ["Plot twist", "Loopin keeps the maths. You keep the memories"]],
};

// About the time of year: monsoon where there's a monsoon, and winter or summer by hemisphere. Nothing is said when the place is
// unknown (never India by default), for tropical places and beach trips (they have no "layers" winter), and not the rain line for the
// high, dry mountains (Ladakh, Spiti) or in the wrong months (Chennai's rain is October to December).
const MONSOON = new Set(["IN", "LK", "BD", "NP", "TH", "VN", "KH", "LA", "MM", "PH"]);
const SOUTH = new Set(["AU", "NZ", "ZA", "AR", "BR", "CL", "UY", "PY", "FJ", "MU", "SC", "MG", "NA", "BW", "PE", "BO"]);
const TROPICAL = new Set(["TH", "ID", "SG", "MV", "MY", "LK", "PH", "KH", "LA", "VN", "SC", "MU", "FJ", "JM", "DO", "CU", "CR", "PA", "PF", "BD", "BN", "CK", "EC", "CO", "BS", "BB", "KY"]);
const DRY_HIGH = /\b(ladakh|leh|zanskar|nubra|pangong|spiti|kargil)\b/i;
const OCT_DEC_RAIN = /\b(chennai|madras|pondicherry|puducherry|pondy|mahabalipuram|rameswaram|tamil nadu)\b/i;
function seasonLines(month?: number | null, country?: string | null, o: { city?: string | null; text?: string | null; mood?: string | null } = {}): Line[] {
  const cc = (country ?? "").toUpperCase();
  if (month == null || month < 0 || month > 11 || !cc) return [];
  const where = `${o.city ?? ""} ${o.text ?? ""}`;
  if (MONSOON.has(cc) && !DRY_HIGH.test(where)) {
    const [from, to] = OCT_DEC_RAIN.test(where) ? [9, 11] : [5, 8];
    if (month >= from && month <= to) return [["Monsoon mode", "Pack a raincoat. And a backup raincoat."], ["Rain check", "Everything's greener in the rain"]];
  }
  // Warm all year (a hot day and a warm night): "winter" and "autumn" lines would be wrong.
  const w = climateFor(o.city ?? "", cc, month);
  const warm = Boolean(w && w.hi >= 26 && w.lo >= 15);
  if (o.mood === "beach" || TROPICAL.has(cc) || warm) return [];
  const m = SOUTH.has(cc) ? (month + 6) % 12 : month; // flip the seasons south of the equator
  if (m === 11 || m <= 1) return [["Winter trip", "Layers, layers, layers"], ["Cosy season", "Hot drinks, warm jackets, early nights (not)"]];
  if (m >= 2 && m <= 4) return [["Spring trip", "Perfect weather, no excuses"], ["Fresh season", "Long days, light bags"]];
  if (m >= 5 && m <= 7) return [["Summer trip", "Sunscreen is a personality now"], ["Long days", "The sun sets late. So do you."]];
  return [["Autumn trip", "Sweater weather and golden light"], ["Shoulder season", "Fewer crowds, better deals"]];
}

// About the people: just you, two of you, a few, or a whole squad.
// The two-person lines are for a couple's group only; two colleagues or two friends get words that fit anyone.
function crewLines(people: number, couple = false): Line[] {
  if (people <= 1) return [["Solo mode", "Your pace, your plan, your playlist"], ["Table for one", "Eat where you like, for as long as you like"]];
  if (people <= 2) return couple ? [["Just you two", "Table for two, every night 💛"], ["Couple goals", "One splits the bill, one picks the place"]] : [["Just you two", "Easy to plan, easy to split"], ["Two of you", "One picks the place, one picks the playlist"]];
  if (people <= 4) return [["Small crew", `${people} of you. Perfect car size.`], ["Group decision", "It takes 20 minutes to pick a restaurant"]];
  if (people <= 8) return [["The squad", `${people} of you. Somebody's always late.`], ["Group chat", `${people} opinions on where to eat`]];
  return [["Full house", `${people} of you. That's a lot of receipts.`], ["Headcount", "Count everyone before you leave. Twice."]];
}

// A number from a word (the trip's id), so each trip gets its own steady order of lines.
export function seedNum(seed: string): number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// A steady shuffle: the same seed always gives the same order.
function pick<T>(list: T[], seed: string, n: number): T[] {
  let h = seedNum(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

// Lines that take turns: each trip shuffles a list once, then each day moves on by `step` (how many of them a day's story shows), so a
// line only comes back once the whole list has been shown (22 Nov: the Goa story showed the same few lines every day). Lines already
// on screen (`skip`) are passed over.
export function rotate(list: Line[], seed: string, day: number, k: number, skip: Set<string>, step = k): Line[] {
  if (!list.length || k <= 0) return [];
  const order = pick(list, seed, list.length);
  const start = (((day * step) % order.length) + order.length) % order.length;
  const out: Line[] = [];
  for (let i = 0; i < order.length && out.length < k; i++) {
    const l = order[(start + i) % order.length];
    if (!skip.has(l[1])) out.push(l);
  }
  return out;
}

// Every list of lines, for the tests (no line may be in two lists, so two trips never share words).
export const STORY_POOLS = { PLACE, MOOD, FLAVOUR, seasonLines, crewLines, worldLines };

// Which hand-written place lines fit a trip: only when the trip names that exact place (or, for a country's own lines, a place in that
// country). A neighbour (Shimla for Manali, Jodhpur for Jaipur) gets the generic city and country lines instead.
const EXACT_NAMES: Record<string, RegExp> = {
  goa: /\b(goa|baga|calangute|anjuna|palolem)\b/i, thailand: /\b(thailand|thai)\b/i, bali: /\b(bali|ubud|seminyak|nusa)\b/i, dubai: /\bdubai\b/i,
  manali: /\bmanali\b/i, ladakh: /\b(ladakh|leh|zanskar|pangong|nubra)\b/i,
  kerala: /\b(kerala|alleppey|alappuzha|munnar|kochi|cochin|varkala|wayanad|kumarakom|thiruvananthapuram|trivandrum|kovalam|kozhikode|calicut|thrissur)\b/i,
  singapore: /\bsingapore\b/i, maldives: /\bmaldives\b/i, vietnam: /\b(vietnam|hanoi|ha ?long|da ?nang|saigon|ho chi minh|hoi ?an)\b/i, srilanka: /\b(sri ?lanka|colombo|kandy|galle|ceylon)\b/i,
  japan: /\b(japan|tokyo|kyoto|osaka|hokkaido)\b/i, london: /\blondon\b/i, jaipur: /\bjaipur\b/i, nepal: /\b(nepal|kathmandu|pokhara)\b/i,
  andaman: /\b(andaman|havelock|port ?blair|neil island)\b/i, rishikesh: /\brishikesh\b/i, newyork: /\b(new ?york|nyc|manhattan|brooklyn)\b/i, santorini: /\bsantorini\b/i,
  bhutan: /\b(bhutan|thimphu|paro|punakha)\b/i, meghalaya: /\b(meghalaya|shillong|cherrapunji|dawki)\b/i, switzerland: /\b(switzerland|swiss|zurich|interlaken|zermatt|lucerne)\b/i,
  ahmedabad: /\bahmedabad\b/i, alibaug: /\b(alibaug|alibag)\b/i, amritsar: /\b(amritsar|golden temple)\b/i, chikmagalur: /\b(chikmagalur|chikkamagaluru)\b/i,
  coorg: /\b(coorg|kodagu|madikeri)\b/i, corbett: /\b(corbett|jim corbett)\b/i, darjeeling: /\bdarjeeling\b/i, delhi: /\b(delhi|new delhi)\b/i, gokarna: /\b(gokarna|gokarn)\b/i,
  hampi: /\bhampi\b/i, hyderabad: /\b(hyderabad|secunderabad)\b/i, jaisalmer: /\bjaisalmer\b/i, kashmir: /\b(kashmir|srinagar|gulmarg|pahalgam|sonmarg)\b/i,
  kodaikanal: /\b(kodaikanal|kodai)\b/i, kolkata: /\b(kolkata|calcutta)\b/i, kutch: /\b(kutch|kachchh|rann)\b/i, lonavala: /\b(lonavala|lonavla|khandala)\b/i,
  mahabaleshwar: /\bmahabaleshwar\b/i, matheran: /\bmatheran\b/i, mumbai: /\b(mumbai|bombay)\b/i, mussoorie: /\b(mussoorie|landour)\b/i, mysore: /\b(mysore|mysuru)\b/i,
  nainital: /\b(nainital|bhimtal)\b/i, ooty: /\b(ooty|udhagamandalam|coonoor|nilgiris?)\b/i, pondicherry: /\b(pondicherry|puducherry|pondy|auroville)\b/i, pune: /\b(pune|poona)\b/i,
  sikkim: /\b(sikkim|gangtok)\b/i, udaipur: /\budaipur\b/i, varanasi: /\b(varanasi|banaras|benares|kashi)\b/i,
};
// A key that is a whole country's lines also fits any place the trip has in that country.
const EXACT_COUNTRY: Record<string, string> = { thailand: "TH", singapore: "SG", maldives: "MV", vietnam: "VN", srilanka: "LK", japan: "JP", nepal: "NP", bhutan: "BT", switzerland: "CH" };
export function namesThePlace(key: string, text: string, country?: string | null): boolean {
  const re = EXACT_NAMES[key] ?? new RegExp(`\\b${key}\\b`, "i");
  if (re.test(text)) return true;
  const cc = EXACT_COUNTRY[key];
  return Boolean(cc && country && country.toUpperCase() === cc);
}

// The lines for one trip story: the place's own first, then the kind of trip, then the crew.
// `seed` is the trip, `day` moves the lines on each day by `step` (how many a day's story shows), and `avoid` holds lines already used
// by other stories on the same Home.
export function storyLines(o: { month?: number | null; place?: string | null; country?: string | null; countryName?: string | null; flag?: string | null; city?: string | null; mood?: "beach" | "hills" | "city" | "any"; people: number; seed: string; day?: number; step?: number; avoid?: Set<string>; n?: number; home?: string | null; couple?: boolean; placeText?: string | null }): Line[] {
  // The place's own hand-written lines (only when the trip names that exact place: `placeText` is its name and "Where to?"), else lines
  // for its city and country (any country in the world). `home` is the viewer's country, `couple` is true for a couple's group.
  const key = o.place ? o.place.replace(/^place-/, "").replace(/^kyoto$/, "japan") : "";
  const exact = o.placeText == null || namesThePlace(key, o.placeText, o.country);
  const handWritten = (key && exact && PLACE[key]) || [];
  const own = handWritten.length ? handWritten : worldLines(o.country, o.city, o.countryName, o.flag, o.home);
  const mood = MOOD[o.mood ?? "any"];
  const n = o.n ?? 4;
  const day = o.day ?? 0;
  const taken = new Set(o.avoid ?? []);
  const take = (list: Line[], salt: string, k: number) => {
    const got = rotate(list, `${o.seed}${salt}`, day, k, taken, o.step ?? k);
    for (const l of got) taken.add(l[1]);
    return got;
  };
  // Up to 3 about the place, then the trip's kind, then one about the crew.
  const crew = take(crewLines(o.people, o.couple), "c", 1);
  const season = take(seasonLines(o.month, o.country, { city: o.city, text: o.placeText, mood: o.mood }), "s", 1);
  const room = Math.max(1, n - crew.length - season.length);
  const placeLines = take(own, "", Math.min(room, own.length));
  const rest = take(mood, "m", Math.max(0, room - placeLines.length));
  return [...placeLines, ...season, ...rest, ...crew].slice(0, n);
}

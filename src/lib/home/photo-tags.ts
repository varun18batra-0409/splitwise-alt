// What's in each of Loopin's photos (looked at one by one), so a story slide's words can match its
// picture: a sunset line on a sunset, a houseboat line on a houseboat. The most telling tag comes
// first. A photo not listed here just gets lines about the place instead.

export const PHOTO_TAGS: Record<string, string[]> = {
  // Group pictures
  "cover-beach": ["sunset", "beach"], "cover-beach-2": ["beach", "palms"], "cover-beach-3": ["sunset", "beach"], "cover-beach-4": ["sunset", "sea", "palms"],
  "cover-city": ["neon", "night", "street"], "cover-city-2": ["skyline"], "cover-city-3": ["night", "skyline"], "cover-city-4": ["skyline"],
  "cover-food": ["food"], "cover-cafe": ["coffee"], "cover-forest": ["forest"], "cover-lake": ["lake"], "cover-mountains": ["mountains", "clouds"],
  "cover-mountains-2": ["mountains"], "cover-mountains-3": ["mountains"], "cover-mountains-4": ["lake", "mountains"],
  "cover-paris": ["sunset", "monument"], "cover-paris-2": ["monument"], "cover-paris-3": ["monument"], "cover-paris-4": ["cafe"], "cover-paris-5": ["night", "bridge"],
  "cover-party": ["party"], "cover-road": ["road", "desert"], "cover-road-in": ["road", "forest"], "cover-snow": ["mountains"], "cover-taj": ["monument"],
  "cover-friends": ["friends"], friends: ["sunset", "friends"], hero: ["friends"], dinner: ["food"], market: ["neon", "night", "street"], roadtrip: ["road", "desert"], sunset: ["sunset", "monument"], train: ["train"],
  // Places
  "place-alibaug": ["beach", "palms"], "place-alibaug-2": ["beach"],
  "place-amritsar": ["temple", "night"], "place-amritsar-2": ["temple"],
  "place-andaman": ["beach", "island"],
  "place-bali": ["rice"], "place-bali-2": ["beach", "cliffs"], "place-bali-3": ["temple", "lake"], "place-bali-4": ["beach", "cliffs"], "place-bali-5": ["waterfall"], "place-bali-6": ["rice"],
  "place-bhutan": ["monastery", "hills"],
  "place-coorg": ["hills", "clouds"], "place-coorg-2": ["forest", "village"],
  "place-corbett": ["mist", "forest"],
  "place-darjeeling": ["train", "tea"], "place-darjeeling-2": ["town", "clouds"],
  "place-delhi": ["monument", "sunset"], "place-delhi-2": ["monument", "garden"],
  "place-dubai": ["skyline", "sunset"], "place-dubai-2": ["skyline", "sunset"], "place-dubai-3": ["sea", "skyline"], "place-dubai-4": ["night", "skyline"], "place-dubai-5": ["skyline"],
  "place-goa": ["beach", "palms"], "place-goa-2": ["beach"], "place-goa-3": ["beach", "palms"], "place-goa-4": ["sunset", "sea", "palms"], "place-goa-5": ["beach"], "place-goa-6": ["sunset", "beach"],
  "place-gokarna": ["beach", "hills"], "place-gokarna-2": ["sea", "cliffs"],
  "place-hampi": ["ruins", "temple"], "place-hampi-2": ["ruins"],
  "place-hyderabad": ["monument", "street"], "place-hyderabad-2": ["monument"],
  "place-jaipur": ["palace"], "place-jaipur-2": ["palace", "lake"], "place-jaipur-3": ["palace"], "place-jaipur-4": ["city"], "place-jaipur-5": ["palace", "lake"],
  "place-jaisalmer": ["desert"], "place-jaisalmer-2": ["desert", "sunset"],
  "place-japan": ["temple"], "place-japan-2": ["mountains", "temple"], "place-japan-3": ["temple", "sunset"], "place-japan-4": ["shrine", "lake"], "place-japan-5": ["night", "street"], "place-japan-6": ["temple", "blossom"],
  "place-kashmir": ["lake", "boat"], "place-kashmir-2": ["mountains", "snow"],
  "place-kerala": ["houseboat"], "place-kerala-2": ["hills"], "place-kerala-3": ["waterfall", "hills"], "place-kerala-4": ["tea", "hills"], "place-kolkata": ["bridge", "night", "river"], "place-kolkata-2": ["monument", "garden"], "place-kutch": ["desert"],
  "place-ladakh": ["lake", "mountains"], "place-ladakh-2": ["river", "mountains"], "place-ladakh-3": ["road", "bike"], "place-ladakh-4": ["road", "snow"], "place-ladakh-5": ["monastery"], "place-ladakh-6": ["lake"],
  "place-lonavala": ["hills"], "place-lonavala-2": ["hills", "lake"],
  "place-london": ["bridge"], "place-london-2": ["monument"], "place-london-3": ["sunset", "bridge"], "place-london-4": ["street"], "place-london-5": ["skyline"], "place-maldives": ["island", "sea"],
  "place-manali": ["snow", "mountains"], "place-manali-2": ["snow", "river"], "place-manali-3": ["river", "forest"], "place-manali-4": ["paragliding", "snow"], "place-manali-5": ["snow", "mountains"], "place-manali-6": ["road", "mountains"], "place-meghalaya": ["waterfall"],
  "place-mumbai": ["monument", "sea"], "place-mumbai-2": ["skyline", "sea"], "place-mussoorie": ["hills", "mist"],
  "place-mysore": ["palace"], "place-mysore-2": ["palace", "night"],
  "place-nepal": ["snow", "mountains"], "place-nepal-2": ["stupa"], "place-nepal-3": ["snow", "village"], "place-nepal-4": ["temple"], "place-nepal-5": ["temple", "city"],
  "place-newyork": ["skyline"], "place-newyork-2": ["night", "skyline"], "place-newyork-3": ["sunset", "skyline"], "place-newyork-4": ["street"], "place-newyork-5": ["skyline", "park"], "place-newyork-6": ["neon", "street"],
  "place-ooty": ["tea", "hills", "lake"], "place-ooty-2": ["train", "hills"], "place-pondicherry": ["street"], "place-pondicherry-2": ["town", "sea"], "place-pune": ["palace"],
  "place-rishikesh": ["river", "temple"], "place-rishikesh-2": ["river"], "place-rishikesh-3": ["rafting"], "place-rishikesh-4": ["bridge", "river"], "place-rishikesh-5": ["river"],
  "place-santorini": ["night", "sea"], "place-santorini-2": ["sunset", "sea"], "place-santorini-3": ["sunset"], "place-santorini-4": ["sunset", "sea"],
  "place-sikkim": ["lake", "snow", "stupa"], "place-sikkim-2": ["shrine", "hills"],
  "place-singapore": ["night", "skyline"], "place-singapore-2": ["garden"], "place-singapore-3": ["skyline"], "place-singapore-4": ["skyline"], "place-singapore-5": ["garden"], "place-singapore-6": ["night", "skyline"],
  "place-srilanka": ["train", "bridge"], "place-srilanka-2": ["rock"], "place-srilanka-3": ["waterfall"], "place-srilanka-4": ["wildlife"], "place-srilanka-5": ["palms", "sea"],
  "place-switzerland": ["mountains"], "place-switzerland-2": ["castle", "lake"], "place-switzerland-3": ["lake", "mountains"], "place-switzerland-4": ["lake", "mountains"],
  "place-thailand": ["island", "sea", "boat"], "place-thailand-2": ["island", "sunset"], "place-thailand-3": ["temple"], "place-thailand-4": ["boat", "cliffs"], "place-thailand-5": ["temple"], "place-thailand-6": ["night", "street"],
  "place-udaipur": ["palace", "lake"], "place-udaipur-2": ["palace", "lake", "boat"],
  "place-varanasi": ["river", "boat"], "place-varanasi-2": ["river", "boat"],
  "place-vietnam": ["sea", "boat", "cliffs"], "place-vietnam-2": ["sunset", "skyline"], "place-vietnam-3": ["lake", "cliffs"],
};

// Lines for what's in the picture. Several each, so two slides never say the same thing.
export const TAG_LINES: Record<string, [string, string][]> = {
  sunset: [["Golden hour", "Somebody's taking 400 photos of this sunset"], ["Golden hour", "Phones out. Everyone's a photographer now."], ["Sunset o'clock", "Best seat in the house, no ticket needed"]],
  night: [["After dark", "The night's just getting started"], ["After dark", "Looks even better with the lights on"], ["Night shift", "Sleep is overrated on holiday"]],
  neon: [["Lights on", "Neon, noise and street snacks"], ["After dark", "Every sign says 'come in'"]],
  beach: [["Beach mode", "Toes in the sand, phone on silent"], ["Beach mode", "100% chance of flip-flops"], ["Plot twist", "The beach shack is the fancy dinner"]],
  sea: [["Sea view", "Water this blue should be illegal"], ["Sea view", "Somebody's already planning a swim"]],
  palms: [["Palm trees", "Hammock not included. Find one."], ["Island energy", "Coconut water counts as hydration"]],
  island: [["Island time", "Clocks work differently here"], ["Island hopping", "Boat, beach, repeat"]],
  cliffs: [["The view", "Worth every step to get here"], ["Edge of the map", "Hold on to your phone"]],
  mountains: [["Up here", "Fresh air, no notifications"], ["Mountain mode", "Everyone's a trekker now"], ["The view", "Worth the early alarm"]],
  snow: [["Snow day", "Gloves on, snowball fight loading"], ["Snow day", "Cold enough for two hoodies"], ["Winter wonderland", "Hot chocolate is now a food group"]],
  clouds: [["Above the clouds", "Literally on top of the world"]],
  hills: [["Hill time", "Chai tastes better up here"], ["Hill time", "Every bend in the road, a new view"]],
  mist: [["Into the mist", "Moody weather, cosy plans"], ["Fog mode", "Jackets on, chai on"]],
  tea: [["Tea country", "Straight from the garden to your cup"], ["Tea time", "Buy the good stuff to take home"]],
  forest: [["Into the woods", "Shady paths and zero signal"], ["Green everywhere", "Breathe in. That's the good air."]],
  lake: [["Lakeside", "Still water, slow mornings"], ["Lakeside", "Somebody suggests a boat ride"]],
  river: [["By the river", "Sit by the water, lose track of time"], ["River views", "The sound of water fixes everything"]],
  waterfall: [["Waterfall", "Bring a towel. Or don't, and regret it."], ["Waterfall", "Loud, wet, worth it"]],
  rafting: [["White water", "Paddle hard, scream louder"]],
  boat: [["All aboard", "Boat ride, golden hour, no notifications"], ["Out on the water", "Everyone's suddenly a sailor"]],
  houseboat: [["Houseboat days", "Lunch on the backwaters is the best meal of the trip"]],
  temple: [["Temple visit", "Shoes off, phones on silent"], ["Temple visit", "Quiet moments count too"]],
  shrine: [["Peaceful", "Some places ask you to slow down"]],
  stupa: [["Prayer flags", "Walk clockwise, make a wish"]],
  monastery: [["Monastery", "Prayer wheels and very big views"]],
  palace: [["Royal day out", "Living like royalty, budget edition"], ["Palace views", "Someone's planning their wedding photos"]],
  fort: [["Fort day", "Climb up, look out, feel like a king"]],
  monument: [["Must-see", "Group photo here is mandatory"], ["Landmark", "Seen it on postcards. Now in person."]],
  ruins: [["Old stones", "History, but make it an adventure"]],
  castle: [["Castle by the lake", "Straight out of a storybook"]],
  bridge: [["Over the bridge", "Walk it once, photograph it twice"]],
  skyline: [["City views", "Find the rooftop. Order the drinks."], ["Skyline", "So many lights, so many plans"]],
  street: [["Street life", "Wander. Snack. Repeat."], ["Out walking", "You will walk 20,000 steps today"]],
  city: [["City mode", "Every lane, a new snack"]],
  town: [["Hill town", "Steep streets, cosy cafés"]],
  village: [["Village life", "Slow mornings, warm people"]],
  garden: [["Garden walk", "Green, gorgeous and air-conditioned somewhere"]],
  park: [["Park day", "Pick a bench, people-watch"]],
  desert: [["Desert days", "Sand in everything. Everything."], ["Desert nights", "Stars you can't see at home"]],
  road: [["On the road", "Window seat is non-negotiable"], ["Road trip", "Somebody's DJing, somebody's navigating"]],
  bike: [["Ride on", "Wind in your face, helmet on"]],
  paragliding: [["Up, up and away", "Someone's flying today. Someone's filming."]],
  wildlife: [["Wildlife", "Quiet. Something's watching."], ["Spotted", "Phones up, voices down"]],
  rice: [["Green terraces", "Every shade of green, all at once"]],
  rock: [["Big climb", "1,200 steps. The view says thank you."]],
  festival: [["Festival vibes", "Colour, crowds and noise. Perfect."]],
  train: [["All aboard", "Window seat, chai and a long view"]],
  friends: [["The crew", "Same people, new place"], ["The crew", "Group photo, take 37"]],
  food: [["Food stop", "Order one of everything. Share."]],
  coffee: [["Coffee break", "First, coffee. Then plans."]],
  cafe: [["Café stop", "Croissant first, questions later"]],
  party: [["Night out", "Dance now, split the bill later"]],
  blossom: [["Blossom season", "Pink everywhere. Phones everywhere."]],
};

// Which picture is this? "/photos/place-goa-4.jpg" → "place-goa-4".
export const slotOfPhoto = (src: string) => src.replace(/^.*\/photos\//, "").replace(/\.jpg$/, "");

// A line that fits this photo, avoiding lines already used on other slides (`used`).
export function lineForPhoto(src: string, seed: number, used: Set<string>): [string, string] | null {
  const tags = PHOTO_TAGS[slotOfPhoto(src)] ?? [];
  for (const t of tags) {
    const options = (TAG_LINES[t] ?? []).filter(([, l]) => !used.has(l));
    if (options.length) return options[seed % options.length];
  }
  return null;
}

// Places for the trip passport: which city and country a trip went to, from
// what the trip is called ("Goa trip", "Bangkok & Phuket") or what someone
// typed in "Where to?". Everything stays in the app: names never go to an
// outside service.

export type Country = { code: string; name: string; flag: string };

const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const C = (code: string, name: string): Country => ({ code, name, flag: flag(code) });

// Countries people travel to most from our markets (picked from a list, so names are always right).
export const COUNTRIES: Country[] = [
  C("IN", "India"), C("US", "United States"), C("GB", "United Kingdom"), C("CA", "Canada"), C("AU", "Australia"), C("NZ", "New Zealand"),
  C("SG", "Singapore"), C("AE", "UAE"), C("TH", "Thailand"), C("ID", "Indonesia"), C("MY", "Malaysia"), C("VN", "Vietnam"),
  C("LK", "Sri Lanka"), C("MV", "Maldives"), C("NP", "Nepal"), C("BT", "Bhutan"), C("JP", "Japan"), C("KR", "South Korea"),
  C("CN", "China"), C("HK", "Hong Kong"), C("PH", "Philippines"), C("KH", "Cambodia"), C("TR", "Turkey"), C("GR", "Greece"),
  C("IT", "Italy"), C("FR", "France"), C("ES", "Spain"), C("PT", "Portugal"), C("DE", "Germany"), C("NL", "Netherlands"),
  C("CH", "Switzerland"), C("AT", "Austria"), C("CZ", "Czechia"), C("HU", "Hungary"), C("IE", "Ireland"), C("IS", "Iceland"),
  C("NO", "Norway"), C("SE", "Sweden"), C("DK", "Denmark"), C("FI", "Finland"), C("BE", "Belgium"), C("PL", "Poland"),
  C("HR", "Croatia"), C("EG", "Egypt"), C("ZA", "South Africa"), C("KE", "Kenya"), C("TZ", "Tanzania"), C("MA", "Morocco"),
  C("MU", "Mauritius"), C("SC", "Seychelles"), C("QA", "Qatar"), C("OM", "Oman"), C("SA", "Saudi Arabia"), C("JO", "Jordan"),
  C("IL", "Israel"), C("MX", "Mexico"), C("BR", "Brazil"), C("AR", "Argentina"), C("PE", "Peru"), C("CL", "Chile"),
  C("CO", "Colombia"), C("CR", "Costa Rica"), C("CU", "Cuba"), C("JM", "Jamaica"), C("BS", "Bahamas"), C("RU", "Russia"),
  C("GE", "Georgia"), C("AZ", "Azerbaijan"), C("UZ", "Uzbekistan"), C("KZ", "Kazakhstan"), C("TW", "Taiwan"), C("FJ", "Fiji"),
];
export const countryOf = (code: string): Country | undefined => COUNTRIES.find((c) => c.code === code.toUpperCase());

// Known places: the words people use → a city name and its country.
const PLACES: [RegExp, string, string][] = [
  [/\b(goa|baga|calangute|anjuna|palolem)\b/i, "Goa", "IN"],
  [/\b(manali|kasol|kullu)\b/i, "Manali", "IN"],
  [/\b(shimla)\b/i, "Shimla", "IN"],
  [/\b(dharamshala|mcleodganj)\b/i, "Dharamshala", "IN"],
  [/\b(spiti)\b/i, "Spiti", "IN"],
  [/\b(ladakh|leh|zanskar|pangong|nubra)\b/i, "Ladakh", "IN"],
  [/\b(alleppey|alappuzha)\b/i, "Alleppey", "IN"],
  [/\b(munnar)\b/i, "Munnar", "IN"],
  [/\b(kochi|cochin)\b/i, "Kochi", "IN"],
  [/\b(varkala)\b/i, "Varkala", "IN"],
  [/\b(wayanad)\b/i, "Wayanad", "IN"],
  [/\b(kerala)\b/i, "Kerala", "IN"],
  [/\b(jaipur)\b/i, "Jaipur", "IN"],
  [/\b(udaipur)\b/i, "Udaipur", "IN"],
  [/\b(jodhpur)\b/i, "Jodhpur", "IN"],
  [/\b(jaisalmer)\b/i, "Jaisalmer", "IN"],
  [/\b(pushkar)\b/i, "Pushkar", "IN"],
  [/\b(rajasthan)\b/i, "Rajasthan", "IN"],
  [/\b(andaman|havelock|port ?blair|neil island)\b/i, "Andaman", "IN"],
  [/\b(rishikesh)\b/i, "Rishikesh", "IN"],
  [/\b(haridwar)\b/i, "Haridwar", "IN"],
  [/\b(mussoorie)\b/i, "Mussoorie", "IN"],
  [/\b(auli)\b/i, "Auli", "IN"],
  [/\b(nainital)\b/i, "Nainital", "IN"],
  [/\b(meghalaya|shillong|cherrapunji|dawki)\b/i, "Meghalaya", "IN"],
  [/\b(agra|taj)\b/i, "Agra", "IN"],
  [/\b(varanasi|banaras|kashi)\b/i, "Varanasi", "IN"],
  [/\b(mumbai|bombay)\b/i, "Mumbai", "IN"],
  [/\b(delhi)\b/i, "Delhi", "IN"],
  [/\b(bangalore|bengaluru)\b/i, "Bengaluru", "IN"],
  [/\b(pune)\b/i, "Pune", "IN"],
  [/\b(lonavala|khandala)\b/i, "Lonavala", "IN"],
  [/\b(alibaug)\b/i, "Alibaug", "IN"],
  [/\b(hyderabad)\b/i, "Hyderabad", "IN"],
  [/\b(chennai|madras)\b/i, "Chennai", "IN"],
  [/\b(pondicherry|puducherry|pondy)\b/i, "Pondicherry", "IN"],
  [/\b(ooty)\b/i, "Ooty", "IN"],
  [/\b(coorg|kodagu)\b/i, "Coorg", "IN"],
  [/\b(hampi)\b/i, "Hampi", "IN"],
  [/\b(gokarna)\b/i, "Gokarna", "IN"],
  [/\b(kolkata|calcutta)\b/i, "Kolkata", "IN"],
  [/\b(darjeeling)\b/i, "Darjeeling", "IN"],
  [/\b(gangtok|sikkim)\b/i, "Sikkim", "IN"],
  [/\b(amritsar)\b/i, "Amritsar", "IN"],
  [/\b(kashmir|srinagar|gulmarg|pahalgam)\b/i, "Kashmir", "IN"],
  [/\b(bangkok)\b/i, "Bangkok", "TH"],
  [/\b(phuket)\b/i, "Phuket", "TH"],
  [/\b(krabi|phi ?phi)\b/i, "Krabi", "TH"],
  [/\b(pattaya)\b/i, "Pattaya", "TH"],
  [/\b(samui)\b/i, "Koh Samui", "TH"],
  [/\b(chiang ?mai)\b/i, "Chiang Mai", "TH"],
  [/\b(thailand|thai)\b/i, "", "TH"],
  [/\b(bali|ubud|seminyak|nusa)\b/i, "Bali", "ID"],
  [/\b(indonesia)\b/i, "", "ID"],
  [/\b(dubai)\b/i, "Dubai", "AE"],
  [/\b(abu ?dhabi)\b/i, "Abu Dhabi", "AE"],
  [/\b(uae|emirates)\b/i, "", "AE"],
  [/\b(singapore)\b/i, "Singapore", "SG"],
  [/\b(maldives)\b/i, "Maldives", "MV"],
  [/\b(kuala lumpur|langkawi|malaysia)\b/i, "", "MY"],
  [/\b(hanoi)\b/i, "Hanoi", "VN"],
  [/\b(ha ?long)\b/i, "Ha Long", "VN"],
  [/\b(da ?nang)\b/i, "Da Nang", "VN"],
  [/\b(hoi ?an)\b/i, "Hoi An", "VN"],
  [/\b(saigon|ho chi minh)\b/i, "Ho Chi Minh City", "VN"],
  [/\b(vietnam)\b/i, "", "VN"],
  [/\b(colombo)\b/i, "Colombo", "LK"],
  [/\b(kandy)\b/i, "Kandy", "LK"],
  [/\b(galle)\b/i, "Galle", "LK"],
  [/\b(sri ?lanka|ceylon)\b/i, "", "LK"],
  [/\b(kathmandu)\b/i, "Kathmandu", "NP"],
  [/\b(pokhara)\b/i, "Pokhara", "NP"],
  [/\b(nepal|everest|annapurna)\b/i, "", "NP"],
  [/\b(thimphu|paro|punakha|bhutan)\b/i, "", "BT"],
  [/\b(tokyo)\b/i, "Tokyo", "JP"],
  [/\b(kyoto)\b/i, "Kyoto", "JP"],
  [/\b(osaka)\b/i, "Osaka", "JP"],
  [/\b(japan|hokkaido)\b/i, "", "JP"],
  [/\b(seoul|busan|korea)\b/i, "", "KR"],
  [/\b(hong ?kong)\b/i, "Hong Kong", "HK"],
  [/\b(london)\b/i, "London", "GB"],
  [/\b(edinburgh)\b/i, "Edinburgh", "GB"],
  [/\b(england|uk|scotland)\b/i, "", "GB"],
  [/\b(paris)\b/i, "Paris", "FR"],
  [/\b(france|provence|riviera)\b/i, "", "FR"],
  [/\b(santorini)\b/i, "Santorini", "GR"],
  [/\b(mykonos)\b/i, "Mykonos", "GR"],
  [/\b(athens)\b/i, "Athens", "GR"],
  [/\b(greece|greek)\b/i, "", "GR"],
  [/\b(rome)\b/i, "Rome", "IT"],
  [/\b(venice)\b/i, "Venice", "IT"],
  [/\b(florence)\b/i, "Florence", "IT"],
  [/\b(italy|amalfi|tuscany)\b/i, "", "IT"],
  [/\b(barcelona)\b/i, "Barcelona", "ES"],
  [/\b(madrid)\b/i, "Madrid", "ES"],
  [/\b(spain|ibiza)\b/i, "", "ES"],
  [/\b(lisbon|porto|portugal)\b/i, "", "PT"],
  [/\b(amsterdam|netherlands|holland)\b/i, "", "NL"],
  [/\b(zurich|interlaken|zermatt|lucerne|switzerland|swiss)\b/i, "", "CH"],
  [/\b(prague)\b/i, "Prague", "CZ"],
  [/\b(vienna|austria)\b/i, "", "AT"],
  [/\b(berlin|munich|germany)\b/i, "", "DE"],
  [/\b(istanbul|cappadocia|turkey)\b/i, "", "TR"],
  [/\b(iceland|reykjavik)\b/i, "", "IS"],
  [/\b(new ?york|nyc|manhattan|brooklyn)\b/i, "New York", "US"],
  [/\b(las vegas|vegas)\b/i, "Las Vegas", "US"],
  [/\b(san francisco)\b/i, "San Francisco", "US"],
  [/\b(los angeles)\b/i, "Los Angeles", "US"],
  [/\b(miami)\b/i, "Miami", "US"],
  [/\b(hawaii|maui|honolulu)\b/i, "Hawaii", "US"],
  [/\b(toronto)\b/i, "Toronto", "CA"],
  [/\b(vancouver|banff)\b/i, "", "CA"],
  [/\b(sydney)\b/i, "Sydney", "AU"],
  [/\b(melbourne)\b/i, "Melbourne", "AU"],
  [/\b(australia)\b/i, "", "AU"],
  [/\b(queenstown|new zealand)\b/i, "", "NZ"],
  [/\b(mauritius)\b/i, "Mauritius", "MU"],
  [/\b(seychelles)\b/i, "Seychelles", "SC"],
  [/\b(cairo|egypt)\b/i, "", "EG"],
  [/\b(cape town|south africa)\b/i, "", "ZA"],
  [/\b(kenya|masai mara|nairobi)\b/i, "", "KE"],
  [/\b(baku|azerbaijan)\b/i, "", "AZ"],
  [/\b(tbilisi|georgia)\b/i, "", "GE"],
  [/\b(almaty|kazakhstan)\b/i, "", "KZ"],
  [/\b(tashkent|samarkand|uzbekistan)\b/i, "", "UZ"],
  [/\b(cancun|mexico)\b/i, "", "MX"],
];

export type Stop = { city: string; country: string }; // country = ISO code ("" = not known)

// Where a trip went: what was typed in "Where to?" first, else the trip's name.
export function tripStops(name: string, place = "", country = ""): Stop[] {
  const from = (text: string) => {
    const out: Stop[] = [];
    for (const [re, city, c] of PLACES) {
      if (!re.test(text)) continue;
      // A country word after a city in the same country adds nothing.
      if (!city && out.some((s) => s.country === c)) continue;
      if (out.some((s) => s.city === city && s.country === c)) continue;
      out.push({ city, country: c });
    }
    return out;
  };
  if (place.trim()) {
    const known = from(place);
    if (known.length) return known.map((s) => (country && !s.country ? { ...s, country } : s));
    // Places we don't know: as typed, one per comma or "&".
    return place
      .split(/,|&|\+|\band\b/i)
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 5)
      .map((city) => ({ city: city.slice(0, 30), country: country.toUpperCase() }));
  }
  const guessed = from(name);
  if (guessed.length) return guessed;
  return country ? [{ city: "", country: country.toUpperCase() }] : [];
}

// Places for the trip passport: which city and country a trip went to, from
// what the trip is called ("Goa trip", "Bangkok & Phuket") or what someone
// typed in "Where to?". Everything stays in the app: names never go to an
// outside service.

export type Country = { code: string; name: string; flag: string };

const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const C = (code: string, name: string): Country => ({ code, name, flag: flag(code) });

// Every country (and the places people fly to that have their own flag), A to Z.
// Picked from a list, so names are always right.
export const COUNTRIES: Country[] = [
  C("AF", "Afghanistan"), C("AX", "Åland Islands"), C("AL", "Albania"), C("DZ", "Algeria"), C("AS", "American Samoa"), C("AD", "Andorra"),
  C("AO", "Angola"), C("AI", "Anguilla"), C("AQ", "Antarctica"), C("AG", "Antigua & Barbuda"), C("AR", "Argentina"), C("AM", "Armenia"),
  C("AW", "Aruba"), C("AU", "Australia"), C("AT", "Austria"), C("AZ", "Azerbaijan"), C("BS", "Bahamas"), C("BH", "Bahrain"), C("BD", "Bangladesh"),
  C("BB", "Barbados"), C("BY", "Belarus"), C("BE", "Belgium"), C("BZ", "Belize"), C("BJ", "Benin"), C("BM", "Bermuda"), C("BT", "Bhutan"),
  C("BO", "Bolivia"), C("BA", "Bosnia & Herzegovina"), C("BW", "Botswana"), C("BR", "Brazil"), C("VG", "British Virgin Islands"), C("BN", "Brunei"),
  C("BG", "Bulgaria"), C("BF", "Burkina Faso"), C("BI", "Burundi"), C("KH", "Cambodia"), C("CM", "Cameroon"), C("CA", "Canada"),
  C("CV", "Cape Verde"), C("BQ", "Caribbean Netherlands"), C("KY", "Cayman Islands"), C("CF", "Central African Republic"), C("TD", "Chad"),
  C("CL", "Chile"), C("CN", "China"), C("CO", "Colombia"), C("KM", "Comoros"), C("CG", "Congo"), C("CK", "Cook Islands"), C("CR", "Costa Rica"),
  C("CI", "Côte d’Ivoire"), C("HR", "Croatia"), C("CU", "Cuba"), C("CW", "Curaçao"), C("CY", "Cyprus"), C("CZ", "Czechia"), C("DK", "Denmark"),
  C("DJ", "Djibouti"), C("DM", "Dominica"), C("DO", "Dominican Republic"), C("CD", "DR Congo"), C("EC", "Ecuador"), C("EG", "Egypt"),
  C("SV", "El Salvador"), C("GQ", "Equatorial Guinea"), C("ER", "Eritrea"), C("EE", "Estonia"), C("SZ", "Eswatini"), C("ET", "Ethiopia"),
  C("FK", "Falkland Islands"), C("FO", "Faroe Islands"), C("FJ", "Fiji"), C("FI", "Finland"), C("FR", "France"), C("GF", "French Guiana"),
  C("PF", "French Polynesia"), C("GA", "Gabon"), C("GM", "Gambia"), C("GE", "Georgia"), C("DE", "Germany"), C("GH", "Ghana"), C("GI", "Gibraltar"),
  C("GR", "Greece"), C("GL", "Greenland"), C("GD", "Grenada"), C("GP", "Guadeloupe"), C("GU", "Guam"), C("GT", "Guatemala"), C("GG", "Guernsey"),
  C("GN", "Guinea"), C("GW", "Guinea-Bissau"), C("GY", "Guyana"), C("HT", "Haiti"), C("HN", "Honduras"), C("HK", "Hong Kong"), C("HU", "Hungary"),
  C("IS", "Iceland"), C("IN", "India"), C("ID", "Indonesia"), C("IR", "Iran"), C("IQ", "Iraq"), C("IE", "Ireland"), C("IM", "Isle of Man"),
  C("IL", "Israel"), C("IT", "Italy"), C("JM", "Jamaica"), C("JP", "Japan"), C("JE", "Jersey"), C("JO", "Jordan"), C("KZ", "Kazakhstan"),
  C("KE", "Kenya"), C("KI", "Kiribati"), C("XK", "Kosovo"), C("KW", "Kuwait"), C("KG", "Kyrgyzstan"), C("LA", "Laos"), C("LV", "Latvia"),
  C("LB", "Lebanon"), C("LS", "Lesotho"), C("LR", "Liberia"), C("LY", "Libya"), C("LI", "Liechtenstein"), C("LT", "Lithuania"),
  C("LU", "Luxembourg"), C("MO", "Macau"), C("MG", "Madagascar"), C("MW", "Malawi"), C("MY", "Malaysia"), C("MV", "Maldives"), C("ML", "Mali"),
  C("MT", "Malta"), C("MH", "Marshall Islands"), C("MQ", "Martinique"), C("MR", "Mauritania"), C("MU", "Mauritius"), C("YT", "Mayotte"),
  C("MX", "Mexico"), C("FM", "Micronesia"), C("MD", "Moldova"), C("MC", "Monaco"), C("MN", "Mongolia"), C("ME", "Montenegro"), C("MS", "Montserrat"),
  C("MA", "Morocco"), C("MZ", "Mozambique"), C("MM", "Myanmar"), C("NA", "Namibia"), C("NR", "Nauru"), C("NP", "Nepal"), C("NL", "Netherlands"),
  C("NC", "New Caledonia"), C("NZ", "New Zealand"), C("NI", "Nicaragua"), C("NE", "Niger"), C("NG", "Nigeria"), C("NU", "Niue"),
  C("KP", "North Korea"), C("MK", "North Macedonia"), C("MP", "Northern Mariana Islands"), C("NO", "Norway"), C("OM", "Oman"), C("PK", "Pakistan"),
  C("PW", "Palau"), C("PS", "Palestine"), C("PA", "Panama"), C("PG", "Papua New Guinea"), C("PY", "Paraguay"), C("PE", "Peru"),
  C("PH", "Philippines"), C("PL", "Poland"), C("PT", "Portugal"), C("PR", "Puerto Rico"), C("QA", "Qatar"), C("RE", "Réunion"), C("RO", "Romania"),
  C("RU", "Russia"), C("RW", "Rwanda"), C("WS", "Samoa"), C("SM", "San Marino"), C("ST", "São Tomé & Príncipe"), C("SA", "Saudi Arabia"),
  C("SN", "Senegal"), C("RS", "Serbia"), C("SC", "Seychelles"), C("SL", "Sierra Leone"), C("SG", "Singapore"), C("SX", "Sint Maarten"),
  C("SK", "Slovakia"), C("SI", "Slovenia"), C("SB", "Solomon Islands"), C("SO", "Somalia"), C("ZA", "South Africa"), C("KR", "South Korea"),
  C("SS", "South Sudan"), C("ES", "Spain"), C("LK", "Sri Lanka"), C("BL", "St. Barthélemy"), C("SH", "St. Helena"), C("KN", "St. Kitts & Nevis"),
  C("LC", "St. Lucia"), C("MF", "St. Martin"), C("PM", "St. Pierre & Miquelon"), C("VC", "St. Vincent & Grenadines"), C("SD", "Sudan"),
  C("SR", "Suriname"), C("SE", "Sweden"), C("CH", "Switzerland"), C("SY", "Syria"), C("TW", "Taiwan"), C("TJ", "Tajikistan"), C("TZ", "Tanzania"),
  C("TH", "Thailand"), C("TL", "Timor-Leste"), C("TG", "Togo"), C("TO", "Tonga"), C("TT", "Trinidad & Tobago"), C("TN", "Tunisia"),
  C("TR", "Turkey"), C("TM", "Turkmenistan"), C("TC", "Turks & Caicos Islands"), C("TV", "Tuvalu"), C("VI", "U.S. Virgin Islands"),
  C("UG", "Uganda"), C("UA", "Ukraine"), C("AE", "United Arab Emirates"), C("GB", "United Kingdom"), C("US", "United States"), C("UY", "Uruguay"),
  C("UZ", "Uzbekistan"), C("VU", "Vanuatu"), C("VA", "Vatican City"), C("VE", "Venezuela"), C("VN", "Vietnam"), C("WF", "Wallis & Futuna"),
  C("EH", "Western Sahara"), C("YE", "Yemen"), C("ZM", "Zambia"), C("ZW", "Zimbabwe"),
];

// Other names people search for.
const ALSO: Record<string, string> = {
  AE: "uae emirates dubai abu dhabi", GB: "uk britain great britain england scotland wales", US: "usa america united states of america",
  TR: "turkiye türkiye", CZ: "czech republic", NL: "holland", KR: "korea", KP: "korea", CI: "ivory coast", CV: "cabo verde", SZ: "swaziland",
  MK: "macedonia", MM: "burma", TL: "east timor", VA: "vatican holy see", BA: "bosnia", TT: "trinidad tobago", CD: "congo kinshasa zaire",
  CG: "congo brazzaville", LA: "lao", RU: "russian federation", VN: "viet nam", HK: "hongkong", MO: "macao",
};
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// Countries whose name (or another name for them) has the typed words.
export function searchCountries(q: string, list: Country[] = COUNTRIES): Country[] {
  const words = fold(q).replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => {
    const hay = fold(`${c.name} ${ALSO[c.code] ?? ""} ${c.code}`).replace(/&/g, "and").replace(/\bst\./g, "saint st");
    return words.every((w) => hay.split(/[^a-z]+/).some((x) => x.startsWith(w)));
  });
}
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

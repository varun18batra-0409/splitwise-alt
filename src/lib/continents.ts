// Which continent a country is on, for the passport's "3 continents" moments.
// Countries that span two (Turkey, Russia, Egypt) go where most travellers
// land: Turkey and Russia count as Europe, Egypt as Africa. Pure.

export type Continent = "Asia" | "Europe" | "Africa" | "North America" | "South America" | "Oceania" | "Antarctica";

const LISTS: Record<Continent, string> = {
  Asia: "AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TM AE UZ VN YE",
  Europe: "AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA",
  Africa: "DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW",
  "North America": "AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI",
  "South America": "AR BO BR CL CO EC FK GF GY PY PE SR UY VE",
  Oceania: "AS AU CK FJ PF GU KI MH FM NR NC NZ NU MP PW PG WS SB TO TV VU WF",
  Antarctica: "AQ",
};

const BY_CODE = new Map<string, Continent>();
for (const [continent, codes] of Object.entries(LISTS) as [Continent, string][]) for (const c of codes.split(" ")) BY_CODE.set(c, continent);

export const continentOf = (code: string): Continent | undefined => BY_CODE.get(code.toUpperCase());

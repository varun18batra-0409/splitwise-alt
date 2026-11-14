// Downloads small previews of candidate photos so they can be compared before
// picking one for the guide. Output: screenshots/candidates/<slot>-<n>.jpg
import { mkdirSync, writeFileSync } from "node:fs";

const CANDIDATES = {
  restaurant: [
    "photo-1673706530246-4c1d8b141748", "photo-1669490048328-0d1e075a2b7c", "photo-1753727471395-5ab19d4f1f6e",
    "photo-1753727471014-efe38840c7c7", "photo-1741852197045-cc35920a3aa0", "photo-1661422586023-681ea60507e2",
    "photo-1616669944447-d65d41a222bd", "photo-1775513153018-0c7ac7899751", "photo-1744776411221-702f2848b0b2",
  ],
  abroad: [
    "photo-1542052125323-e69ad37a47c2", "photo-1508904635850-d986b19765d0", "photo-1529156069898-49953e39b3ac",
    "photo-1539635278303-d4002c07eae3", "photo-1525162618450-db04e92d63d6", "photo-1701802721927-6d2fd2f5377c",
    "photo-1758272133719-959319bc2364", "photo-1446160657592-4782fb76fb99", "photo-1542051841857-5f90071e7989",
  ],
};
// The passport's country photos (read by scripts/fetch-photos.mjs). Up to 3 "photo-…" ids per country code: a landmark or landscape,
// colour, no faces, no flags, no text. The first good one becomes country-xx. Countries still to fill (no id yet, so the passport
// draws its stamp instead): MY KH LA PH KR CN HK TW TR IT ES PT DE NL BE AT CZ HU HR IS NO SE DK FI IE PL CA MX BR AR PE AU NZ
// ZA KE TZ EG MA MU SC SA QA OM JO GE AZ UZ KZ. (Run this file to download previews of them all, then pick.)
// Unsplash photo ids found by name on unsplash.com (free licence); the first that downloads and isn't black-and-white is used.
// Every chosen photo is checked by eye on the contact sheet (screenshots: country-photos) before release.
export const COUNTRY_PHOTOS = {
  MY: ["-9B08uduMyY", "X38XxZqtNZg"],
  KH: ["jMW9bO1j9D0", "ridd77X1G6Y"],
  LA: ["in6sTbsTFz8", "dhbcpyJo4m8"],
  PH: ["9ZXHUr5aCwM", "IL-fBBnF-GU"],
  KR: ["RbaGeW_LbGs", "Via0Hy2rYIc"],
  CN: ["HwY9R6_YzgM", "Wbu_scb-9HQ"],
  HK: ["4vf1KEkD7Gc", "o6k0ZH1eOwg"],
  TW: ["au3CYbd7vCU", "C04mAEfPx20"],
  TR: ["7ng3ISrlg1I", "ygtKS8lyjb4"],
  IT: ["5mcnzeSHFvE", "ACCwzsy1_1A"],
  ES: ["D8n_RJ3keAw", "bNW-YvtON_Q"],
  PT: ["0sODcpe2RPo", "GwNkrz7Q9XY"],
  DE: ["nYvXQ-xl53o", "Yj8-A1aJW4c"],
  NL: ["KNSvGgGitnM", "4jOae5vjpcc"],
  BE: ["rPJQs6PunBk", "krmUt2tle_0"],
  AT: ["q2dUSl9S4Xg", "UJEOLuvPPHM"],
  CZ: ["3Ovurn490hw", "6En4WYsNYXM"],
  HU: ["EyDPhY_idpQ", "sMyQb3i9bNA"],
  HR: ["5maoPl591Sk", "C2-XJaEpeKY"],
  IS: ["NUlzQUQgX2Y", "ds4TwK7SuOg"],
  NO: ["a1PKUohb4Gc", "Yoz5EEuSmaM"],
  SE: ["ovCfRHRg2IQ", "WhE-76oHOBI"],
  DK: ["3_ZGrsirryY", "RaRnuPiLHmc"],
  FI: ["WayYTO9oyOQ", "u8RZBtEcIDw"],
  IE: ["nNfIwdHgCyI", "qycLnGpX_bA"],
  PL: ["2lK0291iNHI", "Uuhv9tA9eOI"],
  CA: ["Y6I4VvyN_sA", "EU8M2UI8DB0"],
  MX: ["8L7mOETNgHA", "T7gn0lcMREk"],
  BR: ["aMBnG1e9kiE", "aUXsL7rDOcw"],
  AR: ["5RFMPufTKPA", "9ORm3U9u52E"],
  PE: ["CAKGakBldi8", "4hMET7vYTAQ"],
  AU: ["Hao52Fu9-F8", "-9HX_7HiMok"],
  NZ: ["b3UJ-VRT040", "SXTj90G1f5c"],
  ZA: ["tRPvXfu5Xf0", "zrOjcQXAdvk"],
  KE: ["89IBtfoz3Vw", "B2ixJqf-qzU"],
  TZ: ["JnfqKdwfVD8", "1pZJqQlgpsY"],
  EG: ["ER37sUV9Zzc", "vqRMXgVtGXM"],
  MA: ["FvaiA2QPgzI", "NncAbldgViA"],
  MU: ["Qxxv8M2_aNI", "WV4B_aVj0aQ"],
  SC: ["7cZP91vsQUg", "jPmurJKSL_0"],
  SA: ["_UxsPARhtOg", "KvQ8sir6X-s"],
  QA: ["1UF8ddEalwk", "jJtqDVzozQY"],
  OM: ["dZd4XWMiM9g", "k8oak9BhX7M"],
  JO: ["6yFP4mTiRNg", "Ak7CSzNUVKA"],
  GE: ["5iQWgow3_S0", "2ZcyeRzucoo"],
  AZ: ["y4JwCUo1LHk", "g3LiYwSVDjQ"],
  UZ: ["dtDTZnWIfH4", "cKBg2lao-k8"],
  KZ: ["txoO-N2-Aq8", "F9UqMqRL46k"],
};


// Run directly (node scripts/photo-candidates.mjs) to download the previews above and the older ones below.
if (process.argv[1]?.endsWith("photo-candidates.mjs")) {
  Object.assign(CANDIDATES, Object.fromEntries(Object.entries(COUNTRY_PHOTOS).filter(([, ids]) => ids.length).map(([c, ids]) => [`country-${c.toLowerCase()}`, ids])));
mkdirSync("screenshots/candidates", { recursive: true });
for (const [slot, ids] of Object.entries(CANDIDATES)) {
  for (const [i, id] of ids.entries()) {
    try {
      const r = await fetch(`https://images.unsplash.com/${id}?w=480&q=60&fm=jpg&fit=crop`, { signal: AbortSignal.timeout(20000) });
      const b = Buffer.from(await r.arrayBuffer());
      if (r.ok && b.length > 5000) writeFileSync(`screenshots/candidates/${slot}-${i + 1}.jpg`, b);
      console.log(`${slot}-${i + 1} ${id} ${r.status} ${b.length}`);
    } catch (e) {
      console.log(`${slot}-${i + 1} ${id} failed`);
    }
  }
}
}

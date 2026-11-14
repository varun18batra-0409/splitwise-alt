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
// The passport's country photos (read by scripts/fetch-photos.mjs): "photo-…" ids per country code, a landmark or landscape, colour,
// no faces, no flags, no text (free Unsplash licence). The first that downloads becomes country-xx; a country with none draws its stamp.
// Full image addresses (images.unsplash.com), each checked by eye on a contact sheet (14 Nov). Short Unsplash page links no longer
// work from the build machines: the website sits behind a robot check, and only the image server answers.
export const COUNTRY_PHOTOS = {
  MY: ["photo-1596422846543-75c6fc197f07", "photo-1581792343403-f3201559d559"],
  KH: [], // none checked yet: the drawn stamp stays
  LA: ["photo-1540611025311-01df3cef54b5", "photo-1707817643213-35009bae9814"],
  PH: ["photo-1518509562904-e7ef99cdcc86", "photo-1499793983690-e29da59ef1c2"],
  KR: ["photo-1535189043414-47a3c49a0bed", "photo-1548115184-bc6544d06a58"],
  CN: ["photo-1508804185872-d7badad00f7d", "photo-1547981609-4b6bfe67ca0b"],
  HK: ["photo-1536599018102-9f803c140fc1"],
  TW: ["photo-1609147110688-83b5fd1288e8", "photo-1552311365-ff398de349aa"],
  TR: ["photo-1641128324972-af3212f0f6bd", "photo-1527838832700-5059252407fa"],
  IT: ["photo-1514890547357-a9ee288728e0", "photo-1534113414509-0eec2bfb493f"],
  ES: ["photo-1523531294919-4bcd7c65e216", "photo-1583422409516-2895a77efded"],
  PT: ["photo-1585208798174-6cedd86e019a", "photo-1555881400-74d7acaacd8b"],
  DE: ["photo-1534313314376-a72289b6181e", "photo-1467269204594-9661b134dd2b"],
  NL: ["photo-1534351590666-13e3e96b5017", "photo-1512470876302-972faa2aa9a4"],
  BE: ["photo-1559113202-c916b8e44373"],
  AT: ["photo-1695360242559-3c5a1bebdf4d", "photo-1516550893923-42d28e5677af"],
  CZ: ["photo-1541849546-216549ae216d", "photo-1519677100203-a0e668c92439"],
  HU: ["photo-1616432902940-b7a1acbc60b3", "photo-1549877452-9c387954fbc2"],
  HR: ["photo-1555990793-da11153b2473", "photo-1777781210575-7c8a28f73a3e"],
  IS: ["photo-1476610182048-b716b8518aae", "photo-1504829857797-ddff29c27927"],
  NO: ["photo-1593291619462-e4240344ea21", "photo-1475066392170-59d55d96fe51"],
  SE: ["photo-1509356843151-3e7d96241e11"],
  DK: ["photo-1513622470522-26c3c8a854bc"],
  FI: ["photo-1538332576228-eb5b4c4de6f5"],
  IE: ["photo-1546986294-d9cdc4873420", "photo-1590089415225-401ed6f9db8e"],
  PL: ["photo-1697821829707-1eacd5fd468b", "photo-1577133192629-5140c5371590"],
  CA: ["photo-1503614472-8c93d56e92ce", "photo-1517090504586-fde19ea6066f"],
  MX: ["photo-1665618980645-ca9cd5e68508", "photo-1518659526054-190340b32735"],
  BR: ["photo-1483729558449-99ef09a8c325"],
  AR: ["photo-1589909202802-8f4aadce1849"],
  PE: ["photo-1587595431973-160d0d94add1", "photo-1526392060635-9d6019884377"],
  AU: ["photo-1506973035872-a4ec16b8e8d9", "photo-1528072164453-f4e8ef0d475a"],
  NZ: ["photo-1512017615494-fdf6146235ff", "photo-1507699622108-4be3abd695ad"],
  ZA: ["photo-1580060839134-75a5edca2e99", "photo-1563656157432-67560011e209"],
  KE: ["photo-1547471080-7cc2caa01a7e", "photo-1516426122078-c23e76319801"],
  TZ: ["photo-1650668302197-7f556c34cb91", "photo-1575999502951-4ab25b5ca889"],
  EG: ["photo-1503177119275-0aa32b3a9368", "photo-1568322445389-f64ac2515020"],
  MA: ["photo-1569383746724-6f1b882b8f46", "photo-1539020140153-e479b8c22e70"],
  MU: ["photo-1581702576086-0fb4be1dbafd"],
  SC: ["photo-1563464638093-4d6c0cffbf67", "photo-1590523741831-ab7e8b8f9c7f"],
  SA: ["photo-1586724237569-f3d0c1dee8c6"],
  QA: ["photo-1647252262017-582a7dbb73d0"],
  OM: ["photo-1699855803432-17f4ab468b2d"],
  JO: ["photo-1580834341580-8c17a3a630ca", "photo-1657226250237-7fc5989b4d1f"],
  GE: ["photo-1565008576549-57569a49371d"],
  AZ: ["photo-1633786139955-b9a53b580a53", "photo-1596306499300-0b7b1689b9f6"],
  UZ: ["photo-1653023102302-247f5f0fbdd1"],
  KZ: [], // none checked yet: the drawn stamp stays
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

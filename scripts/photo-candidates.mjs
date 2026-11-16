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
  KH: ["photo-1566706546199-a93ba33ce9f7", "photo-1768904532098-7ac5bcee6b65", "photo-1787055923407-e11fea7de630"], // Angkor Wat reflected at golden hour (checked by eye 15 Nov)
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
  PL: ["photo-1636903364559-0dfc358abd94", "photo-1697821829707-1eacd5fd468b", "photo-1577133192629-5140c5371590"],
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
  MA: ["photo-1597212618440-806262de4f6b", "photo-1680880482590-0f4b9b5258c7", "photo-1539020140153-e479b8c22e70"], // Koutoubia minaret in Marrakech with the snowy Atlas behind; then Ait Benhaddou; then a zellige fountain (founder 15 Nov: the blue Chefchaouen one looked like Greece)
  MU: ["photo-1581702576086-0fb4be1dbafd"],
  SC: ["photo-1563464638093-4d6c0cffbf67", "photo-1590523741831-ab7e8b8f9c7f"],
  SA: ["photo-1586724237569-f3d0c1dee8c6"],
  QA: ["photo-1647252262017-582a7dbb73d0"],
  OM: ["photo-1699855803432-17f4ab468b2d"],
  JO: ["photo-1580834341580-8c17a3a630ca", "photo-1657226250237-7fc5989b4d1f"],
  GE: ["photo-1565008576549-57569a49371d"],
  AZ: ["photo-1633786139955-b9a53b580a53", "photo-1596306499300-0b7b1689b9f6"],
  UZ: ["photo-1653023102302-247f5f0fbdd1"],
  KZ: ["photo-1572940734104-684309ed7ac9", "photo-1600255531849-9edcc7c3d115", "photo-1677475191981-653bcfcc3cd2"], // Big Almaty Lake under snowy peaks (checked by eye 15 Nov)
  // 59 more popular destinations, each picked by eye on a contact sheet (15 Nov): landmark or landscape, colour, no faces, no flags.
  BA: ["photo-1546402956-b698857acdc1", "photo-1772832733324-3ece91f26bbd"],
  ET: ["photo-1634029878815-1bb307302471", "photo-1572888195250-3037a59d3578"],
  VA: ["photo-1610655769765-be8a0dd9627a", "photo-1621710290073-c0bbf4292896"],
  KW: ["photo-1613919295998-5714648c8d90", "photo-1578783951217-ca527085dc12"],
  BH: ["photo-1748066768504-99532da7d1e9", "photo-1519677214308-f7f2f8b71acf"],
  LB: ["photo-1632854269541-dfff1eb1646f", "photo-1521327895744-46e309d005b4"],
  CY: ["photo-1617871109543-6ee1791d7f17", "photo-1758789791158-71e81950f70f"],
  MT: ["photo-1760874565647-4a3625022222", "photo-1669294841689-0ceb34ad40c1"],
  MC: ["photo-1595138320174-a64d168e9970", "photo-1764831526156-a7c4fc7407d7"],
  LU: ["photo-1588336899284-950764f07147", "photo-1787234223348-4ce86b16c4ac"],
  SK: ["photo-1466940219795-c670f475e59f", "photo-1672580402077-c6e7fd2da87e", "photo-1568616388664-1e37d8376363", "photo-1629267481369-28fb3ac3828b"],
  SI: ["photo-1662715593284-14fdf66c1202", "photo-1562083589-3bf71182e9c2"],
  RS: ["photo-1632343084054-5b108ffb8be3", "photo-1665397323958-909c64f2e306"],
  ME: ["photo-1502824420498-012d4c4f0c42", "photo-1614122027743-50a9e6e8002f"],
  AL: ["photo-1648046143698-1204e59eb43b", "photo-1742243910186-c31c321abb53"],
  MK: ["photo-1702410815192-742070b436bb", "photo-1746298200042-c5d6fae9f3e8"],
  BG: ["photo-1663230083809-4b86f6407a4c", "photo-1767025942152-4dfb120e0c90"],
  RO: ["photo-1612118231574-3dad97d26ecf", "photo-1595932725125-c53e717f8d6f"],
  EE: ["photo-1709862366377-54b16f3e51f9", "photo-1575561003164-f36f2e28a524"],
  LV: ["photo-1685470934582-3636319a3be9", "photo-1683730796330-06e60e3438d8"],
  LT: ["photo-1632245808555-bc26f2037ff0", "photo-1642804601576-e2f2181d20b4"],
  RU: ["photo-1513326738677-b964603b136d", "photo-1661755905372-eea22765c203"],
  UA: ["photo-1639341267320-2d062b250c0d", "photo-1659256018440-32664db70cb7"],
  MN: ["photo-1745155541534-0b611f491762", "photo-1766537528298-7cf721c85b6a"],
  MM: ["photo-1774751403526-39d30322e51b", "photo-1774751338682-ee18fe699cdc"],
  BD: ["photo-1706459671524-1b1184898708", "photo-1549300461-11c5b94e8855"],
  PK: ["photo-1514558427911-8e293bebf18c", "photo-1646514323421-094bb563cd37"],
  KG: ["photo-1608497735578-11912e18ed9f", "photo-1602529359787-ce7468eaf119"],
  AM: ["photo-1677864109159-34eb97228c65", "photo-1766949020100-d6cea28ca311"],
  BN: ["photo-1709808971463-270bae12b837", "photo-1709808971436-522aaab4447c"],
  MO: ["photo-1555331446-0ff637678740", "photo-1556629538-fc3eba61504e"],
  CL: ["photo-1658312627438-30d1299683fd", "photo-1586600822178-26dec0f653a9"],
  CO: ["photo-1536308037887-165852797016", "photo-1714686495394-73e2bb1bbd39"],
  CU: ["photo-1536686598161-1b946fd6dfcf", "photo-1602515677088-2643f5eabaa6"],
  CR: ["photo-1664532869454-53ac5942d959", "photo-1745208746272-8d3b979d5f92"],
  PA: ["photo-1632505702897-cc41b0ba3b64", "photo-1524544187526-2b2855b65f16"],
  EC: ["photo-1706957614198-8d2e5f0ed6ea", "photo-1641973240236-250ec59abb1c"],
  BO: ["photo-1732967377708-d0a2815a25f5", "photo-1732967300965-fe93aec46442"],
  UY: ["photo-1643753265232-45c28cc86a12"],
  DO: ["photo-1551126892-7cf2e2d9a4d9", "photo-1678816331175-a61a6835e889"],
  JM: ["photo-1634439695738-2e711fcbb011", "photo-1612292063926-891ab31ebc85"],
  BS: ["photo-1618270707842-748e8faafa3c", "photo-1559956144-83a135c9872e"],
  PR: ["photo-1773904594825-12aefe946a54", "photo-1773904594917-091eaadc851d"],
  GT: ["photo-1669025467316-a1bff8696c36", "photo-1650734837211-fc9cc07bb44b"],
  NA: ["photo-1588788839689-132558996bea", "photo-1696104613970-fc7f58d1ff39"],
  BW: ["photo-1531208853003-c1ec1b8a81d7", "photo-1759215290881-cc6a8ccbb37e"],
  ZW: ["photo-1643231939579-7df8aa7a7f9c", "photo-1634179412263-19d96377c1a2"],
  ZM: ["photo-1759143861174-74eb31f4ecab"],
  RW: ["photo-1651860282296-47055c68580e", "photo-1786795468102-84cd1ac41cd8"],
  UG: ["photo-1660988251043-7998126125c9", "photo-1742327781583-8096731dbb73"],
  GH: ["photo-1651860282137-a59f01d2db7b"],
  NG: ["photo-1765475467677-579353b25ce0", "photo-1569706971306-de5d78f6418e"],
  SN: ["photo-1758061290793-c8df7171bbb1", "photo-1583495506658-50a3587f792e"],
  TN: ["photo-1607869861980-da5f9b8b4969", "photo-1680600827579-70e275365c88"],
  FJ: ["photo-1655719647300-5142977bfa79", "photo-1656051033226-e8c2c8a4178c"],
  PF: ["photo-1674043502175-ba0e7c17247f", "photo-1738762932370-468a90e0ff68"],
  LI: ["photo-1756399040790-dfdcfe6cd2ee", "photo-1668030904616-f0c576b679d6"],
  AD: ["photo-1614678096587-0ad50faf1603", "photo-1634141428610-1781a3862a9b"],
  SM: ["photo-1787520782344-96aa827f53ad", "photo-1679112600374-0ac944dabba0"],
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

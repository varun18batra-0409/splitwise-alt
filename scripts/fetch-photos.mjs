// Downloads the real photos used on the "How Loopin works" page (free
// Unsplash photos, Unsplash License: free to use, no permission needed).
// Runs during the hosting build. For each picture it tries the candidates in
// order and keeps the first that downloads, so one missing photo never breaks
// the build — that section just shows a plain colour instead.
import { mkdirSync, writeFileSync } from "node:fs";

// "photo-…" = a direct Unsplash image; anything else = an Unsplash photo page id.
const SLOTS = {
  hero: ["photo-1529156069898-49953e39b3ac", "photo-1507525428034-b723cf961d3e"], // friends arm in arm, looking out together
  roadtrip: ["photo-1469854523086-cc02fe5d8800", "photo-1506905925346-21bda4d32df4", "cktp9-mCH4Y", "Gtno2Ua6aW4"], // road trip, mountains
  dinner: ["photo-1753727471395-5ab19d4f1f6e", "photo-1669490048328-0d1e075a2b7c"], // warm, candle-lit restaurant table
  market: ["photo-1542052125323-e69ad37a47c2", "photo-1542051841857-5f90071e7989", "photo-1758272133719-959319bc2364"], // Shibuya neon at night
  train: ["photo-1777026050794-a5e4ef7cd254", "photo-1618153231956-df23dcb21c07", "photo-1474487548417-781cb71495f3"], // Japanese bullet train
  friends: ["photo-1511632765486-a01980e01a18", "photo-1529333166437-7750a6dd5a70"], // friends at sunset
  sunset: ["photo-1502602898657-3e91760cbb34", "ka14QMQlS1U", "F6RLqhPPhDQ"], // a beautiful place
  home: ["photo-1746517757473-7c88850e539b", "photo-1768488314310-3742b3c75579", "photo-1522708323590-d24dbb6b0267"], // a cosy flat
  // Group pictures (real photos you can pick for a group; see src/lib/covers.ts).
  "cover-beach": ["photo-1507525428034-b723cf961d3e", "photo-1519046904884-53103b34b206"], // turquoise beach
  "cover-mountains": ["photo-1506905925346-21bda4d32df4", "photo-1464822759023-fed622ff2c3b"], // mountains at sunrise
  "cover-city": ["photo-1542051841857-5f90071e7989", "photo-1477959858617-67f85cf4f1df"], // city lights at night
  "cover-food": ["photo-1504674900247-0877df9cc836", "photo-1414235077428-338989a2e8c0"], // a table of food
  "cover-friends": ["photo-1529156069898-49953e39b3ac", "photo-1511632765486-a01980e01a18"], // friends together
  "cover-home": ["photo-1522708323590-d24dbb6b0267", "photo-1502672260266-1c1ef2d93688"], // a bright flat
  "cover-road": ["photo-1469854523086-cc02fe5d8800", "photo-1500530855697-b586d89ba3ee"], // road trip
  "cover-lake": ["photo-1439066615861-d1af74d74000", "photo-1501785888041-af3ef285b470"], // a lake in the hills
  "cover-forest": ["photo-1441974231531-c6227db76b6e", "photo-1448375240586-882707db888b"], // sunlit forest
  "cover-snow": ["photo-1464822759023-fed622ff2c3b", "photo-1483728642387-6c3bdd6c93e5"], // snowy peaks
  "cover-paris": ["photo-1502602898657-3e91760cbb34", "photo-1499856871958-5b9627545d1a"], // Paris
  "cover-taj": ["photo-1524492412937-b28074a5d7da", "photo-1564507592333-c60657eea523"], // the Taj Mahal
  "cover-cafe": ["photo-1495474472287-4d71bcdd2085", "photo-1509042239860-f550ce710b93"], // coffee
  "cover-party": ["photo-1492684223066-81342ee5ff30", "photo-1514525253161-7a46d19cd819"], // a night out
  "cover-birthday": ["photo-1530103862676-de8c9debad1d", "photo-1558636508-e0db3814bd1d"], // balloons and cake
  "cover-wedding": ["photo-1519741497674-611481863552", "photo-1511285560929-80b456fea0bc"], // a wedding
  // The Home cards (src/lib/home/highlights.ts "scenes"): real photos behind the passport and postcards cards. None downloads: the drawn art stays.
  "card-passport": ["xzy0G_SsZDU", "htQznS-Rx7w", "LPdaW746WAw", "Cg3fyYZMQ58"], // open passports with colourful entry stamps; the last on a world map
  "card-postcards": ["dZZxUjWUx_o", "5OibzNX-6ww", "XVVSAH2CTKI"], // colour vintage postcards with handwriting and stamps
  // Destinations for the trip countdown (see src/lib/places.ts). Direct image
  // ids only: Unsplash's "download" links now need a sign-in.
  "place-goa": ["photo-1614082242765-7c98ca0f3df3"],
  "place-thailand": ["photo-1534008897995-27a23e859048"],
  "place-bali": ["photo-1555400038-63f5ba517a47"],
  "place-dubai": ["photo-1782078292081-8fb6de1c54df"],
  "place-manali": ["photo-1597167231350-d057a45dc868"],
  "place-ladakh": ["photo-1600438831035-48f5f196d3bf"],
  "place-kerala": ["photo-1563279036-8ae92c62ca4f"],
  "place-singapore": ["photo-1544625237-5d2ae46de481"],
  "place-maldives": ["photo-1691853735541-a8f1bdd2cd16"],
  "place-vietnam": ["photo-1431975071466-2c609dac5956", "photo-1487548919775-a7a460f3cbe6"],
  "place-srilanka": ["photo-1566296314736-6eaac1ca0cb9"],
  "place-japan": ["photo-1578469645742-46cae010e5d4", "photo-1707474893587-a37a9cf1b555"],
  "place-london": ["photo-1633357441498-7431babe0cc7"],
  "place-jaipur": ["photo-1524229648276-e66561fe45a9"],
  "place-nepal": ["photo-1640876522637-9432f175581f"],
  "place-andaman": ["photo-1721834058855-b9d0570722b4"],
  "place-rishikesh": ["photo-1712510817140-917938f92e5b"],
  "place-newyork": ["photo-1764344793554-12da6166d940"],
  "place-santorini": ["photo-1580502304784-8985b7eb7260", "photo-1677268357140-146d5c15307d"],
  "place-bhutan": ["photo-1761048172334-6d1475e25e8d"],
  "place-meghalaya": ["photo-1609276804051-8c5e906cc430", "photo-1723731233707-d3eb18c19303"],
  "place-switzerland": ["photo-1723276300410-113696641bab"],
};

// More pictures of each place, for the story slides (place-goa-2, place-goa-3…).
// Free Unsplash photos; one that doesn't download is simply left out.
const MORE = {
  "place-goa": ["photo-1560179406-1c6c60e0dc76", "photo-1587922546307-776227941871", "photo-1625505826533-5c80aca7d157", "photo-1512343879784-a960bf40e7f2", "photo-1642922835816-e2ac68db5c42"],
  "place-thailand": ["photo-1506665531195-3566af2b4dfa", "photo-1563492065599-3520f775eeed", "photo-1519451241324-20b4ea2c4220", "photo-1613672803979-a6edfc5a179b", "photo-1508009603885-50cf7c579365"],
  "place-bali": ["photo-1577717903315-1691ae25ab3f", "photo-1544644181-1484b3fdfc62", "photo-1573790387438-4da905039392", "photo-1554931670-4ebfabf6e7a9", "photo-1558005530-a7958896ec60"],
  "place-dubai": ["photo-1512453979798-5ea266f8880c", "photo-1518684079-3c830dcef090", "photo-1784125160488-09f633671243", "photo-1546412414-e1885259563a"],
  "place-manali": ["photo-1712388430474-ace0c16051e2", "photo-1609920658906-8223bd289001", "photo-1711359940524-ed5e0ad9b89b", "photo-1594102552386-793e5a27ad10", "photo-1648131877984-f39ebc1647f1"],
  "place-ladakh": ["photo-1619837374214-f5b9eb80876d", "photo-1581793745862-99fde7fa73d2", "photo-1617824077360-7a77db40aae1", "photo-1581280445448-ab465a010046", "photo-1600356033695-a003690a6351"],
  "place-kerala": ["photo-1602590745208-870366224847", "photo-1651298219452-d3f2c84561b3", "photo-1668522871883-d3ea92f64dbc"],
  "place-singapore": ["photo-1508964942454-1a56651d54ac", "photo-1542114740389-9b46fb1e5be7", "photo-1525625293386-3f8f99389edd", "photo-1605425183435-25b7e99104a4", "photo-1565967511849-76a60a516170"],
  "place-srilanka": ["photo-1580794749460-76f97b7180d8", "photo-1609681980718-340e7f4b11d7", "photo-1533484482814-3fe2d922be89", "photo-1544750040-4ea9b8a27d38"],
  "place-japan": ["photo-1528164344705-47542687000d", "photo-1545569341-9eb8b30979d9", "photo-1492571350019-22de08371fd3", "photo-1573455494060-c5595004fb6c", "photo-1522547902298-51566e4fb383"],
  "place-london": ["photo-1486299267070-83823f5448dd", "photo-1543832923-44667a44c804", "photo-1534359265607-b9cdb5e0a81e", "photo-1549483249-f0b359d1e289"],
  "place-jaipur": ["photo-1661924326425-c14a6426d989", "photo-1602643163983-ed0babc39797", "photo-1622225399403-548e2df0c908", "photo-1714562555125-3c8d050d5d2d"],
  "place-nepal": ["photo-1529733905113-027ed85d7e33", "photo-1518002054494-3a6f94352e9d", "photo-1748760036656-964ac32eefb4", "photo-1623492701902-47dc207df5dc"],
  "place-rishikesh": ["photo-1607406374368-809f8ec7f118", "photo-1603867106100-0d2039fc8757", "photo-1720819029162-8500607ae232", "photo-1624807136278-e2973be118ff"],
  "place-newyork": ["photo-1496588152823-86ff7695e68f", "photo-1541336032412-2048a678540d", "photo-1500916434205-0c77489c6cf7", "photo-1568515387631-8b650bbcdb90", "photo-1496442226666-8d4d0e62e6e9"],
  "place-santorini": ["photo-1509321528270-797a4f7c1485", "photo-1672622851784-0dbd3df4c088", "photo-1592468662684-0376320a0842"],
  "place-switzerland": ["photo-1634920967431-b46ec552bef1", "photo-1684050879098-87151a1ded14", "photo-1563644734741-7382a8584739"],
  "place-vietnam": ["photo-1509030450996-dd1a26dda07a", "photo-1504457047772-27faf1c00561"],
  "cover-paris": ["photo-1511739001486-6bfe10ce785f", "photo-1509439581779-6298f75bf6e5", "photo-1581683705068-ca8f49fc7f45", "photo-1499856871958-5b9627545d1a"],
  "cover-beach": ["photo-1519046904884-53103b34b206", "photo-1546484475-7f7bd55792da", "photo-1625505826533-5c80aca7d157"],
  "cover-mountains": ["photo-1464822759023-fed622ff2c3b", "photo-1605649487212-47bdab064df7", "photo-1563644734741-7382a8584739"],
  "cover-city": ["photo-1477959858617-67f85cf4f1df", "photo-1523731407965-2430cd12f5e4", "photo-1549483249-f0b359d1e289"],
  // Card nights (The Pot).
  "cards": ["photo-1541278107931-e006523892df", "photo-1636583133884-fbefc7ac3fb3", "photo-1501003878151-d3cb87799705", "photo-1596451190630-186aff535bf2", "photo-1604345250885-11f528eec3ff", "photo-1622975696911-c1c444035f43"],
};
for (const [slot, ids] of Object.entries(MORE)) ids.forEach((id, i) => (SLOTS[`${slot}-${i + 2}`] = [id]));

// Indian places: free Unsplash photos, each picked by looking at it (first is the
// place's main photo, the rest place-x-2, place-x-3…).
const INDIA = {
  "place-amritsar": ["photo-1623059508779-2542c6e83753", "photo-1517427677506-ade074eb1432"],
  "place-alibaug": ["photo-1610535791915-4d14316afc43", "photo-1613994306009-0e40e759159b"],
  "place-coorg": ["photo-1560357647-62a43d9897bb", "photo-1599922760936-e840fa373d8d"],
  "place-darjeeling": ["photo-1671711847762-b8308b444a42", "photo-1622308644420-b20142dc993c"],
  "place-delhi": ["photo-1587474260584-136574528ed5", "photo-1597040663342-45b6af3d91a5"],
  "place-gokarna": ["photo-1576440742053-8820cffa7bae", "photo-1617467053978-276d9d4d5d11"],
  "place-hampi": ["photo-1722934804353-0d9f6a55ab5e", "photo-1616606484004-5ef3cc46e39d"],
  "place-hyderabad": ["photo-1787044050216-19d30c0aeaf5", "photo-1696941515998-d83f24967aca"],
  "place-jaisalmer": ["photo-1654245363109-b873bb61b2fa", "photo-1709620220232-12ecd7ca33a8"],
  "place-kashmir": ["photo-1715457573748-8e8a70b2c1be", "photo-1598091383021-15ddea10925d"],
  "place-kolkata": ["photo-1536421469767-80559bb6f5e1", "photo-1558431382-27e303142255"],
  "place-kutch": ["photo-1669015881702-951de590db31"],
  "place-lonavala": ["photo-1589286875480-743411b84f53", "photo-1582041545006-a561d82524d9"],
  "place-mumbai": ["photo-1595658658481-d53d3f999875", "photo-1785768569545-a0b75d68006f"],
  "place-mussoorie": ["photo-1713026665246-843d870d1cdc"],
  "place-mysore": ["photo-1600112356915-089abb8fc71a", "photo-1659126574791-13313aa424bd"],
  "place-ooty": ["photo-1638886540342-240980f60d25", "photo-1707655315272-33a54a771068"],
  "place-pondicherry": ["photo-1772633634752-7b7611e839fc", "photo-1621831714462-bec8edc4d0ec"],
  "place-pune": [["photo-1707617645764-08862c06fd7f", "photo-1760034588108-987757454c18"]], // a palace with a fountain (colour) first; the Shaniwar Wada gate is black and white
  "place-sikkim": ["photo-1600402808924-9c591a6dace8", "photo-1634400001131-d04275db2076"],
  "place-udaipur": ["photo-1589901164570-f9de6556e1c1", "photo-1615836245337-f5b9b2303f10"],
  "place-varanasi": ["photo-1561359313-0639aad49ca6", "photo-1561361058-c24cecae35ca"],
  "place-corbett": ["photo-1653545607843-3411d02bc569"],
  "cover-road-in": ["photo-1651338794013-cdfa3745abe5"],
};
// An entry can also be a list of candidates for one slot (tried in order).
for (const [slot, ids] of Object.entries(INDIA)) ids.forEach((id, i) => (SLOTS[i ? `${slot}-${i + 1}` : slot] = Array.isArray(id) ? id : [id]));

// Country photos for the passport (src/lib/country-photos.ts): one slot per country, "country-xx". A country that already has a
// place photo above (TH, ID, AE, SG, MV, VN, LK, JP, GB, NP, US, GR, BT, CH, FR, IN) reuses it and has no slot here.
// Candidates per country live in scripts/photo-candidates.mjs (COUNTRY_PHOTOS): landmark or landscape, colour, no faces, no flags,
// no text. The first that downloads (and isn't black and white) is the photo. A country with no candidate yet, or none that
// downloads, simply has no photo: the passport draws its stamp on cream paper instead (never a wrong picture).
import { COUNTRY_PHOTOS } from "./photo-candidates.mjs";
for (const [code, ids] of Object.entries(COUNTRY_PHOTOS)) if (ids.length) SLOTS[`country-${code.toLowerCase()}`] = ids;

// The photo's own colour, so a group's screens can be tinted to match it: the average of its most
// colourful, mid-bright spots (sky, sea, sand, stone), measured on a tiny 12×12 copy.
async function toneOf(buf) {
  try {
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(buf).resize(12, 12, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = [];
    for (let i = 0; i + 2 < data.length; i += 3) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const l = (max + min) / 510;
      const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
      if (l > 0.18 && l < 0.85) px.push({ r, g, b, sat });
    }
    if (!px.length) return undefined;
    const top = px.sort((a, b) => b.sat - a.sat).slice(0, 24);
    const avg = (k) => Math.round(top.reduce((t, p) => t + p[k], 0) / top.length);
    return "#" + [avg("r"), avg("g"), avg("b")].map((v) => v.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined; // no image tool here: the tint falls back to what the picture shows
  }
}

// True when almost nothing in the picture has colour (fewer than 4 of 144 spots on a 12×12 copy are visibly coloured).
async function isGreyscale(buf) {
  try {
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(buf).resize(12, 12, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let coloured = 0;
    for (let i = 0; i + 2 < data.length; i += 3) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (max - min > 24) coloured++;
    }
    return coloured < 4;
  } catch {
    return false; // no image tool here: keep the picture
  }
}

const out = "public/photos";
mkdirSync(out, { recursive: true });
const got = {};
for (const [slot, ids] of Object.entries(SLOTS)) {
  for (const id of ids) {
    try {
      // Story photos fill a phone screen (a landscape picture cropped to portrait is scaled up to the screen's HEIGHT, so it needs
      // about twice the screen's width in pixels): they come at 2400 wide, q85. Group pictures and covers (also the story fallback) are 1600 / 1280.
      const big = slot.startsWith("place-") || slot.startsWith("cards");
      const url = id.startsWith("https://")
        ? id
        : id.startsWith("photo-")
        ? `https://images.unsplash.com/${id}?w=${slot.startsWith("country-") ? 960 : big ? 2400 : slot.startsWith("cover-") ? 1600 : 1280}&q=${big ? 85 : slot.startsWith("cover-") ? 80 : 75}&fm=jpg&fit=crop`
        : `https://unsplash.com/photos/${id}/download?force=true&w=${slot.startsWith("place-") ? 2400 : 1280}`;
      const UA = { "User-Agent": "LoopinBuild/1.0 (https://www.loopinapps.com; photos for trip stories)" };
      let r = await fetch(url, { redirect: "follow", headers: UA, signal: AbortSignal.timeout(20_000) });
      // Unsplash now refuses the short /download link without a key. For a short id, read the photo's own page instead and take its
      // images.unsplash.com address (the og:image), then fetch that at the size this slot needs.
      if (!r.ok && !id.startsWith("https://") && !id.startsWith("photo-")) {
        const page = await fetch(`https://unsplash.com/photos/${id}`, { redirect: "follow", headers: { ...UA, Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
        const html = page.ok ? await page.text() : "";
        const og = html.match(/property="og:image"\s+content="(https:\/\/images\.unsplash\.com\/photo-[^"?]+)/) ?? html.match(/(https:\/\/images\.unsplash\.com\/photo-\d+-[0-9a-f]+)/);
        if (og) {
          const w = slot.startsWith("country-") ? 960 : big ? 2400 : slot.startsWith("cover-") ? 1600 : 1280;
          r = await fetch(`${og[1]}?w=${w}&q=${big ? 85 : 75}&fm=jpg&fit=crop`, { redirect: "follow", headers: UA, signal: AbortSignal.timeout(20_000) });
        } else if (html.includes("plus.unsplash.com")) {
          console.log(`photos: ${slot} ✗ ${id} (Unsplash+ photo, not free)`);
          continue;
        }
      }
      const type = r.headers.get("content-type") ?? "";
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || !type.startsWith("image/") || buf.length < 20_000) {
        console.log(`photos: ${slot} ✗ ${id} (${r.status} ${type} ${buf.length} bytes)`);
        continue;
      }
      // A black-and-white picture looks dull next to the rest: skip it while another candidate is left to try.
      if (id !== ids[ids.length - 1] && (await isGreyscale(buf))) {
        console.log(`photos: ${slot} ✗ ${id} (black and white)`);
        continue;
      }
      writeFileSync(`${out}/${slot}.jpg`, buf);
      const tone = await toneOf(buf);
      got[slot] = { id, src: `/photos/${slot}.jpg`, ...(tone ? { tone } : {}) };
      console.log(`photos: ${slot} ✓ ${id} (${Math.round(buf.length / 1024)} KB)`);
      break;
    } catch (e) {
      console.log(`photos: ${slot} ✗ ${id} (${String(e).slice(0, 80)})`);
    }
  }
}
mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/photos.json", JSON.stringify(got, null, 2));
// Credits for the photos that need them (only the ones that downloaded).
console.log(`photos: ${Object.keys(got).length}/${Object.keys(SLOTS).length} ready`);

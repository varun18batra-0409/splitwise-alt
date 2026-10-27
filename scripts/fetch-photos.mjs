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

const out = "public/photos";
mkdirSync(out, { recursive: true });
const got = {};
for (const [slot, ids] of Object.entries(SLOTS)) {
  for (const id of ids) {
    try {
      const url = id.startsWith("photo-")
        ? `https://images.unsplash.com/${id}?w=${slot.startsWith("cover-") || slot.startsWith("place-") || slot.startsWith("cards") ? 900 : 1280}&q=${slot.startsWith("cover-") || slot.startsWith("place-") || slot.startsWith("cards") ? 70 : 75}&fm=jpg&fit=crop`
        : `https://unsplash.com/photos/${id}/download?force=true&w=${slot.startsWith("place-") ? 800 : 1280}`;
      const r = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Loopin build)" },
        signal: AbortSignal.timeout(20_000),
      });
      const type = r.headers.get("content-type") ?? "";
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || !type.startsWith("image/") || buf.length < 20_000) {
        console.log(`photos: ${slot} ✗ ${id} (${r.status} ${type} ${buf.length} bytes)`);
        continue;
      }
      writeFileSync(`${out}/${slot}.jpg`, buf);
      got[slot] = { id, src: `/photos/${slot}.jpg` };
      console.log(`photos: ${slot} ✓ ${id} (${Math.round(buf.length / 1024)} KB)`);
      break;
    } catch (e) {
      console.log(`photos: ${slot} ✗ ${id} (${String(e).slice(0, 80)})`);
    }
  }
}
mkdirSync("src/generated", { recursive: true });
writeFileSync("src/generated/photos.json", JSON.stringify(got, null, 2));
console.log(`photos: ${Object.keys(got).length}/${Object.keys(SLOTS).length} ready`);

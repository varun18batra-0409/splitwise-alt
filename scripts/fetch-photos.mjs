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

const out = "public/photos";
mkdirSync(out, { recursive: true });
const got = {};
for (const [slot, ids] of Object.entries(SLOTS)) {
  for (const id of ids) {
    try {
      const url = id.startsWith("photo-")
        ? `https://images.unsplash.com/${id}?w=${slot.startsWith("cover-") || slot.startsWith("place-") ? 900 : 1280}&q=${slot.startsWith("cover-") || slot.startsWith("place-") ? 70 : 75}&fm=jpg&fit=crop`
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

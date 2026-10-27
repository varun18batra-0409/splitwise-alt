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

// Indian places from Wikimedia Commons (free licences that ask for credit: the
// photographer and licence are listed on the Photo credits page).
const COMMONS = {
 "place-amritsar": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7c/Golden_Temple%2C_Amritsar_03.jpg/1280px-Golden_Temple%2C_Amritsar_03.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Bernard Gagnon",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Golden_Temple,_Amritsar_03.jpg"
 },
 "place-amritsar-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/63/Golden_Temple_nighttime.jpg/1280px-Golden_Temple_nighttime.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Marsmux",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Golden_Temple_nighttime.jpg"
 },
 "place-alibaug": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9b/Alibaug_beach_sun_set_scene.jpg/1280px-Alibaug_beach_sun_set_scene.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Gayatri Priyadarshini",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Alibaug_beach_sun_set_scene.jpg"
 },
 "place-alibaug-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/08/Alibaug_Beach.jpg/1280px-Alibaug_Beach.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Rishi Darak",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Alibaug_Beach.jpg"
 },
 "place-ahmedabad": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6d/Jama_Masjid%2C_Ahmedabad_01.jpg/1280px-Jama_Masjid%2C_Ahmedabad_01.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Bernard Gagnon",
  "license": "CC BY-SA 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:Jama_Masjid,_Ahmedabad_01.jpg"
 },
 "place-chikmagalur": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9c/Baba_Budangiri%2C_Chikmagalur_%282024%29_74.jpg/1280px-Baba_Budangiri%2C_Chikmagalur_%282024%29_74.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Gpkp",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Baba_Budangiri,_Chikmagalur_(2024)_74.jpg"
 },
 "place-chikmagalur-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/Baba_Budangiri%2C_Chikmagalur_%282024%29_44.jpg/1280px-Baba_Budangiri%2C_Chikmagalur_%282024%29_44.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Gpkp",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Baba_Budangiri,_Chikmagalur_(2024)_44.jpg"
 },
 "place-coorg": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/Rural_Road_Honnammana_Kere_Coorg_Apr24_A7C_10461.jpg/1280px-Rural_Road_Honnammana_Kere_Coorg_Apr24_A7C_10461.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "<a href=\"https://upload.wikimedia.org/wikipedia/commons/5/52/Rural_Road_Honnamma",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Rural_Road_Honnammana_Kere_Coorg_Apr24_A7C_10461.jpg"
 },
 "place-coorg-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/30/Paddy_Hills_Inakanahalli_Coorg_Nov24_A7CR_04454.jpg/1280px-Paddy_Hills_Inakanahalli_Coorg_Nov24_A7CR_04454.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Timothy A. Gonsalves",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Paddy_Hills_Inakanahalli_Coorg_Nov24_A7CR_04454.jpg"
 },
 "place-darjeeling": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/45/Tea_plantation_Darjeeling.JPG/1280px-Tea_plantation_Darjeeling.JPG?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Joydeep",
  "license": "CC BY-SA 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:Tea_plantation_Darjeeling.JPG"
 },
 "place-darjeeling-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4a/Darjeeling%2C_India%2C_Tea_plantations_on_hills.jpg/1280px-Darjeeling%2C_India%2C_Tea_plantations_on_hills.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Vyacheslav Argenberg",
  "license": "CC BY 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Darjeeling,_India,_Tea_plantations_on_hills.jpg"
 },
 "place-delhi": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/37/India_Gate_2014-11-01.jpg/1280px-India_Gate_2014-11-01.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Nikhilb239",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:India_Gate_2014-11-01.jpg"
 },
 "place-delhi-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/02/20191203_Jama_Masjid%2C_Delhi_0707_6468_DxO.jpg/1280px-20191203_Jama_Masjid%2C_Delhi_0707_6468_DxO.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Jakub Hałun",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:20191203_Jama_Masjid,_Delhi_0707_6468_DxO.jpg"
 },
 "place-gokarna": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/25/PXL_20260103_054657562.MP_Paradise_beach_gokarna_Paradise_Beach_Trail%2C_Gokarna%2C_Karnataka_581326_24.jpg/1280px-PXL_20260103_054657562.MP_Paradise_beach_gokarna_Paradise_Beach_Trail%2C_Gokarna%2C_Karnataka_581326_24.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Sourabh.biswas003",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:PXL_20260103_054657562.MP_Paradise_beach_gokarna_Paradise_Beach_Trail,_Gokarna,_Karnataka_581326_24.jpg"
 },
 "place-gokarna-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d3/PXL_20260103_054657562.MP_Paradise_beach_gokarna_Paradise_Beach_Trail%2C_Gokarna%2C_Karnataka_581326_15.jpg/1280px-PXL_20260103_054657562.MP_Paradise_beach_gokarna_Paradise_Beach_Trail%2C_Gokarna%2C_Karnataka_581326_15.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Sourabh.biswas003",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:PXL_20260103_054657562.MP_Paradise_beach_gokarna_Paradise_Beach_Trail,_Gokarna,_Karnataka_581326_15.jpg"
 },
 "place-hampi": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/Krishna_Pushkarani_-_Hampi_Ruins.jpg/1280px-Krishna_Pushkarani_-_Hampi_Ruins.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Dey.sandip",
  "license": "CC BY-SA 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:Krishna_Pushkarani_-_Hampi_Ruins.jpg"
 },
 "place-hampi-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/Hampi%2C_India%2C_Lotus_Mahal.jpg/1280px-Hampi%2C_India%2C_Lotus_Mahal.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Vyacheslav Argenberg",
  "license": "CC BY 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Hampi,_India,_Lotus_Mahal.jpg"
 },
 "place-hyderabad": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/Charminar_Hyderabad_111.jpg/1280px-Charminar_Hyderabad_111.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Joydeep",
  "license": "CC BY-SA 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:Charminar_Hyderabad_111.jpg"
 },
 "place-jaisalmer": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e9/Jaisalmer-Hotel_Desert_Tulip-26-2018-gje.jpg/1280px-Jaisalmer-Hotel_Desert_Tulip-26-2018-gje.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Gerd Eichmann",
  "license": "CC BY 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Jaisalmer-Hotel_Desert_Tulip-26-2018-gje.jpg"
 },
 "place-jaisalmer-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/52/Dawn_of_Thar_desert.jpg/1280px-Dawn_of_Thar_desert.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Dashrath09",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Dawn_of_Thar_desert.jpg"
 },
 "place-kashmir": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e1/Dal_Lake_Hazratbal_Srinagar.jpg/1280px-Dal_Lake_Hazratbal_Srinagar.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Suhail Skindar Sofi",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Dal_Lake_Hazratbal_Srinagar.jpg"
 },
 "place-kashmir-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c4/Mobile_fruit_seller_on_shikara_in_Dal_lake_%2C_Srinagar_%2CKashmir.jpg/1280px-Mobile_fruit_seller_on_shikara_in_Dal_lake_%2C_Srinagar_%2CKashmir.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Harvinder Chandigarh",
  "license": "CC BY 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Mobile_fruit_seller_on_shikara_in_Dal_lake_,_Srinagar_,Kashmir.jpg"
 },
 "place-kodaikanal": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/55/Kodaikanal_Lake_View.JPG/1280px-Kodaikanal_Lake_View.JPG?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Marcus334",
  "license": "CC BY-SA 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:Kodaikanal_Lake_View.JPG"
 },
 "place-kolkata": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Howrah_Bridge_Kolkata_Photography_by_Argha_Mallick_02.jpg/1280px-Howrah_Bridge_Kolkata_Photography_by_Argha_Mallick_02.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Arghamallick5151",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Howrah_Bridge_Kolkata_Photography_by_Argha_Mallick_02.jpg"
 },
 "place-kutch": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ec/Rann_of_Kutch_-_White_Desert_2.jpg/1280px-Rann_of_Kutch_-_White_Desert_2.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Superfast1111",
  "license": "CC BY-SA 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:Rann_of_Kutch_-_White_Desert_2.jpg"
 },
 "place-lonavala": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f0/The_giant_fort_of_Visapur%21.jpg/1280px-The_giant_fort_of_Visapur%21.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Sumedh.dorwat",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:The_giant_fort_of_Visapur!.jpg"
 },
 "place-lonavala-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8c/Lohagad_Fort_Maharashtra.jpg/1280px-Lohagad_Fort_Maharashtra.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Rucksacktales",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Lohagad_Fort_Maharashtra.jpg"
 },
 "place-mahabaleshwar": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7c/Sunset_Dhom_Lake%2C_Mahabaleshwar_03.jpg/1280px-Sunset_Dhom_Lake%2C_Mahabaleshwar_03.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Rangan Datta Wiki",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Sunset_Dhom_Lake,_Mahabaleshwar_03.jpg"
 },
 "place-matheran": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5d/Monsoon_Majesty_Over_the_Western_Ghats.jpg/1280px-Monsoon_Majesty_Over_the_Western_Ghats.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Slizzygod",
  "license": "CC0",
  "page": "https://commons.wikimedia.org/wiki/File:Monsoon_Majesty_Over_the_Western_Ghats.jpg"
 },
 "place-matheran-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/90/Tea_plantations%2C_Chembra_peak%2C_Western_Ghats_Kerala.jpg/1280px-Tea_plantations%2C_Chembra_peak%2C_Western_Ghats_Kerala.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "ShilpiC17",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Tea_plantations,_Chembra_peak,_Western_Ghats_Kerala.jpg"
 },
 "place-mumbai": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/Marine_Lines_Mumbai_2021.jpg/1280px-Marine_Lines_Mumbai_2021.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Dr Vikramjit Kakati",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Marine_Lines_Mumbai_2021.jpg"
 },
 "place-mumbai-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2a/Taj_Hotel_Mumbai_Marine_Drive_Photo_by_Chirag_Lad.jpg/1280px-Taj_Hotel_Mumbai_Marine_Drive_Photo_by_Chirag_Lad.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Chiragslad",
  "license": "CC0",
  "page": "https://commons.wikimedia.org/wiki/File:Taj_Hotel_Mumbai_Marine_Drive_Photo_by_Chirag_Lad.jpg"
 },
 "place-mussoorie": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Mussoorie_the_nature_walk.jpg/1280px-Mussoorie_the_nature_walk.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Vishaldkapoor",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Mussoorie_the_nature_walk.jpg"
 },
 "place-mysore": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7c/Mysore_palace_front_view_001.jpg/1280px-Mysore_palace_front_view_001.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "<td valig",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Mysore_palace_front_view_001.jpg"
 },
 "place-mysore-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/de/Mysore_palace_gate.jpg/1280px-Mysore_palace_gate.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "<td valig",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Mysore_palace_gate.jpg"
 },
 "place-nainital": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Nainital_Lake_02.jpg/1280px-Nainital_Lake_02.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Slyronit",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Nainital_Lake_02.jpg"
 },
 "place-nainital-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a4/View_of_Nainital_lake_from_Snow_View_Point.jpg/1280px-View_of_Nainital_lake_from_Snow_View_Point.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Slyronit",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:View_of_Nainital_lake_from_Snow_View_Point.jpg"
 },
 "place-ooty": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d8/Fields_Hazy_Mountains_Marlimund_Ooty_Nilgiris_Aug25_A7CR_07258.jpg/1280px-Fields_Hazy_Mountains_Marlimund_Ooty_Nilgiris_Aug25_A7CR_07258.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Timothy A. Gonsalves",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Fields_Hazy_Mountains_Marlimund_Ooty_Nilgiris_Aug25_A7CR_07258.jpg"
 },
 "place-pondicherry": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/French_Quarter%2C_Pondicherry_%285%29_%2836845125313%29.jpg/1280px-French_Quarter%2C_Pondicherry_%285%29_%2836845125313%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Richard Mortel from Riyadh, Saudi Arabia",
  "license": "CC BY 2.0",
  "page": "https://commons.wikimedia.org/wiki/File:French_Quarter,_Pondicherry_(5)_(36845125313).jpg"
 },
 "place-pondicherry-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/26/Windows_of_Pondicherry_-_White_wall%2C_Green_coloured_window_and_grills_%283%29.jpg/1280px-Windows_of_Pondicherry_-_White_wall%2C_Green_coloured_window_and_grills_%283%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "iMahesh",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Windows_of_Pondicherry_-_White_wall,_Green_coloured_window_and_grills_(3).jpg"
 },
 "place-pune": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/Khandoba_temple_Pune.jpg/1280px-Khandoba_temple_Pune.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "PKharote",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Khandoba_temple_Pune.jpg"
 },
 "place-sikkim": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/eb/View_of_Gangtok_city_from_Ropeway.jpg/1280px-View_of_Gangtok_city_from_Ropeway.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Subhrajyoti07",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:View_of_Gangtok_city_from_Ropeway.jpg"
 },
 "place-sikkim-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6f/View_of_Gangtok_City_from_Crown_Prince_Tenzing_Kunzang_Namgyal_Walkway.jpg/1280px-View_of_Gangtok_City_from_Crown_Prince_Tenzing_Kunzang_Namgyal_Walkway.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Subhrajyoti07",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:View_of_Gangtok_City_from_Crown_Prince_Tenzing_Kunzang_Namgyal_Walkway.jpg"
 },
 "place-udaipur": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/07/Taj_Lake_Palace_Udaipur_from_City_Palace.jpg/1280px-Taj_Lake_Palace_Udaipur_from_City_Palace.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Navneet Sharma",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Taj_Lake_Palace_Udaipur_from_City_Palace.jpg"
 },
 "place-udaipur-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/Lake_Pichola_at_sunset%2C_Udaipur%2C_Rajasthan%2C_India.jpg/1280px-Lake_Pichola_at_sunset%2C_Udaipur%2C_Rajasthan%2C_India.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "UnpetitproleX",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Lake_Pichola_at_sunset,_Udaipur,_Rajasthan,_India.jpg"
 },
 "place-varanasi": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3a/Varanasi_Munshi_Ghat3.jpg/1280px-Varanasi_Munshi_Ghat3.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Marcin Białek",
  "license": "CC BY-SA 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:Varanasi_Munshi_Ghat3.jpg"
 },
 "place-varanasi-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/Varanasi_2010_Ahilyabai_Ghat.jpg/1280px-Varanasi_2010_Ahilyabai_Ghat.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Marcin Białek",
  "license": "CC BY-SA 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:Varanasi_2010_Ahilyabai_Ghat.jpg"
 },
 "place-corbett": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/ca/Elephants_Grass_Sal_Dhikala_Corbett_Reserve_Dec2019_R16_02266.jpg/1280px-Elephants_Grass_Sal_Dhikala_Corbett_Reserve_Dec2019_R16_02266.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Timothy Gonsalves",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Elephants_Grass_Sal_Dhikala_Corbett_Reserve_Dec2019_R16_02266.jpg"
 },
 "place-corbett-2": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cc/Morning_Mist_Dhikala_Corbett_Reserve_Dec2019_R16_02285.jpg/1280px-Morning_Mist_Dhikala_Corbett_Reserve_Dec2019_R16_02285.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Timothy Gonsalves",
  "license": "CC BY-SA 4.0",
  "page": "https://commons.wikimedia.org/wiki/File:Morning_Mist_Dhikala_Corbett_Reserve_Dec2019_R16_02285.jpg"
 },
 "cover-road-in": {
  "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/60/A_Road_To_Heaven_%28234761269%29.jpeg/1280px-A_Road_To_Heaven_%28234761269%29.jpeg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "by": "Mann Mishra",
  "license": "CC BY 3.0",
  "page": "https://commons.wikimedia.org/wiki/File:A_Road_To_Heaven_(234761269).jpeg"
 }
};
for (const [slot, c] of Object.entries(COMMONS)) SLOTS[slot] = [c.url];

const out = "public/photos";
mkdirSync(out, { recursive: true });
const got = {};
for (const [slot, ids] of Object.entries(SLOTS)) {
  for (const id of ids) {
    try {
      // Story photos fill a phone screen, so they come sharper (1400 wide); group pictures are small.
      const big = slot.startsWith("place-") || slot.startsWith("cards");
      const url = id.startsWith("https://")
        ? id
        : id.startsWith("photo-")
        ? `https://images.unsplash.com/${id}?w=${big ? 1400 : slot.startsWith("cover-") ? 900 : 1280}&q=${big ? 80 : slot.startsWith("cover-") ? 70 : 75}&fm=jpg&fit=crop`
        : `https://unsplash.com/photos/${id}/download?force=true&w=${slot.startsWith("place-") ? 800 : 1280}`;
      const r = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "LoopinBuild/1.0 (https://www.loopinapps.com; photos for trip stories)" },
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
// Credits for the photos that need them (only the ones that downloaded).
writeFileSync("src/generated/photo-credits.json", JSON.stringify(Object.fromEntries(Object.entries(COMMONS).filter(([slot]) => got[slot]).map(([slot, c]) => [slot, { by: c.by, license: c.license, page: c.page }])), null, 2));
console.log(`photos: ${Object.keys(got).length}/${Object.keys(SLOTS).length} ready`);

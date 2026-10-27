# Finds good free photos of each place on Wikimedia Commons (quality images first).
import json, sys, urllib.parse, urllib.request
UA = {"User-Agent": "LoopinPhotoScout/1.0 (https://www.loopinapps.com)"}
def get(params):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json"})
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
out = {}
for line in open(sys.argv[1]).read().strip().split("\n"):
    slot, query = line.split("|")
    found = []
    for q in (f'{query} incategory:Quality_images', f'{query} incategory:Featured_pictures_on_Wikimedia_Commons', query):
        r = get({"action": "query", "generator": "search", "gsrsearch": f"filetype:bitmap {q}", "gsrnamespace": 6, "gsrlimit": 12,
                 "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 360})
        for p in sorted((r.get("query", {}).get("pages", {}) or {}).values(), key=lambda p: p.get("index", 0)):
            ii = p["imageinfo"][0]; md = ii.get("extmetadata", {})
            lic = md.get("LicenseShortName", {}).get("value", "")
            if not any(x in lic for x in ("CC0", "Public domain", "CC BY 2", "CC BY 3", "CC BY 4", "CC BY-SA")): continue
            if ii["width"] < 1600: continue
            if any(f["title"] == p["title"] for f in found): continue
            artist = md.get("Artist", {}).get("value", "")
            found.append({"title": p["title"], "thumb": ii["thumburl"], "url": ii["url"], "w": ii["width"], "h": ii["height"], "license": lic, "artist": artist[:200], "page": ii["descriptionurl"]})
        if len(found) >= 8: break
    out[slot] = found[:8]
    print(slot, len(out[slot]))
json.dump(out, open("found.json", "w"), indent=1)

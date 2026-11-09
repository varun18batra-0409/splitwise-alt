import json, re, sys, os, io, urllib.request, urllib.parse
from PIL import Image, ImageDraw, ImageFont
Q = json.load(open("queries.json"))
os.makedirs("out/sheets", exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (photo picker for a small app)", "Accept": "application/json"}
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
allData = {}
for slot, q in Q.items():
    rows = []
    for page in (1, 2):
        url = "https://unsplash.com/napi/search/photos?" + urllib.parse.urlencode({"query": q, "per_page": 20, "page": page})
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:
            print(slot, "search failed", e); break
        for r in d.get("results", []):
            if r.get("premium") or r.get("plus"): continue
            raw = r["urls"]["raw"]
            m = re.search(r"(photo-[0-9]+-[0-9a-f]+)", raw)
            if not m: continue
            rows.append({"id": m.group(1), "alt": r.get("alt_description") or r.get("description") or "", "w": r["width"], "h": r["height"]})
        if len(rows) >= 16: break
    rows = rows[:16]
    allData[slot] = rows
    tiles = []
    for i, r in enumerate(rows):
        try:
            b = urllib.request.urlopen(urllib.request.Request(f"https://images.unsplash.com/{r['id']}?w=360&h=240&fit=crop&q=60", headers=UA), timeout=30).read()
            im = Image.open(io.BytesIO(b)).convert("RGB").resize((360, 240))
        except Exception as e:
            im = Image.new("RGB", (360, 240), (60, 0, 0))
        dr = ImageDraw.Draw(im)
        dr.rectangle([0, 0, 40, 30], fill=(0, 0, 0))
        dr.text((6, 3), str(i), fill=(255, 255, 0), font=font)
        tiles.append(im)
    if not tiles: continue
    cols = 4
    sheet = Image.new("RGB", (cols * 364, ((len(tiles) + cols - 1) // cols) * 244 + 40), (20, 20, 20))
    ImageDraw.Draw(sheet).text((8, 8), f"{slot}  ({q})", fill=(255, 255, 255), font=font)
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * 364, 40 + (i // cols) * 244))
    sheet.save(f"out/sheets/{slot}.jpg", quality=70)
    print(slot, len(rows))
json.dump(allData, open("out/data.json", "w"), indent=1)

import json, re, sys, os, io, urllib.request, urllib.parse
from PIL import Image, ImageDraw, ImageFont
Q = json.load(open("queries.json"))
os.makedirs("out/sheets", exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (photo picker for a small app)", "Accept": "application/json"}
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
allData = {}
for slot, q in Q.items():
    rows = []
    slug = urllib.parse.quote(q.lower().replace(" ", "-"))
    try:
        html = urllib.request.urlopen(urllib.request.Request(f"https://unsplash.com/s/photos/{slug}", headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept": "text/html", "Accept-Language": "en"}), timeout=30).read().decode("utf-8", "ignore")
    except Exception as e:
        print(slot, "search failed", e); html = ""
    seen = set()
    for tag in re.findall(r"<img[^>]+>", html):
        m = re.search(r'src="https://images\.unsplash\.com/(photo-[0-9]+-[0-9a-f]+)', tag)
        if not m or m.group(1) in seen: continue
        alt = re.search(r'alt="([^"]*)"', tag)
        seen.add(m.group(1))
        rows.append({"id": m.group(1), "alt": (alt.group(1) if alt else "")})
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

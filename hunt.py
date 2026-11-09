import json, os, io, urllib.request
from PIL import Image, ImageDraw, ImageFont
C = json.load(open("cands.json"))
os.makedirs("out", exist_ok=True)
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
tiles = []
for slot, ids in C.items():
    for i, pid in enumerate(ids):
        try:
            b = urllib.request.urlopen(urllib.request.Request(f"https://images.unsplash.com/photo-{pid}?w=300&h=200&fit=crop&q=60", headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read()
            im = Image.open(io.BytesIO(b)).convert("RGB").resize((300, 200))
        except Exception as e:
            print(slot, pid, "FAILED", e); im = Image.new("RGB", (300, 200), (90, 0, 0))
        dr = ImageDraw.Draw(im); dr.rectangle([0, 0, 300, 26], fill=(0, 0, 0)); dr.text((5, 2), f"{slot} {i}", fill=(255, 255, 0), font=font)
        tiles.append(im)
cols = 5
for part in range(0, len(tiles), 30):
    chunk = tiles[part:part + 30]
    sheet = Image.new("RGB", (cols * 304, ((len(chunk) + cols - 1) // cols) * 204), (20, 20, 20))
    for i, t in enumerate(chunk): sheet.paste(t, ((i % cols) * 304, (i // cols) * 204))
    sheet.save(f"out/sheet{part // 30}.jpg", quality=72)
print(len(tiles))

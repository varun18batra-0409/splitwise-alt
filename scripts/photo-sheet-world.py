# Contact sheets for the world travel destinations photo list (CI only). Reads scripts/photo-sheet-world.json; writes world-N.png.
import io, json, sys, time, urllib.request, os
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BG, FG, DIM, GREY = (13,13,15), (238,238,240), (150,150,158), (70,70,76)
TW, TH, CW, PAD = 230, 155, 238, 14
COLS = 4  # up to 4 candidates per place (A-D)
BLOCK_W, BLOCK_H = COLS*CW + 30, 24+TH+66
def font(s, b=False):
    for p in (f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if b else ''}.ttf",):
        if os.path.exists(p): return ImageFont.truetype(p, s)
    return ImageFont.load_default()
F_S, F_T, F_SM = font(16, True), font(24, True), font(11)
cache, log = {}, []
def fetch(pid):
    if pid in cache: return cache[pid]
    img, err = None, ""
    for _ in range(3):
        try:
            rq = urllib.request.Request(f"https://images.unsplash.com/{pid}?w=640&q=70&fm=jpg&fit=crop", headers={"User-Agent": "LoopinBuild/1.0 (photo contact sheet)"})
            img = Image.open(io.BytesIO(urllib.request.urlopen(rq, timeout=25).read())).convert("RGB"); log.append(f"ok   {pid}"); break
        except Exception as e:
            err = str(e)[:80]; time.sleep(1.5)
    if img is None: log.append(f"FAIL {pid} {err}")
    cache[pid] = img; return img
def thumb(pid):
    img = fetch(pid)
    if img is None:
        t = Image.new("RGB", (TW, TH), GREY); d = ImageDraw.Draw(t); m = "didn't download"
        d.text(((TW-d.textlength(m, font=F_S))/2, TH/2-8), m, font=F_S, fill=FG); return t
    r = max(TW/img.width, TH/img.height); img = img.resize((int(img.width*r)+1, int(img.height*r)+1), Image.LANCZOS)
    x, y = (img.width-TW)//2, (img.height-TH)//2; return img.crop((x, y, x+TW, y+TH))
def wrap(d, t, f, w):
    out, cur = [], ""
    for wd in t.split():
        s = (cur+" "+wd).strip()
        if d.textlength(s, font=f) <= w: cur = s
        else: out.append(cur); cur = wd
    return out + ([cur] if cur else [])
for g in json.load(open("scripts/photo-sheet-world.json"))["groups"]:
    rows = g["rows"]; nrows = (len(rows)+1)//2
    im = Image.new("RGB", (2*BLOCK_W+PAD, 60+nrows*BLOCK_H), BG); d = ImageDraw.Draw(im)
    d.text((PAD, 16), g["title"], font=F_T, fill=FG)
    for i, row in enumerate(rows):
        bx, by = PAD + (i%2)*BLOCK_W, 60 + (i//2)*BLOCK_H
        d.text((bx, by), row["slot"] + (("  (" + row["note"] + ")") if row.get("note") else ""), font=F_S, fill=FG)
        cells = [("now", n) for n in row["now"]] + [("c", c) for c in row["cands"][:4]]
        k = 0
        for kind, it in cells:
            x = bx + k*CW; k += 1
            im.paste(thumb(it["id"]), (x, by+24))
            if kind == "now":
                d.text((x, by+24+TH+3), it["label"], font=F_SM, fill=DIM)
            else:
                letter = "ABCD"[sum(1 for kk, _ in cells[:k] if kk == "c")-1]
                d.text((x, by+24+TH+3), letter, font=F_S, fill=(255,214,102))
                for j, l in enumerate(wrap(d, it["desc"], F_SM, TW-18)[:4]): d.text((x+18, by+24+TH+6+j*13), l, font=F_SM, fill=FG)
    im.save(os.path.join(OUT, g["file"])); print("wrote", g["file"], im.size)
open(os.path.join(OUT, "download-log-world.txt"), "w").write("\n".join(log)+"\n")

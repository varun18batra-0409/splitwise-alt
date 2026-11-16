# Builds the photo contact sheets (CI only; this machine cannot download images).
# Reads scripts/photo-sheet.json, downloads each photo at w=640, writes one PNG per group to the folder given as argv[1].
import io, json, sys, time, urllib.request, os
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
BG, FG, DIM, GREY = (13, 13, 15), (238, 238, 240), (150, 150, 158), (70, 70, 76)
TW, TH = 300, 200
CELL_W, PAD, LEFT = TW + 14, 14, 200
N_NOW, N_CAND = 2, 4

def font(size, bold=False):
    for p in (f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf",
              f"/usr/share/fonts/truetype/liberation/LiberationSans-{'Bold' if bold else 'Regular'}.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

F_T, F_S, F_B, F_SM = font(26, True), font(18, True), font(14), font(12)
cache, log = {}, []

def fetch(pid):
    if pid in cache:
        return cache[pid]
    url = f"https://images.unsplash.com/{pid}?w=640&q=70&fm=jpg&fit=crop"
    img = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "LoopinBuild/1.0 (photo contact sheet)"})
            with urllib.request.urlopen(req, timeout=25) as r:
                data = r.read()
            img = Image.open(io.BytesIO(data)).convert("RGB")
            log.append(f"ok   {pid} {img.size}")
            break
        except Exception as e:
            err = str(e)[:80]
            time.sleep(1.5)
    if img is None:
        log.append(f"FAIL {pid} {err}")
    cache[pid] = img
    return img

def thumb(pid):
    img = fetch(pid)
    if img is None:
        t = Image.new("RGB", (TW, TH), GREY)
        d = ImageDraw.Draw(t)
        msg = "didn't download"
        w = d.textlength(msg, font=F_S)
        d.text(((TW - w) / 2, TH / 2 - 10), msg, font=F_S, fill=FG)
        return t
    # centre-crop to the box
    r = max(TW / img.width, TH / img.height)
    img = img.resize((int(img.width * r) + 1, int(img.height * r) + 1), Image.LANCZOS)
    x, y = (img.width - TW) // 2, (img.height - TH) // 2
    return img.crop((x, y, x + TW, y + TH))

def wrap(d, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines

ROW_H = 20 + TH + 8 + 18 + 4 * 17 + 22
for g in json.load(open("scripts/photo-sheet.json"))["groups"]:
    width = LEFT + (N_NOW + N_CAND) * CELL_W + PAD
    height = 70 + len(g["rows"]) * ROW_H
    im = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(im)
    d.text((PAD, 20), g["title"], font=F_T, fill=FG)
    y = 70
    for row in g["rows"]:
        d.line((PAD, y, width - PAD, y), fill=(40, 40, 46))
        ty = y + 14
        for i, l in enumerate(wrap(d, row["slot"], F_S, LEFT - 20)):
            d.text((PAD, ty + i * 22), l, font=F_S, fill=FG)
        for i, l in enumerate(wrap(d, row.get("note", ""), F_SM, LEFT - 24)):
            d.text((PAD, ty + 50 + i * 15), l, font=F_SM, fill=DIM)
        for k in range(N_NOW):
            x = LEFT + k * CELL_W
            if k < len(row["now"]):
                n = row["now"][k]
                im.paste(thumb(n["id"]), (x, ty))
                d.text((x, ty + TH + 6), n["label"], font=F_B, fill=DIM)
                d.text((x, ty + TH + 24), n["id"][6:20] + "…", font=F_SM, fill=GREY)
        for k, c in enumerate(row["cands"][:N_CAND]):
            x = LEFT + (N_NOW + k) * CELL_W
            im.paste(thumb(c["id"]), (x, ty))
            d.text((x, ty + TH + 6), "ABCD"[k], font=F_S, fill=(255, 214, 102))
            d.text((x + 24, ty + TH + 8), c["id"][6:20] + "…", font=F_SM, fill=GREY)
            for i, l in enumerate(wrap(d, c["desc"], F_SM, TW)[:4]):
                d.text((x, ty + TH + 30 + i * 15), l, font=F_SM, fill=FG)
        y += ROW_H
    im.save(os.path.join(OUT, g["file"]))
    print("wrote", g["file"], im.size)

open(os.path.join(OUT, "download-log.txt"), "w").write("\n".join(log) + "\n")
print("\n".join(log))

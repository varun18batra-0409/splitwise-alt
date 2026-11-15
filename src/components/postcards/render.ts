"use client";

import { lookCss, touchesOn, waxSeal, wordsAtOf, wordsSizeOf } from "@/lib/postcards/looks";
import { handOf, inkColor, paperTones, letteringOf, toneOf, postmarkSvg, printSvg, stampSvg, WAVES_SVG } from "@/lib/postcards/catalog";
import { ONESIDE, ONESIDE_SIGN, ONESIDE_STAMP, ONESIDE_WAVES, fitOf, photoSizeOf } from "@/lib/postcards/format";
import { oneSideFont } from "@/lib/postcards/fit";
import type { BackProps, FrontProps } from "./Card";
import type { OneSideProps } from "./OneSide";

// The postcard as two pictures (1500 × 1000), drawn on the phone with the same fonts and art as on
// screen: for WhatsApp, or to save. The front first, then the back.
const W = 1500;
const H = 1000;

function svgImage(svg: string): Promise<HTMLImageElement> {
  return loadImage(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}
function cover(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / im.width, h / im.height);
  const iw = im.width * s;
  const ih = im.height * s;
  ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
async function touches(ctx: CanvasRenderingContext2D, raw: string | undefined, side: "front" | "back" | "oneside", ox: number, oy: number, w: number, h: number, seal = "", initial = "") {
  for (const t of touchesOn(raw, side)) {
    const im = await svgImage(t.id === "seal" ? waxSeal(seal, initial, "x") : t.svg);
    const tw = w * t.w;
    const th = tw * (im.height / im.width || 1);
    ctx.save();
    ctx.translate(ox + w * t.x + tw / 2, oy + h * t.y + th / 2);
    ctx.rotate((t.rot * Math.PI) / 180);
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.drawImage(im, -tw / 2, -th / 2, tw, th);
    ctx.restore();
  }
}
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) {
  const g = document.createElement("canvas");
  g.width = 200;
  g.height = 200;
  const c = g.getContext("2d")!;
  const d = c.createImageData(200, 200);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 120 + Math.random() * 60;
    d.data[i] = v;
    d.data[i + 1] = v * 0.85;
    d.data[i + 2] = v * 0.6;
    d.data[i + 3] = Math.random() * 255 * alpha;
  }
  c.putImageData(d, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = ctx.createPattern(g, "repeat")!;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

// A white-edged print, tilted, with a strip of tape on its top edge. (cx, cy) is its middle; pw its width; the picture inside has
// the proportions `aspect` (width / height); padSide and padBottom are the white border as shares of the print's width.
function drawPrint(ctx: CanvasRenderingContext2D, media: HTMLImageElement | null, filter: string, cx: number, cy: number, pw: number, aspect: number, padSide: number, padBottom: number, rotDeg: number, tapeW: number, tapeH: number) {
  const pad = pw * padSide;
  const iw = pw - pad * 2;
  const ih = iw / aspect;
  const ph = pad + ih + pw * padBottom;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.shadowColor = "rgba(40,30,10,0.5)";
  ctx.shadowBlur = pw * 0.05;
  ctx.shadowOffsetY = pw * 0.02;
  ctx.fillStyle = "#fbf8f1";
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  ctx.shadowColor = "transparent";
  ctx.save();
  ctx.beginPath();
  ctx.rect(-pw / 2 + pad, -ph / 2 + pad, iw, ih);
  ctx.clip();
  if (filter !== "none") ctx.filter = filter;
  if (media) cover(ctx, media, -pw / 2 + pad, -ph / 2 + pad, iw, ih);
  ctx.filter = "none";
  ctx.restore();
  ctx.rotate((-6 * Math.PI) / 180);
  ctx.fillStyle = "rgba(226,212,170,0.82)";
  ctx.fillRect(-tapeW / 2, -ph / 2 - tapeH / 2, tapeW, tapeH);
  ctx.restore();
}

export async function drawFront(p: FrontProps): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#e9e2d4";
  ctx.fillRect(0, 0, W, H);
  const print = p.front.startsWith("print:") ? p.front.slice(6) : "";
  const img = !print ? p.photo || (p.front.startsWith("photo:") ? p.front.slice(6) : "") : "";
  const f = lookCss(p.look ?? "");
  const fit = fitOf(p.fit);
  const at = wordsAtOf(p.wordsAt ?? "bottom");
  const t = toneOf(p.tone ?? "white");
  const media = print ? await svgImage(printSvg(print, "x")) : img ? await loadImage(img) : null;
  // The soft shade behind light words, over the rectangle (x, y, w, h) the picture fills.
  const shade = (x: number, y: number, w: number, h: number) => {
    if (!(img && p.words && !t.dark)) return;
    const g = at === "top" ? ctx.createLinearGradient(0, y + h * 0.55, 0, y) : at === "middle" ? ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.6) : ctx.createLinearGradient(0, y + h * 0.45, 0, y + h);
    g.addColorStop(0, at === "middle" ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0)");
    g.addColorStop(1, at === "middle" ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  if (fit === "full") {
    if (f !== "none") ctx.filter = f;
    if (media) cover(ctx, media, 0, 0, W, H);
    ctx.filter = "none";
    shade(0, 0, W, H);
  } else if (fit === "border") {
    ctx.fillStyle = "#f4f0e6";
    ctx.fillRect(0, 0, W, H);
    const [x, y, w, h] = [W * 0.05, H * 0.05, W * 0.9, H * 0.9];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (f !== "none") ctx.filter = f;
    if (media) cover(ctx, media, x, y, w, h);
    ctx.filter = "none";
    shade(x, y, w, h);
    ctx.restore();
  } else {
    drawPrint(ctx, media, f, W / 2, H / 2, W * 0.62, print ? 3 / 2 : 4 / 3, 1.6 / 62, 6 / 62, -3, W * 0.16, W * 0.046);
  }
  grain(ctx, W, H, 0.12);
  if (fit === "full") {
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(W * 0.032, W * 0.032, W - W * 0.064, H - W * 0.064);
  }
  if (p.words) {
    const l = letteringOf(p.lettering);
    const long = p.words.length > 11;
    const size = ((W * (l.caps ? (long ? 11 : 15) : long ? 9.5 : 13.5)) / 100) * (wordsSizeOf(p.wordsSize ?? 100) / 100);
    await document.fonts.load(`${l.italic ? "italic " : ""}${Math.round(size)}px "${l.family}"`).catch(() => {});
    ctx.fillStyle = t.c;
    ctx.textAlign = "center";
    ctx.shadowColor = t.dark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 30;
    ctx.font = `600 ${Math.round(W * 0.021)}px system-ui, sans-serif`;
    const base = at === "top" ? H * 0.09 + size * 1.7 : at === "middle" ? H / 2 + size * 0.45 : H * 0.91;
    // "GREETINGS FROM", letter-spaced by hand (canvas has no letter-spacing everywhere).
    const kick = "GREETINGS FROM".split("").join(String.fromCharCode(0x200a, 0x200a));
    ctx.fillText(kick, W / 2, base - size * 0.95);
    ctx.font = `${l.italic ? "italic " : ""}${Math.round(size)}px "${l.family}", Georgia, serif`;
    ctx.fillText(p.words, W / 2, base);
    ctx.shadowColor = "transparent";
  }
  await touches(ctx, p.touches, "front", 0, 0, W, H);
  return new Promise((res) => cv.toBlob((b) => res(b!), "image/jpeg", 0.92));
}

export async function drawBack(p: BackProps): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  let ox = 0;
  let oy = 0;
  let w = W;
  let h = H;
  if (p.paper === "airmail") {
    // The striped airmail border.
    ctx.fillStyle = "#fbf7ef";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 4);
    const cols = ["#c8453a", "#fbf7ef", "#2f5fa7", "#fbf7ef"];
    for (let x = -W * 1.5, i = 0; x < W * 1.5; x += 30, i++) {
      ctx.fillStyle = cols[i % 4];
      ctx.fillRect(x, -W, 30, W * 2);
    }
    ctx.restore();
    ox = oy = W * 0.034;
    w = W - ox * 2;
    h = H - oy * 2;
  }
  const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, w * 1.2);
  const [p0, p1, p2] = paperTones(p.paper);
  g.addColorStop(0, p0);
  g.addColorStop(0.7, p1);
  g.addColorStop(1, p2);
  ctx.fillStyle = g;
  ctx.fillRect(ox, oy, w, h);
  const X = (f: number) => ox + w * f;
  const Y = (f: number) => oy + h * f;
  // Heading and the dividing rule.
  ctx.fillStyle = "#6c6455";
  ctx.font = `${Math.round(w * 0.026)}px Georgia, serif`;
  ctx.textBaseline = "top";
  ctx.fillText("P O S T   C A R D", X(0.06), Y(0.07));
  ctx.fillStyle = "#bfb39b";
  ctx.fillRect(X(0.56), Y(0.22), 2, h * 0.68);
  // Postmark waves, postmark, stamp.
  const waves = await svgImage(WAVES_SVG);
  ctx.globalAlpha = 0.4;
  ctx.drawImage(waves, X(0.61), Y(0.3), w * 0.34, w * 0.085);
  ctx.globalAlpha = 0.55;
  const pm = await svgImage(postmarkSvg(p.place || "Loopin", p.date, "x"));
  ctx.save();
  ctx.translate(X(0.713), Y(0.2));
  ctx.rotate((-12 * Math.PI) / 180);
  ctx.drawImage(pm, -w * 0.075, -w * 0.075, w * 0.15, w * 0.15);
  ctx.restore();
  ctx.globalAlpha = 1;
  const st = await svgImage(stampSvg(p.stamp, "x"));
  ctx.save();
  ctx.translate(X(0.8725), Y(0.07) + w * 0.082);
  ctx.rotate((2 * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4;
  ctx.drawImage(st, -w * 0.0675, -w * 0.082, w * 0.135, w * 0.163);
  ctx.restore();
  // The message and the address, in handwriting.
  const hand = handOf(p.hand);
  const fs = Math.round(w * 0.041 * hand.size);
  await document.fonts.load(`${fs}px "${hand.family}"`).catch(() => {});
  ctx.fillStyle = inkColor(p.ink ?? "navy");
  ctx.font = `${fs}px "${hand.family}", cursive`;
  const lines = wrap(ctx, p.message, w * 0.47);
  lines.push("", `— ${p.from}`);
  let y = Y(0.19);
  for (const line of lines) {
    if (y > Y(0.9)) break;
    ctx.fillText(line, X(0.06), y);
    y += fs * 1.28;
  }
  const as = Math.round(w * 0.037 * hand.size);
  ctx.font = `${as}px "${hand.family}", cursive`;
  for (let i = 0; i < 3; i++) {
    const ly = Y(0.89) - (2 - i) * (as * 1.15 + w * 0.026);
    ctx.fillStyle = "#bfb39b";
    ctx.fillRect(X(0.6), ly, w * 0.34, 2);
    ctx.fillStyle = inkColor(p.ink ?? "navy");
    ctx.textBaseline = "bottom";
    // Shrink a long line until it fits the space (no squashing), but never below 62% of the size (same as the on-screen card):
    // a line that is still too long after that breaks onto a second row above the rule, at a word boundary.
    const line = p.address[i] ?? "";
    let fsz = as;
    ctx.font = `${fsz}px "${hand.family}", cursive`;
    while (fsz > as * 0.62 && ctx.measureText(line).width > w * 0.34) {
      fsz -= 1;
      ctx.font = `${fsz}px "${hand.family}", cursive`;
    }
    if (ctx.measureText(line).width > w * 0.34 && line.includes(" ")) {
      const words = line.split(" ");
      let cut = words.length - 1;
      while (cut > 1 && ctx.measureText(words.slice(0, cut).join(" ")).width > w * 0.34) cut--;
      ctx.fillText(words.slice(0, cut).join(" "), X(0.6), ly - 4 - fsz * 1.1);
      ctx.fillText(words.slice(cut).join(" "), X(0.6), ly - 4);
    } else ctx.fillText(line, X(0.6), ly - 4);
    ctx.font = `${as}px "${hand.family}", cursive`;
    ctx.textBaseline = "top";
  }
  await touches(ctx, p.touches, "back", ox, oy, w, h, p.seal ?? "", p.from);
  grain(ctx, W, H, 0.08);
  return new Promise((res) => cv.toBlob((b) => res(b!), "image/jpeg", 0.92));
}

// A one-side card as one picture (1500 × 1000), laid out with the same numbers as the on-screen card.
export async function drawOneSide(p: OneSideProps): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  const size = photoSizeOf(p.size);
  const g = ONESIDE[size];
  let ox = 0;
  let oy = 0;
  let w = W;
  let h = H;
  if (p.paper === "airmail") {
    ctx.fillStyle = "#fbf7ef";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 4);
    const cols = ["#c8453a", "#fbf7ef", "#2f5fa7", "#fbf7ef"];
    for (let x = -W * 1.5, i = 0; x < W * 1.5; x += 30, i++) {
      ctx.fillStyle = cols[i % 4];
      ctx.fillRect(x, -W, 30, W * 2);
    }
    ctx.restore();
    ox = oy = W * 0.034;
    w = W - ox * 2;
    h = H - oy * 2;
  }
  const X = (f: number) => ox + w * f;
  const Y = (f: number) => oy + h * f;
  const gr = ctx.createRadialGradient(ox, oy, 0, ox, oy, w * 1.2);
  const [p0, p1, p2] = paperTones(p.paper);
  gr.addColorStop(0, p0);
  gr.addColorStop(0.7, p1);
  gr.addColorStop(1, p2);
  ctx.fillStyle = gr;
  ctx.fillRect(ox, oy, w, h);
  // The taped print.
  const print = p.front.startsWith("print:") ? p.front.slice(6) : "";
  const img = !print ? p.photo || (p.front.startsWith("photo:") ? p.front.slice(6) : "") : "";
  const media = print ? await svgImage(printSvg(print, "x")) : img ? await loadImage(img) : null;
  const pw = w * g.print.w;
  const pad = pw * 0.042;
  const iw = pw - pad * 2;
  const ih = iw * (20 / 27);
  const ph = pad + ih + pw * 0.153;
  ctx.save();
  // Turned about its middle, as on screen.
  ctx.translate(X(g.print.x) + pw / 2, Y(g.print.y) + ph / 2);
  ctx.rotate((g.print.rot * Math.PI) / 180);
  ctx.shadowColor = "rgba(40,30,10,0.5)";
  ctx.shadowBlur = pw * 0.05;
  ctx.shadowOffsetY = pw * 0.02;
  ctx.fillStyle = "#fbf8f1";
  ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.rect(-pw / 2 + pad, -ph / 2 + pad, iw, ih);
  ctx.clip();
  const f = lookCss(p.look ?? "");
  if (f !== "none") ctx.filter = f;
  if (media) cover(ctx, media, -pw / 2 + pad, -ph / 2 + pad, iw, ih);
  ctx.filter = "none";
  ctx.restore();
  ctx.save();
  ctx.translate(X(g.tape.x) + (w * g.tape.w) / 2, Y(g.tape.y) + (h * g.tape.h) / 2);
  ctx.rotate((g.tape.rot * Math.PI) / 180);
  ctx.fillStyle = "rgba(226,212,170,0.82)";
  ctx.fillRect(-(w * g.tape.w) / 2, -(h * g.tape.h) / 2, w * g.tape.w, h * g.tape.h);
  ctx.restore();
  // Waves, postmark, stamp.
  const waves = await svgImage(WAVES_SVG);
  ctx.globalAlpha = 0.4;
  ctx.drawImage(waves, X(1 - ONESIDE_WAVES.right - ONESIDE_WAVES.w), Y(ONESIDE_WAVES.top), w * ONESIDE_WAVES.w, w * ONESIDE_WAVES.w * 0.25);
  ctx.globalAlpha = 0.6;
  const pm = await svgImage(postmarkSvg(p.place || "Loopin", p.date, "x"));
  ctx.save();
  ctx.translate(X(1 - 0.175 - 0.06), Y(0.035) + w * 0.06);
  ctx.rotate((-12 * Math.PI) / 180);
  ctx.drawImage(pm, -w * 0.06, -w * 0.06, w * 0.12, w * 0.12);
  ctx.restore();
  ctx.globalAlpha = 1;
  const st = await svgImage(stampSvg(p.stamp, "x"));
  const sw = w * ONESIDE_STAMP.w;
  const sh = sw * (92 / 76);
  ctx.save();
  ctx.translate(X(1 - ONESIDE_STAMP.right) - sw / 2, Y(ONESIDE_STAMP.top) + sh / 2);
  ctx.rotate((2 * Math.PI) / 180);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 4;
  ctx.drawImage(st, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  // The note, centred in its box, and the sign-off.
  const hand = handOf(p.hand);
  const { f: nf } = oneSideFont(p.message.trim(), hand.size, size);
  const fs = Math.round(w * nf);
  await document.fonts.load(`${fs}px "${hand.family}"`).catch(() => {});
  ctx.fillStyle = inkColor(p.ink ?? "navy");
  ctx.font = `${fs}px "${hand.family}", cursive`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const lines = wrap(ctx, p.message.trim(), w * g.note.w);
  const boxTop = Y(g.note.top);
  const boxH = h * (g.note.bottom - g.note.top);
  let y = boxTop + Math.max(0, (boxH - lines.length * fs * 1.12) / 2);
  for (const line of lines) {
    ctx.fillText(line, X(g.note.x), y);
    y += fs * 1.12;
  }
  const sf = Math.round(w * 0.058 * (hand.size / 1.12));
  ctx.font = `${sf}px "${hand.family}", cursive`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`\u2014 ${p.from}`, X(1 - ONESIDE_SIGN.right), Y(1 - ONESIDE_SIGN.bottom));
  ctx.textAlign = "left";
  await touches(ctx, p.touches, "oneside", ox, oy, w, h, p.seal ?? "", p.from);
  grain(ctx, W, H, 0.08);
  return new Promise((res) => cv.toBlob((b) => res(b!), "image/jpeg", 0.92));
}

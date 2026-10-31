"use client";

import { handOf, inkColor, paperTones, letteringOf, postmarkSvg, printSvg, stampSvg, WAVES_SVG } from "@/lib/postcards/catalog";
import type { BackProps, FrontProps } from "./Card";

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

export async function drawFront(p: FrontProps): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#e9e2d4";
  ctx.fillRect(0, 0, W, H);
  const print = p.front.startsWith("print:") ? p.front.slice(6) : "";
  const img = !print ? p.photo || (p.front.startsWith("photo:") ? p.front.slice(6) : "") : "";
  if (print) cover(ctx, await svgImage(printSvg(print, "x")), 0, 0, W, H);
  else if (img) cover(ctx, await loadImage(img), 0, 0, W, H);
  if (img && p.words) {
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  grain(ctx, W, H, 0.12);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(W * 0.032, W * 0.032, W - W * 0.064, H - W * 0.064);
  if (p.words) {
    const l = letteringOf(p.lettering);
    const long = p.words.length > 11;
    const size = (W * (l.caps ? (long ? 11 : 15) : long ? 9.5 : 13.5)) / 100;
    await document.fonts.load(`${l.italic ? "italic " : ""}${Math.round(size)}px "${l.family}"`).catch(() => {});
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 30;
    ctx.font = `600 ${Math.round(W * 0.021)}px system-ui, sans-serif`;
    const base = H * 0.91;
    // "GREETINGS FROM", letter-spaced by hand (canvas has no letter-spacing everywhere).
    const kick = "GREETINGS FROM".split("").join(String.fromCharCode(0x200a, 0x200a));
    ctx.fillText(kick, W / 2, base - size * 0.95);
    ctx.font = `${l.italic ? "italic " : ""}${Math.round(size)}px "${l.family}", Georgia, serif`;
    ctx.fillText(p.words, W / 2, base);
  }
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
  ctx.translate(X(0.775), Y(0.21));
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
    ctx.fillText(p.address[i] ?? "", X(0.6), ly - 4, w * 0.34);
    ctx.textBaseline = "top";
  }
  grain(ctx, W, H, 0.08);
  return new Promise((res) => cv.toBlob((b) => res(b!), "image/jpeg", 0.92));
}

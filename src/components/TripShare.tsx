"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { dateRange, reportText, type TripReport } from "@/lib/trip-report";
import { primaryButtonClass, secondaryButtonClass } from "./ui";

// Share the trip report to WhatsApp (or anywhere): a picture made on the phone
// plus the same numbers as text. There's no public link: only what's in the
// picture and the message leaves the phone.
const W = 1080;
const H = 1350;

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export function drawReport(canvas: HTMLCanvasElement, r: TripReport) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const m = (x: number) => formatMoney(x, r.currency);
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const serif = "Georgia, ui-serif, serif";
  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#16161a";
  ctx.beginPath();
  ctx.roundRect(48, 48, W - 96, H - 96, 48);
  ctx.fill();

  const x = 110;
  const right = W - 110;
  let y = 170;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#9d9a92";
  ctx.font = `500 34px ${sans}`;
  ctx.fillText(wrap(ctx, [dateRange(r), r.days > 1 ? `${r.days} days` : "", `${r.count} expenses`].filter(Boolean).join("  ·  "), right - x), x, y);
  y += 90;
  ctx.fillStyle = "#f4f2ec";
  ctx.font = `600 76px ${serif}`;
  ctx.fillText(wrap(ctx, r.name, right - x), x, y);
  y += 130;
  ctx.font = `600 120px ${serif}`;
  ctx.fillText(wrap(ctx, m(r.total), right - x), x, y);
  y += 60;
  ctx.fillStyle = "#b9b6ae";
  ctx.font = `400 36px ${sans}`;
  ctx.fillText(wrap(ctx, [r.people > 1 ? `about ${m(r.perPerson)} each` : "", r.days > 1 ? `${m(r.perDay)} a day` : ""].filter(Boolean).join("  ·  "), right - x), x, y);

  // Top categories as bars.
  y += 90;
  for (const c of r.categories.slice(0, 4)) {
    ctx.fillStyle = "#f4f2ec";
    ctx.font = `500 36px ${sans}`;
    ctx.fillText(`${c.emoji}  ${c.label}`, x, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#b9b6ae";
    ctx.fillText(`${c.pct}%`, right, y);
    ctx.textAlign = "left";
    y += 22;
    ctx.fillStyle = "#2b2b31";
    ctx.beginPath();
    ctx.roundRect(x, y, right - x, 14, 7);
    ctx.fill();
    ctx.fillStyle = "#6fe3a8";
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(14, ((right - x) * c.pct) / 100), 14, 7);
    ctx.fill();
    y += 70;
  }

  ctx.font = `400 34px ${sans}`;
  ctx.fillStyle = "#b9b6ae";
  if (r.biggest) {
    ctx.fillText(wrap(ctx, `Biggest: ${r.biggest.description} (${m(r.biggest.amount)})`, right - x), x, y);
    y += 56;
  }
  if (r.topPayer && r.people > 1) {
    ctx.fillText(wrap(ctx, `Paid the most: ${r.topPayer.name} (${m(r.topPayer.amount)})`, right - x), x, y);
    y += 56;
  }

  y += 30;
  ctx.fillStyle = "#f4f2ec";
  ctx.font = `600 38px ${sans}`;
  if (!r.settle.length) ctx.fillText("All settled ✅", x, y);
  else {
    ctx.fillText("To settle up", x, y);
    ctx.font = `400 34px ${sans}`;
    const shown = r.settle.slice(0, Math.max(1, Math.floor((H - 200 - y) / 52)));
    for (const s of shown) {
      y += 52;
      ctx.fillStyle = "#b9b6ae";
      ctx.fillText(wrap(ctx, `${s.from} → ${s.to}`, right - x - 260), x, y);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffab6b";
      ctx.fillText(m(s.amount), right, y);
      ctx.textAlign = "left";
    }
    if (shown.length < r.settle.length) {
      y += 52;
      ctx.fillStyle = "#8a877f";
      ctx.fillText(`and ${r.settle.length - shown.length} more`, x, y);
    }
  }

  ctx.fillStyle = "#8a877f";
  ctx.font = `600 36px ${serif}`;
  ctx.fillText("loopin", x, H - 110);
  ctx.font = `400 28px ${sans}`;
  ctx.textAlign = "right";
  ctx.fillText("Everyone’s in. Everything adds up.", right, H - 110);
  ctx.textAlign = "left";
}

export function TripShare({ report }: { report: TripReport }) {
  const [note, setNote] = useState("");
  const text = reportText(report);
  const fileName = `${report.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "trip"}-report.png`;

  async function picture(): Promise<File | null> {
    const canvas = document.createElement("canvas");
    drawReport(canvas, report);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    return blob ? new File([blob], fileName, { type: "image/png" }) : null;
  }

  async function share() {
    setNote("");
    const file = await picture();
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return;
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // closed the share sheet
    }
    // No picture sharing here (most computers): save the picture, open WhatsApp with the text.
    if (file) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    setNote("The picture was saved. Attach it in WhatsApp next to the message.");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied. Paste it anywhere.");
    } catch {
      setNote("Couldn’t copy here. Press and hold the text below to copy it.");
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={share} className={primaryButtonClass}>
        Share to WhatsApp
      </button>
      <button type="button" onClick={copy} className={secondaryButtonClass}>
        Copy as text
      </button>
      {note && (
        <p role="status" className="text-center text-sm text-gray-500">
          {note}
        </p>
      )}
      <p className="text-center text-xs text-gray-400">Only the picture and message are shared. There’s no link to the group.</p>
      <pre className="mt-4 whitespace-pre-wrap rounded-2xl bg-mist px-4 py-3 font-sans text-sm text-gray-600" aria-label="Report as text">
        {text}
      </pre>
    </div>
  );
}

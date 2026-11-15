"use client";

import type { RefObject } from "react";
import { PRINTS, printSvg } from "@/lib/postcards/catalog";
import { FITS, PHOTO_SIZES, type Fit, type Format, type PhotoSize } from "@/lib/postcards/format";
import type { MyUpload } from "@/lib/postcards/uploads";
import type { PostcardMoment } from "@/lib/moments-db";
import { Icons, Panel, Strip, caption, chip, tile } from "./shared";

// What the picture on the card is: Upload, your earlier uploads, your own moments, the trip's photos and the drawn prints.
// Under it, how it sits on the front (Fit) or how big the taped print is on one side (Size).
export type Own = { url: string; data?: string; reuseId?: string; momentId?: string } | null;

const FIT_NAMES: Record<Fit, string> = { full: "Full", border: "White border", taped: "Taped print" };
const SIZE_NAMES: Record<PhotoSize, string> = { small: "Small", medium: "Medium", large: "Large" };

export function PhotoPanel({ format, front, own, onFront, onFile, fileRef, state, uploads, moments, onUpload, onMoment, photos, photosLabel, fit, onFit, size, onSize }: {
  format: Format;
  front: string;
  own: Own;
  onFront: (f: string) => void;
  onFile: (f?: File) => void;
  fileRef: RefObject<HTMLInputElement | null>;
  state: string;
  uploads: MyUpload[];
  moments: PostcardMoment[];
  onUpload: (u: MyUpload) => void;
  onMoment: (m: PostcardMoment) => void;
  photos: string[];
  photosLabel: string;
  fit: Fit;
  onFit: (f: Fit) => void;
  size: PhotoSize;
  onSize: (s: PhotoSize) => void;
}) {
  const sel = front === "own" ? own : null;
  const th = "h-[52px] w-[70px]";
  return (
    <Panel tool="photo" label="Photo">
      <Strip data-front-choices>
        <div className="flex shrink-0 flex-col">
          <span className={caption}>Add</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => fileRef.current?.click()} className="flex h-[52px] w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[8px] border border-dashed border-fg/40 bg-mist text-[11px] font-semibold">
              {Icons.plus}
              Upload
            </button>
            {own?.data && (
              <button type="button" onClick={() => onFront("own")} aria-label="Your photo" aria-pressed={front === "own" && Boolean(own.data)} className={`${tile(front === "own")} ${th}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={own.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              </button>
            )}
          </div>
        </div>
        {uploads.length > 0 && (
          <div className="flex shrink-0 flex-col">
            <span className={caption}>Your uploads</span>
            <div className="flex gap-1.5">
              {uploads.map((u) => {
                const on = Boolean(sel && sel.reuseId === u.id);
                return (
                  <button key={u.id} type="button" onClick={() => onUpload(u)} aria-label={u.label} aria-pressed={on} data-upload-choice={u.id} className={`${tile(on)} ${th}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {moments.length > 0 && (
          <div className="flex shrink-0 flex-col">
            <span className={caption}>My moments</span>
            <div className="flex gap-1.5">
              {moments.map((m) => {
                const on = Boolean(sel && sel.momentId === m.id);
                return (
                  <button key={m.id} type="button" onClick={() => onMoment(m)} aria-label={`My moment: ${m.label}`} aria-pressed={on} data-moment-choice={m.id} className={`${tile(on)} ${th}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {photos.length > 0 && (
          <div className="flex shrink-0 flex-col">
            <span className={caption}>{photosLabel}</span>
            <div className="flex gap-1.5">
              {photos.map((src) => (
                <button key={src} type="button" onClick={() => onFront(`photo:${src}`)} aria-label="Trip photo" aria-pressed={front === `photo:${src}`} className={`${tile(front === `photo:${src}`)} ${th}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex shrink-0 flex-col">
          <span className={caption}>Prints</span>
          <div className="flex gap-1.5">
            {PRINTS.map((p) => (
              <button key={p.id} type="button" onClick={() => onFront(`print:${p.id}`)} aria-label={`Print: ${p.name}`} aria-pressed={front === `print:${p.id}`} className={`${tile(front === `print:${p.id}`)} ${th}`}>
                <span aria-hidden className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: printSvg(p.id, `t${p.id}`) }} />
              </button>
            ))}
          </div>
        </div>
      </Strip>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Choose your own photo" onChange={(e) => onFile(e.target.files?.[0])} />
      {state && (
        <p className="mt-1 text-[13px] text-fg/70" role="status">
          {state}
        </p>
      )}
      {format === "classic" ? (
        <div className="mt-1.5 flex items-start gap-1.5" role="group" aria-label="Fit">
          <span className="flex h-11 w-8 shrink-0 items-center text-[12px] font-semibold text-fg/70">Fit</span>
          <div className="flex min-w-0 flex-wrap gap-1.5 py-0.5" data-chip-row>
            {FITS.map((f) => (
              <button key={f} type="button" aria-pressed={fit === f} data-fit-choice={f} onClick={() => onFit(f)} className={`${chip(fit === f)} !px-3`}>
                {FIT_NAMES[f]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex items-start gap-1.5" role="group" aria-label="Size">
          <span className="flex h-11 w-8 shrink-0 items-center text-[12px] font-semibold text-fg/70">Size</span>
          <div className="flex min-w-0 flex-wrap gap-1.5 py-0.5" data-chip-row>
            {PHOTO_SIZES.map((s) => (
              <button key={s} type="button" aria-pressed={size === s} data-size-choice={s} onClick={() => onSize(s)} className={`${chip(size === s)} !px-3`}>
                {SIZE_NAMES[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

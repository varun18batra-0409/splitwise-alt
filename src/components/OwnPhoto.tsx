"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_PHOTO_BYTES } from "@/lib/covers";

// "Your photo" in the picture picker: pick a photo from the phone; it's made
// small here first (about 1200 px, a few hundred KB at most), then saved as the
// group's picture for everyone in the group.
export function OwnPhotoButton({ groupId }: { groupId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");

  async function pick(file: File | undefined) {
    if (!file) return;
    setState("busy");
    try {
      const blob = await shrink(file);
      const r = await fetch(`/api/group-photo/${groupId}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type } });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || "Couldn’t save that photo. Try another one.");
      setState("done");
      router.refresh();
    } catch (e) {
      setState(e instanceof Error ? e.message : "Couldn’t save that photo. Try another one.");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="relative row-span-2 flex flex-col">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={state === "busy"}
        className="flex h-[92px] w-[70px] flex-col items-center justify-center gap-1 rounded-[14px] border-[1.5px] border-dashed border-gray-300 text-[11px] font-semibold text-gray-600 active:bg-mist disabled:opacity-60"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
        {state === "busy" ? "Saving…" : "Your photo"}
      </button>
      <input ref={input} type="file" accept="image/*" aria-label="Upload your own photo" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      <p role="status" className="mt-1 w-[70px] text-[10px] leading-tight text-gray-500">
        {state === "done" ? "Saved for the group" : state !== "idle" && state !== "busy" ? <span className="text-red-600">{state}</span> : ""}
      </p>
    </div>
  );
}

// Made small on the phone: at most 1200 px on the long side, WebP (or JPEG
// where the phone can't make WebP), under the size limit.
async function shrink(file: File): Promise<Blob> {
  const img = await load(file);
  for (const [max, q] of [
    [1200, 0.8],
    [1000, 0.7],
    [800, 0.6],
  ] as const) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img.source, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, "image/webp", q);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", q + 0.05);
    if (blob && blob.size <= MAX_PHOTO_BYTES) return blob;
  }
  throw new Error("That photo is too big. Try another one.");
}

function toBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((res) => c.toBlob(res, type, q));
}

async function load(file: File): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  try {
    const b = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: b, width: b.width, height: b.height };
  } catch {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.src = url;
    await im.decode().catch(() => {
      throw new Error("That file isn’t a photo Loopin can read. Try another one.");
    });
    return { source: im, width: im.naturalWidth, height: im.naturalHeight };
  }
}

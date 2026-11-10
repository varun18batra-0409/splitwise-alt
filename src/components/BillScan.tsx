"use client";

import { useRef, useState } from "react";
import { load } from "./OwnPhoto";

export type ScannedBill = {
  merchant: string;
  total: number | null;
  currency: string;
  date: string;
  items: { name: string; price: number }[];
  extras: number;
};

// "Scan a bill": a photo of the bill is kept with the expense, and (when bill
// reading is on) read so the form fills itself in. The phone makes the photo
// small first: sharp enough to read, light enough to send on mobile data.
export function BillScan({
  groupId,
  read,
  onRead,
  onAttach,
}: {
  groupId: string;
  read: boolean; // fill the form in from the photo
  onRead: (bill: ScannedBill) => void;
  onAttach: (receiptId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [note, setNote] = useState("");
  const [thumb, setThumb] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setState("busy");
    setNote(read ? "Reading the bill…" : "Adding the photo…");
    try {
      const blob = await shrinkBill(file);
      const res = await fetch(`/api/receipt?group=${encodeURIComponent(groupId)}${read ? "&read=1" : ""}`, { method: "POST", body: blob });
      const r = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string; note?: string; bill?: ScannedBill };
      if (!r.ok || !r.id) throw new Error(r.error || "Couldn’t add that photo. Try again.");
      if (thumb) URL.revokeObjectURL(thumb);
      setThumb(URL.createObjectURL(blob));
      onAttach(r.id);
      if (r.bill) onRead(r.bill);
      setNote(r.bill ? (r.bill.total ? "Filled in from the bill. Check it, then save." : "Read the bill, but not its total. Type the amount.") : r.note || "Photo attached.");
      setState("done");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn’t add that photo. Try again.");
      setState("idle");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="-mt-1" data-bill-scan>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Bill photo" />
      {state === "done" && thumb ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line p-2 pr-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb} alt="The bill" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
          <p className="min-w-0 flex-1 text-sm text-gray-500" role="status">
            {note}
          </p>
          <button
            type="button"
            aria-label="Remove the bill photo"
            onClick={() => {
              onAttach("");
              setState("idle");
              setNote("");
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none text-gray-400 active:bg-mist"
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            disabled={state === "busy"}
            onClick={() => input.current?.click()}
            className="flex min-h-11 items-center gap-2 text-sm font-medium text-fg disabled:opacity-60"
          >
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 3h16v18l-3-2-2 2-3-2-3 2-2-2-3 2zM8 8h8M8 12h8M8 16h5" />
            </svg>
            {state === "busy" ? (read ? "Reading the bill…" : "Adding…") : read ? "Scan a bill" : "Add a bill photo"}
          </button>
          {note && state !== "busy" && (
            <p className="text-sm text-gray-500" role="status">
              {note}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// At most 1568 px on the long side (what the reader works best with), JPEG,
// stepping down until it's under ~900 KB.
async function shrinkBill(file: File): Promise<Blob> {
  const img = await load(file);
  for (const [max, q] of [
    [1568, 0.82],
    [1400, 0.75],
    [1200, 0.7],
    [1000, 0.65],
  ] as const) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
    if (blob && blob.size <= 900_000) return blob;
  }
  throw new Error("That photo is too big. Try another one.");
}

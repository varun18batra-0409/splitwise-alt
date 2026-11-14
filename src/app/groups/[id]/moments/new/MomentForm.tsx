"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrink } from "@/components/OwnPhoto";
import { useRequestKey } from "@/components/FreshKeyInput";
import { CameraIcon } from "@/components/MomentIcons";
import { inputClass, primaryButtonClass } from "@/components/ui";
import { MOMENT_CAPTION_MAX, MOMENT_FULL_MAX, MOMENT_FULL_STEPS, MOMENT_FULL_TARGET, MOMENT_THUMB_MAX, MOMENT_THUMB_STEPS, MOMENT_THUMB_TARGET } from "@/lib/covers";
import { cleanCaption, graphemeCount } from "@/lib/moments-text";

// Add a moment: pick a photo (made small here, twice: the photo and a small copy), a few words, and a day of the trip. Day choices are
// drawn chips, not date boxes. Nothing is sent until "Add moment".
const chip = "inline-flex h-11 shrink-0 items-center justify-center rounded-full px-4 text-[15px] font-medium";
const on = `${chip} border-[1.5px] border-fg text-fg`;
const off = `${chip} border border-fg/15 text-fg/55`;

export function MomentForm({ groupId, days, initialKey }: { groupId: string; days: { value: string; label: string }[]; initialKey: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const rid = useRequestKey(initialKey);
  const [photo, setPhoto] = useState<{ full: Blob; thumb: Blob; preview: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const [day, setDay] = useState("");
  const [error, setError] = useState("");
  const count = graphemeCount(caption);
  const over = count > MOMENT_CAPTION_MAX;

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    setReading(true);
    try {
      const full = await shrink(file, { steps: MOMENT_FULL_STEPS, target: MOMENT_FULL_TARGET, max: MOMENT_FULL_MAX });
      const thumb = await shrink(file, { steps: MOMENT_THUMB_STEPS, target: MOMENT_THUMB_TARGET, max: MOMENT_THUMB_MAX });
      if (photo) URL.revokeObjectURL(photo.preview);
      setPhoto({ full, thumb, preview: URL.createObjectURL(full) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file isn’t a photo Loopin can read. Try another one.");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function send() {
    if (!photo || busy) return;
    if (cleanCaption(caption) === null) {
      setError(`Keep the words to ${MOMENT_CAPTION_MAX} characters or fewer.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const f = new FormData();
      f.set("group", groupId);
      f.set("full", photo.full, "moment.webp");
      f.set("thumb", photo.thumb, "moment-small.webp");
      f.set("caption", caption);
      f.set("takenOn", day);
      f.set("rid", rid);
      const r = await fetch("/api/moment", { method: "POST", body: f });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error || "Couldn’t save that photo. Please try again.");
      router.push(`/groups/${groupId}/moments`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save that photo. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="space-y-6 pb-8"
    >
      <div>
        <input ref={input} type="file" accept="image/*" aria-label="Choose a photo" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
        {photo ? (
          <div className="relative overflow-hidden rounded-[20px] border border-line bg-white">
            {/* A plain image on purpose: this is a preview made on the phone. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.preview} alt="Your photo" className="max-h-[60svh] w-full object-cover" />
            <button type="button" onClick={() => input.current?.click()} className="absolute bottom-3 right-3 inline-flex min-h-11 items-center rounded-full border border-fg/25 bg-canvas/80 px-4 text-sm font-semibold text-fg active:bg-fg/10">
              Change photo
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={reading}
            className="flex h-48 w-full flex-col items-center justify-center gap-2 rounded-[20px] border-[1.5px] border-dashed border-fg/25 text-base font-semibold text-fg/75 active:bg-mist disabled:opacity-60"
          >
            <CameraIcon size={28} />
            {reading ? "Getting it ready…" : "Choose a photo"}
          </button>
        )}
      </div>

      <label className="block">
        <span className="mb-1 flex items-baseline justify-between text-[13px] font-medium text-fg/55">
          <span>A few words</span>
          <span className={over ? "text-owe" : ""} aria-live="polite" data-caption-count>
            {count}/{MOMENT_CAPTION_MAX}
          </span>
        </span>
        {/* Two lines, so all 80 characters are in view. Enter does not add a line break (a caption is one line of words). */}
        <textarea
          value={caption}
          rows={2}
          onChange={(e) => setCaption(e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder="The boat we almost missed"
          autoComplete="off"
          className={`${inputClass} emoji-font resize-none leading-snug`}
          aria-invalid={over}
        />
      </label>

      {days.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-fg/55">Which day?</legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Day of the trip">
            <button type="button" aria-pressed={day === ""} onClick={() => setDay("")} className={day === "" ? on : off}>
              No day
            </button>
            {days.map((d) => (
              <button key={d.value} type="button" aria-pressed={day === d.value} onClick={() => setDay(d.value)} className={day === d.value ? on : off}>
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="rounded-[20px] border border-line bg-white px-4 py-3 text-owe">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-5 bg-[#0d0d0f] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <button type="submit" disabled={!photo || busy || over} className={primaryButtonClass}>
          {busy ? "Adding…" : "Add moment"}
        </button>
      </div>
    </form>
  );
}

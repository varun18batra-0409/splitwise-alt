import { placeOf } from "@/lib/countdown";
import { inputClass } from "./ui";

// "When's the trip?": the start (and end) day, with a nudge to fill them in,
// because the dates are what start the countdown for everyone.
export function TripDates({ name, start = "", end = "", titleClass = "text-sm font-medium text-gray-600" }: { name: string; start?: string; end?: string; titleClass?: string }) {
  const place = placeOf(name.trim()) || "Goa";
  return (
    <div id="trip" className="scroll-mt-6">
      <span className={`mb-2 block ${titleClass}`}>When’s the trip? ⏳</span>
      <p className="mb-3 rounded-xl border border-owed/25 bg-owed/[0.08] px-3.5 py-2.5 text-[13px] leading-snug text-fg/80">
        Add the dates to <strong className="font-semibold text-owed">start the countdown</strong>. Everyone in the group sees “{place} in 12 days” on their Home screen, and
        gets a fun nudge as the day gets closer. You can change them any time.
      </p>
      <span className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Starts</span>
          <input name="tripStart" type="date" defaultValue={start} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Ends (if you know)</span>
          <input name="tripEnd" type="date" defaultValue={end} className={inputClass} />
        </label>
      </span>
    </div>
  );
}

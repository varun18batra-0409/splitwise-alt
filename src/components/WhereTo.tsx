import { COUNTRIES, countryOf, tripStops } from "@/lib/geo";
import { inputClass } from "./ui";
import { SelectField } from "@/components/SelectField";

// "Where to?" for a trip: the places it goes, for everyone's trip passport.
// Optional: Loopin guesses from the trip's name when it can.
export function WhereTo({ name, place = "", country = "", optional }: { name: string; place?: string; country?: string; optional?: boolean }) {
  const guess = tripStops(name);
  // Nothing is filled in for them: a filled-in country would be saved, and would hide the other countries guessed from the name.
  // So the guess shows as the hint in the place box and on the empty country choice.
  const guessedCities = guess.map((s) => s.city).filter(Boolean).join(", ");
  const guessedCountry = countryOf(guess.find((s) => s.country)?.country ?? "");
  const guessed = guess.map((s) => s.city || countryOf(s.country)?.name).filter(Boolean).join(", ");
  return (
    <fieldset id="where" className="scroll-mt-4">
      <legend className={optional ? "mb-1 text-sm font-medium text-gray-600" : "mb-1 text-base font-semibold"}>
        Where to?{optional && <span className="font-normal text-gray-400"> (optional)</span>}
      </legend>
      <p className="mb-2.5 text-sm text-gray-500" aria-live="polite">
        {guessed && !place ? `From the name: ${guessed} ✓ Add more stops or fix it here.` : "Add it to get a stamp in everyone’s trip passport."}
      </p>
      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-[minmax(0,1fr)_12rem]">
        <input name="tripPlace" defaultValue={place} maxLength={80} placeholder={guessedCities || "e.g. Bangkok, Phuket"} aria-label="Places" autoComplete="off" className={inputClass} />
        <SelectField name="tripCountry" defaultValue={country} aria-label="Country" className="min-w-0">
          <option value="">{guessedCountry && !country ? `${guessedCountry.flag} ${guessedCountry.name}` : "Country…"}</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.name}
            </option>
          ))}
        </SelectField>
      </div>
    </fieldset>
  );
}

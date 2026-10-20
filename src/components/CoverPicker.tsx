import { COVERS, type CoverChoice } from "@/lib/covers";
import { GroupCover } from "./GroupCover";

// "Picture": a row of the drawn covers to choose from (a radio group sent as
// `cover`). Controlled on New group (it follows the type until you pick one),
// plain defaultValue in Settings.
export function CoverPicker({
  value,
  defaultValue,
  onChange,
  letter,
  uid,
  legendClassName = "mb-1 text-sm font-medium text-gray-600",
}: {
  value?: CoverChoice;
  defaultValue?: CoverChoice;
  onChange?: (c: CoverChoice) => void;
  letter: string;
  uid: string;
  legendClassName?: string;
}) {
  return (
    // min-w-0: a fieldset otherwise grows to fit the whole row, making the page wider than the phone.
    <fieldset className="min-w-0">
      <legend className={legendClassName}>Picture</legend>
      <p className="text-xs text-gray-500">Swipe for more</p>
      <div className="-mx-1 grid snap-x auto-cols-[70px] grid-flow-col grid-rows-2 gap-3 overflow-x-auto px-1 pb-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {COVERS.map((c) => (
          <label
            key={c.id}
            className="relative h-[92px] w-[70px] shrink-0 snap-start cursor-pointer overflow-hidden rounded-[14px] border border-line ring-offset-2 ring-offset-canvas has-[:checked]:ring-2 has-[:checked]:ring-fg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
          >
            <input
              type="radio"
              name="cover"
              value={c.id}
              className="sr-only"
              {...(onChange ? { checked: value === c.id, onChange: () => onChange(c.id) } : { defaultChecked: defaultValue === c.id })}
            />
            <GroupCover kind={c.id} uid={`pick-${uid}`} letter={letter || "A"} small sizes="70px" />
            <span className="sr-only">{c.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

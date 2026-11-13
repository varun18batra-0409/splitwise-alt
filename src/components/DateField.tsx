"use client";

import { useRef, useState } from "react";
import { niceDate } from "@/lib/format";

// Loopin's own date box. It looks like our other fields and reads "25 Nov 2026"; the phone's real date input sits
// invisibly on top, so a tap opens the phone's own date sheet and the form still sends the same name and YYYY-MM-DD.
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  placeholder?: string;
  size?: "md" | "sm";
  /** Shrink to the content instead of filling the row. */
  inline?: boolean;
  /** Show a quiet "Clear" while a date is chosen. Leave off when the date is required. */
  clearable?: boolean;
};

export function DateField({ placeholder = "Pick a date", size = "md", inline, clearable, className = "", value, defaultValue, onChange, required, disabled, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const controlled = value !== undefined;
  const [own, setOwn] = useState(String(defaultValue ?? ""));
  const shown = controlled ? String(value) : own;
  const canClear = (clearable ?? !required) && !!shown && !disabled;

  function clear() {
    const el = ref.current;
    if (!el) return;
    // Go through the browser's own setter so React's onChange fires like a real edit.
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    if (!controlled) setOwn("");
  }

  return (
    <span
      className={`relative ${inline ? "inline-flex" : "flex"} ${size === "sm" ? "h-10" : "h-12"} items-center gap-2 rounded-[14px] border border-[#26262c] bg-[#16161a] px-4 text-base text-fg focus-within:border-fg/40 focus-within:ring-2 focus-within:ring-fg/10 ${disabled ? "opacity-50" : ""} ${className}`}
    >
      <CalendarIcon />
      <span className={`min-w-0 flex-1 truncate whitespace-nowrap ${shown ? "text-fg" : "text-gray-400"}`}>{shown ? niceDate(shown) : placeholder}</span>
      <input
        {...rest}
        ref={ref}
        type="date"
        required={required}
        disabled={disabled}
        {...(controlled ? { value } : { defaultValue })}
        onChange={(e) => {
          if (!controlled) setOwn(e.target.value);
          onChange?.(e);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [color-scheme:dark] disabled:cursor-default"
      />
      {canClear && (
        <button type="button" onClick={clear} className="relative z-10 shrink-0 text-sm text-fg/55 underline underline-offset-4 active:text-fg">
          Clear
        </button>
      )}
    </span>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-fg/75">
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

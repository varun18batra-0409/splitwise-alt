"use client";

import { Children, isValidElement, useEffect, useRef, useState } from "react";

// Loopin's own dropdown box. It shows the chosen option's name with a drawn chevron; the phone's real <select> sits
// invisibly on top, so a tap opens the phone's own picker and forms (and tests) work exactly as before.
type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: "md" | "sm";
  /** Shrink to the content instead of filling the row. */
  inline?: boolean;
};

function labelOf(children: React.ReactNode, value: string): string {
  let found = "";
  let first = "";
  const walk = (nodes: React.ReactNode) => {
    Children.forEach(nodes, (n) => {
      if (!isValidElement(n)) return;
      const p = n.props as { value?: unknown; children?: React.ReactNode };
      if (n.type === "option") {
        const text = Children.toArray(p.children).join("");
        const v = p.value === undefined ? text : String(p.value);
        if (!first) first = text;
        if (v === value && !found) found = text;
      } else if (p.children) walk(p.children); // <optgroup> and fragments
    });
  };
  walk(children);
  return found || first;
}

export function SelectField({ size = "md", inline, className = "", children, value, defaultValue, onChange, disabled, ...rest }: Props) {
  const ref = useRef<HTMLSelectElement>(null);
  const controlled = value !== undefined;
  const [own, setOwn] = useState<string | undefined>(defaultValue === undefined ? undefined : String(defaultValue));
  // What the box shows always follows the real control: when the page passes a new default, or the form is reset.
  useEffect(() => {
    const el = ref.current;
    if (!el || value !== undefined) return;
    setOwn(el.value);
    const form = el.form;
    if (!form) return;
    const onReset = () => setTimeout(() => ref.current && setOwn(ref.current.value), 0);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue, value]);
  const current = controlled ? String(value) : own;
  const text = labelOf(children, current ?? "");

  return (
    <span
      className={`relative ${inline ? "inline-flex" : "flex"} ${size === "sm" ? "h-10" : "h-12"} items-center gap-2 rounded-[14px] border border-[#26262c] bg-[#16161a] pl-4 pr-3 text-base text-fg focus-within:border-fg/40 focus-within:ring-2 focus-within:ring-fg/10 ${disabled ? "opacity-50" : ""} ${className}`}
    >
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{text}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-fg/75">
        <path d="m6 9 6 6 6-6" />
      </svg>
      <select
        {...rest}
        ref={ref}
        disabled={disabled}
        {...(controlled ? { value } : { defaultValue })}
        onChange={(e) => {
          if (!controlled) setOwn(e.target.value);
          onChange?.(e);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [color-scheme:dark] disabled:cursor-default"
      >
        {children}
      </select>
    </span>
  );
}

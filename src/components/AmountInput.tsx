"use client";

import { useLayoutEffect, useReducer, useRef, useState, type InputHTMLAttributes } from "react";
import { editAmountInput, regroupAmount } from "@/lib/amount-input";

// An amount box that shows grouped digits as you type (1,23,456.50 for rupees), chosen by the founder on 16 Nov.
// The caret stays after the same digit however many commas appear or go. What is sent to the server is this same text:
// parseAmount ignores the commas. Pass value + onValueChange to keep the text in the form's own state, or just defaultValue.
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "inputMode" | "type"> & {
  currency: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

export function AmountInput({ currency, value, defaultValue, onValueChange, ...rest }: Props) {
  const controlled = value !== undefined;
  const [own, setOwn] = useState(() => regroupAmount(defaultValue ?? "", currency));
  const shown = controlled ? value : own;
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  // After the text is drawn, put the caret back after the same digit (a typed letter that was dropped also lands here).
  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current !== null && el && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      value={shown}
      onChange={(e) => {
        const el = e.currentTarget;
        const inputType = (e.nativeEvent as InputEvent).inputType;
        const r = editAmountInput(el.value, el.selectionStart ?? el.value.length, currency, { prev: shown, inputType });
        caret.current = r.caret;
        if (!controlled) setOwn(r.value);
        onValueChange?.(r.value);
        redraw();
      }}
    />
  );
}

"use client";

import { useState } from "react";
import { inputClass } from "./ui";

// A growing list of "other people" name boxes on the create-group form.
export function MemberInputs() {
  const [count, setCount] = useState(1);
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <input
          key={i}
          name="member"
          placeholder={`Person ${i + 2}`}
          autoComplete="off"
          className={inputClass}
        />
      ))}
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        className="py-1 text-sm font-medium text-accent"
      >
        + Add another person
      </button>
    </div>
  );
}

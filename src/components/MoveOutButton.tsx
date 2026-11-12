"use client";

// The move-out button. It asks first, naming the final payments. The list follows the "Add it now" tick for
// daily bills, read at the moment of the tap.
export function MoveOutButton({ plain, withDaily, className, children }: { plain: string; withDaily?: string; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        const box = e.currentTarget.form?.elements.namedItem("addDaily");
        const ticked = box instanceof HTMLInputElement && box.checked;
        if (!window.confirm(ticked && withDaily ? withDaily : plain)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

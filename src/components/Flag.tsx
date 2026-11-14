// A country's real flag as a small picture (public/flags/xx.png, fetched at build by scripts/fetch-flags.mjs).
// Real image files, not emoji: flag emoji show as two letters on Windows. The country's name is always written next to it, so the picture
// is decoration (alt="" and hidden from screen readers). Under the picture sits the country's letter code: if a file is missing, the image
// draws nothing (empty alt) and the code shows through, so no script is needed for the fallback.
export function Flag({ code, size = 40, shape = "round", className = "" }: { code: string; size?: number; shape?: "round" | "tile"; className?: string }) {
  const lower = code.toLowerCase();
  const radius = shape === "round" ? "rounded-full" : "rounded-[5px]";
  return (
    <span
      aria-hidden
      data-flag={code.toUpperCase()}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-fg/15 bg-[#efe8d6] font-extrabold text-[#5c564a] ${radius} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.3)) }}
    >
      {code.toUpperCase()}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/flags/${lower}.png`} srcSet={`/flags/${lower}.png 1x, /flags/${lower}@2x.png 2x`} alt="" width={size} height={size} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
    </span>
  );
}

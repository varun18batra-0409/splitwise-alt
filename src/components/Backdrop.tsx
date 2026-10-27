import type { Tone } from "@/lib/home/stories";

// Poster and list slides: Loopin's dark surface, lit by the slide's own accent
// colour (a glow, the kicker, the bars), with off-white type. Never flat candy colours.
export const TONE: Record<Tone, string> = { sun: "#d8bd7a", coral: "#f2a07b", sky: "#9cc8ec", pink: "#e6a7c8", lilac: "#b9a6ef", mint: "#6fe3a8" };

export function Backdrop({ accent }: { accent: string }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0"
      style={{
        background: `radial-gradient(90% 55% at 85% 8%, ${accent}38, transparent 70%), radial-gradient(70% 45% at 0% 100%, ${accent}1f, transparent 70%), linear-gradient(170deg, #1a1a1f 0%, #0d0d0f 75%)`,
      }}
    >
      <span className="absolute inset-0 opacity-[0.5] [background-image:linear-gradient(rgb(244_242_236/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(244_242_236/0.035)_1px,transparent_1px)] [background-size:26px_26px]" />
    </span>
  );
}


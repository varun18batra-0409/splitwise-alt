import type { Tone } from "@/lib/home/stories";

// Poster and list slides: Loopin's calm dark page with off-white type. No glows or washes:
// colour is kept for money, so every tone is the same off-white.
export const TONE: Record<Tone, string> = { sun: "#f4f2ec", coral: "#f4f2ec", sky: "#f4f2ec", pink: "#f4f2ec", lilac: "#f4f2ec", mint: "#f4f2ec" };

export function Backdrop({ accent: _accent }: { accent?: string } = {}) {
  void _accent;
  return <span aria-hidden className="absolute inset-0 bg-[#0d0d0f]" />;
}

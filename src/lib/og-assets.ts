import fonts from "@/generated/og-fonts.json";
import map from "@/generated/map.json";

// What the share pictures (passport, Wrapped…) are drawn with: Loopin's own
// fonts and the world map, fetched from the app's own address.

export type OgFont = { name: string; data: ArrayBuffer; weight: 500 | 600 | 700; style: "normal" };

export async function loadOgFonts(origin: string): Promise<OgFont[]> {
  const list: OgFont[] = [];
  const want: [string, string, 500 | 600 | 700][] = [
    ["display-600", "Display", 600],
    ["display-700", "Display", 700],
    ["sans-500", "Sans", 500],
    ["sans-700", "Sans", 700],
  ];
  await Promise.all(
    want.map(async ([key, name, weight]) => {
      const path = (fonts as Record<string, string>)[key];
      if (!path) return;
      try {
        const r = await fetch(new URL(path, origin));
        if (r.ok) list.push({ name, data: await r.arrayBuffer(), weight, style: "normal" });
      } catch {
        /* the default font, then */
      }
    }),
  );
  return list;
}

// The world map with your countries filled in, as a picture inside the picture.
export async function worldMapImage(origin: string, trips: string[], been: string[], colours = { trips: "#2f7d4f", been: "#8fc4a8" }): Promise<string | null> {
  if (!(map as { ok: boolean }).ok) return null;
  try {
    const r = await fetch(new URL("/world.svg", origin));
    if (!r.ok) return null;
    const svg = await r.text();
    const ok = (c: string) => /^[A-Z]{2}$/.test(c);
    const b = been.filter(ok);
    const t = trips.filter(ok);
    const style = `<style>${b.length ? `${b.map((c) => `#${c}`).join(",")}{fill:${colours.been}}` : ""}${t.length ? `${t.map((c) => `#${c}`).join(",")}{fill:${colours.trips}}` : ""}</style>`;
    const painted = svg.replace(/<g /, `${style}<g `);
    return `data:image/svg+xml;base64,${Buffer.from(painted).toString("base64")}`;
  } catch {
    return null;
  }
}

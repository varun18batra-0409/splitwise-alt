import fonts from "@/generated/og-fonts.json";
import map from "@/generated/map.json";

// What the share pictures (passport, Wrapped…) are drawn with: Loopin's own
// fonts and the world map, fetched from the app's own address. Only real font and SVG files are used, so a sign-in wall
// in front of the site can't feed the picture a login page. (Not read from disk: a public/ read makes the hosting
// bundle the whole folder, photos included, into each picture's server code, and the build fails.)

export type OgFont = { name: string; data: ArrayBuffer; weight: 500 | 600 | 700; style: "normal" };

const isFont = (type: string | null) => /^(font\/|application\/(font|x-font)|application\/octet-stream)/.test(type ?? "");

export async function loadOgFonts(origin: string): Promise<OgFont[]> {
  const list: OgFont[] = [];
  const want: [string, string, 500 | 600 | 700][] = [
    ["display-600", "Display", 600],
    ["display-700", "Display", 700],
    ["sans-500", "Sans", 500],
    ["sans-700", "Sans", 700],
    // ₹ and other currency signs: the picture maker falls back to these for any glyph the others lack.
    ["sans-ext-500", "SansExt", 500],
    ["sans-ext-700", "SansExt", 700],
  ];
  await Promise.all(
    want.map(async ([key, name, weight]) => {
      const path = (fonts as Record<string, string>)[key];
      if (!path) return;
      try {
        // redirect "manual": a site behind a sign-in wall (Vercel's preview lock) answers with a redirect to a login page;
        // only a real font file is used, anything else leaves this font out (the picture maker then uses its own).
        const r = await fetch(new URL(path, origin), { redirect: "manual" });
        if (r.ok && isFont(r.headers.get("content-type"))) list.push({ name, data: await r.arrayBuffer(), weight, style: "normal" });
      } catch {
        /* the default font, then */
      }
    }),
  );
  return list;
}

// The world map with your countries filled in, as a picture inside the picture.
export async function worldMapImage(origin: string, trips: string[], been: string[], colours = { trips: "#26231d", been: "#6f6757" }): Promise<string | null> {
  if (!(map as { ok: boolean }).ok) return null;
  try {
    const r = await fetch(new URL("/world.svg", origin), { redirect: "manual" });
    if (!r.ok || !/^image\/svg\+xml\b/.test(r.headers.get("content-type") ?? "")) return null;
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

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Flag } from "@/components/Flag";
import { COUNTRIES } from "@/lib/geo";

const read = (p: string) => readFileSync(p, "utf8");

describe("country flags are real picture files", () => {
  it("renders an aria-hidden image with a 2x source and the letter code underneath as the fallback", () => {
    const html = renderToStaticMarkup(createElement(Flag, { code: "IN", size: 40 }));
    expect(html).toContain('src="/flags/in.png"');
    expect(html).toContain("/flags/in@2x.png 2x");
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("width:40px");
    expect(html).toContain(">IN<");
  });

  it("the passport screens use <Flag and no emoji flags, photo tiles or letter-code circles", () => {
    for (const f of ["src/components/PassportCompare.tsx", "src/components/PassportBook.tsx", "src/components/CountryPicker.tsx", "src/components/want/WantToGoTab.tsx"]) {
      const s = read(f);
      expect(s, f).toContain("<Flag ");
      expect(s, f).not.toMatch(/\.flag\b/); // no emoji flag text
      expect(s, f).not.toContain("IndexPhoto");
    }
    expect(read("src/components/PassportCompare.tsx")).not.toContain("c.photo");
    expect(read("src/app/groups/[id]/passports/page.tsx")).not.toContain("countryPhoto");
  });

  it("Our passports map uses ink, not green", () => {
    const s = read("src/components/PassportBook.tsx");
    expect(s).toContain('fill={r.trips > 0 ? "#26231d" : "#a79f8c"}');
    expect(read("src/components/PassportCompare.tsx")).not.toMatch(/green|emerald/i);
  });

  it("the build fetches flags for every country, and never fails", () => {
    expect(JSON.parse(read("package.json")).scripts["vercel-build"]).toMatch(/fetch-flags\.mjs.*next build/);
    const s = read("scripts/fetch-flags.mjs");
    expect(s).toContain("flagcdn.com/w");
    expect(s).toContain("@2x.png");
    expect(s).not.toContain("process.exit");
    // the script reads the codes with C("XX", …): it must find every one.
    const found = [...read("src/lib/geo.ts").matchAll(/\bC\("([A-Z]{2})"/g)].length;
    expect(found).toBeGreaterThanOrEqual(COUNTRIES.length);
  });
});

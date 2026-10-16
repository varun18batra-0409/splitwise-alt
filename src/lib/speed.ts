// Speed numbers from phones: the screen's shape without ids, and milliseconds.

const KINDS = new Set(["nav", "submit", "search", "load"]);

// "/groups/cm1abc…/expenses/cm2…/edit" → "/groups/:id/expenses/:id/edit"
export function routeShape(path: string): string {
  return (
    path
      .split("?")[0]
      .split("/")
      .map((s) => (/^[a-z0-9]{20,}$/i.test(s) || /^[0-9a-f-]{32,36}$/i.test(s) || /^\d+$/.test(s) || /@/.test(s) || (s.length >= 6 && /\d/.test(s)) ? ":id" : s.replace(/[^a-z0-9-]/gi, "").slice(0, 30)))
      .join("/")
      .slice(0, 80) || "/"
  );
}

export type SpeedEntry = { k: string; r: string; ms: number };

export function cleanEntries(raw: unknown): SpeedEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 30)
    .map((e) => ({ k: String(e?.k ?? ""), r: routeShape(String(e?.r ?? "")), ms: Math.round(Number(e?.ms)) }))
    .filter((e) => KINDS.has(e.k) && Number.isFinite(e.ms) && e.ms >= 0 && e.ms <= 60_000);
}

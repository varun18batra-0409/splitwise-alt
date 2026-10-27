// The fun titles (The Banker, Night Owl…) as small engraved medallions with a
// drawn icon, instead of emoji: they look the same on every phone and feel
// like an award, not a sticker.

const PATHS: Record<string, string> = {
  bank: "M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3.5 20.5h17",
  food: "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16.5 3c-1.9 1-3 3.2-3 6v3h3v9",
  key: "M14.5 9.5a4 4 0 1 1-1.2-2.8M13.3 6.7 20 13.4l-2 2M17 12.4l-1.6 1.6",
  wheel: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3.7 11.2 10 12M14 12l6.3-.8M12 14v6.3",
  ticket: "M4 7.5h16v3a1.5 1.5 0 0 0 0 3v3H4v-3a1.5 1.5 0 0 0 0-3ZM14.5 7.5v9",
  moon: "M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5ZM17 3.5v3M15.5 5h3",
  bolt: "M13 2.5 5 13.5h6l-1 8 8-11h-6Z",
  receipt: "M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21ZM9 8h6M9 11.5h6M9 15h4",
  bag: "M5 8h14l-1 12.5H6ZM9 8V6.5a3 3 0 0 1 6 0V8",
  sunrise: "M4 17.5h16M7 17.5a5 5 0 0 1 10 0M12 4.5v3M5.2 9.2l2 2M18.8 9.2l-2 2M2.5 21h19",
  calendar: "M4.5 6h15v14h-15ZM4.5 10h15M8.5 3.5v4M15.5 3.5v4M12 12.6l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3Z",
  team: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11a2.5 2.5 0 1 0 0-5M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 14a4.5 4.5 0 0 1 5 5.5",
  wave: "M3 10c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0",
  note: "M9 18.5V5.5l10-2v12.5M9 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  card: "M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5ZM12 8.5l2.5 3.5-2.5 3.5L9.5 12Z",
  cup: "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5ZM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c0 1.5 1.5 1.5 1.5 3M12 3.5c0 1.5 1.5 1.5 1.5 3",
  star: "m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8Z",
  compass: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM15.5 8.5l-2 5-5 2 2-5Z",
  heart: "M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z",
  medal: "M12 9.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8.5 10.5 6 3.5h4l2 5M15.5 10.5l2.5-7h-4l-2 5M12 12.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3Z",
};

const BY_TITLE: Record<string, string> = {
  "The Banker": "bank",
  "Snack Lord": "food",
  "Stay Boss": "key",
  "The Driver": "wheel",
  "Fun Planner": "ticket",
  "Night Owl": "moon",
  "Always Pays First": "bolt",
  "Keeper of Receipts": "receipt",
  Shopaholic: "bag",
  "Early Bird": "sunrise",
  "Weekend Warrior": "calendar",
  "Team Player": "team",
  "Smooth Operator": "wave",
  "Chief Vibe Officer": "note",
  "The Wildcard": "card",
  "The Chill One": "cup",
  "Main Character": "star",
  "The Navigator": "compass",
  "Good Company": "heart",
};

export function titleIconPath(title: string): string {
  return PATHS[BY_TITLE[title] ?? "medal"];
}

// A gold-rimmed medallion with the title's icon in the accent colour.
export function TitleIcon({ title, size = 44, accent = "#6fe3a8" }: { title: string; size?: number; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden fill="none">
      <circle cx="24" cy="24" r="22.5" fill="#141417" stroke="#d8bd7a" strokeOpacity="0.75" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="19" stroke="#d8bd7a" strokeOpacity="0.28" strokeWidth="1" strokeDasharray="1.2 2.4" />
      <g transform="translate(12 12)">
        <path d={titleIconPath(title)} stroke={accent} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

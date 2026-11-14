import Image from "next/image";
import Link from "@/components/Link";
import { CalendarIcon, DotsIcon } from "@/components/PassportIcons";
import { StampArt } from "@/components/stamps/StampArt";
import { removePlaceAction } from "@/app/passport-actions";
import { titleFit, type BeenCardData } from "@/lib/passport-cards";

// The one card of the passport's Been tab (mockup 14): the place's photo on the left; its name, cities, dates and days on the
// right with a tilted stamp (COUNTRY over MON YEAR) and one outline button. A country added by hand is the same card
// (dashed "been there" stamp, no button, a menu to take it out). Server-drawn.

// The cream paper of the passport pages, for a card with no photo: the stamp is drawn big on it (and is then the card's only stamp).
const PAPER_STYLE = {
  backgroundColor: "#efe8d6",
  backgroundImage:
    "radial-gradient(circle at 50% 120%, transparent 0 38%, rgba(43,76,126,0.06) 38.5% 39%, transparent 39.5% 45%, rgba(43,76,126,0.05) 45.5% 46%, transparent 46.5%), repeating-linear-gradient(115deg, rgba(38,35,29,0.035) 0 1px, transparent 1px 7px)",
} as const;

function Picture({ c }: { c: BeenCardData }) {
  if (!c.photo)
    return (
      <div className="relative flex min-h-[132px] items-center justify-center overflow-hidden rounded-[14px]" style={PAPER_STYLE} data-been-panel>
        <StampArt
          s={{ id: `card-${c.id}`, kind: "country", code: c.code, name: c.countryName, flag: c.flag, when: c.stampWhen, cities: [], byHand: c.kind === "hand" }}
          size={92}
          tilt={-6}
        />
      </div>
    );
  return (
    <div className="relative min-h-[132px] overflow-hidden rounded-[14px] bg-mist">
      <Image src={c.photo} alt="" fill sizes="140px" className="object-cover" />
    </div>
  );
}

// "5–10 May · 6 days": the "·" stays with the dates (never at the start of the next line), and "6 days" stays together.
function TripWords({ c }: { c: BeenCardData }) {
  const days = c.days ? `${c.days} ${c.days === 1 ? "day" : "days"}` : "";
  if (!c.dates && !days) return null;
  if (!c.dates) return <span className="whitespace-nowrap">{days}</span>;
  const cut = c.dates.lastIndexOf(" ");
  const head = cut > 0 ? c.dates.slice(0, cut + 1) : "";
  const tail = cut > 0 ? c.dates.slice(cut + 1) : c.dates;
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {tail}
        {days ? " ·" : ""}
      </span>
      {days && " "}
      {days && <span className="whitespace-nowrap">{days}</span>}
    </>
  );
}

// The title wraps only at spaces and "·", never inside a word; one very long word steps the type down for this card.
function Title({ text }: { text: string }) {
  return (
    <div className="@container min-w-[9ch] flex-1">
      <h3 className="font-display font-semibold leading-tight tracking-tight [overflow-wrap:normal] [word-break:normal]" style={{ fontSize: titleFit(text, 22) }}>
        {text}
      </h3>
    </div>
  );
}

export function StampCard({ c }: { c: BeenCardData }) {
  const hand = c.kind === "hand";
  return (
    <article className="grid grid-cols-[36%_1fr] gap-1 overflow-hidden rounded-[20px] border border-line bg-white p-1.5" data-been-card={hand ? "hand" : "trip"} data-group={c.groupId} data-country={hand ? c.code : undefined}>
      <Picture c={c} />
      <div className="relative min-w-0 py-2 pl-2.5 pr-2">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <Title text={c.title} />
          {c.photo && (
            // Over a photo the stamp sits on the card, tilted; with no photo the cream panel already holds it.
            <span className="ml-auto mr-1 mt-1 shrink-0">
              <StampArt variant="card" code={c.code} country={c.countryName} when={c.stampWhen} byHand={hand} scale={0.9} />
            </span>
          )}
        </div>
        {c.cities.length > 0 && <p className="mt-1 text-[14px] leading-snug text-fg/75">{c.cities.join(" · ")}</p>}
        {(c.dates || c.days > 0) && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[14px] leading-snug text-fg/75" data-been-dates>
            <CalendarIcon size={16} className="mt-px shrink-0" />
            <span className="min-w-0">
              <TripWords c={c} />
            </span>
          </p>
        )}
        {c.cta && (
          <Link
            href={c.cta.href}
            className="mt-3 inline-flex h-11 items-center justify-center rounded-full border border-fg/25 px-5 text-[15px] font-semibold text-fg transition-transform active:scale-[0.97] active:bg-fg/10"
            data-been-cta={c.cta.label}
            data-been-relive={c.cta.label === "Relive trip" ? "" : undefined}
            data-been-moments={c.cta.label === "View memories" ? "" : undefined}
          >
            {c.cta.label}
          </Link>
        )}
        {hand && (
          <details className="absolute bottom-0 right-0">
            <summary aria-label={`More for ${c.title}`} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-fg/75 active:bg-mist [&::-webkit-details-marker]:hidden">
              <DotsIcon size={20} />
            </summary>
            <form action={removePlaceAction} className="absolute bottom-full right-0 z-10 mb-1 w-52 rounded-[14px] border border-line bg-canvas p-1 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.9)]">
              <input type="hidden" name="country" value={c.code} />
              <button type="submit" className="flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-[14px] text-fg active:bg-mist">
                Remove from passport
              </button>
            </form>
          </details>
        )}
      </div>
    </article>
  );
}

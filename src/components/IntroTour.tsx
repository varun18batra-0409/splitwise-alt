"use client";

import Link from "@/components/Link";
import { GetAppButton } from "./GetApp";
import { HomeIcon } from "./icons";
import { GroupCover } from "./GroupCover";
import type { CoverChoice } from "@/lib/covers";

// Remember the tour was seen, so Home shows the start screen next time.
const seen = () => {
  try {
    document.cookie = "lp_tour=1; path=/; max-age=31536000; samesite=lax";
  } catch {
    /* ignore */
  }
};
import { useEffect, useMemo, useRef, useState } from "react";
import { decimalsOf, formatMoney } from "@/lib/money";
import { CameraIcon } from "./MomentIcons";

// The intro tour, in the visitor's own currency: seven swipeable slides (make a group, add what you paid,
// see who owes then settle, every trip becomes a story, send a postcard, keep moments, collect your passport), each with a small animated picture. Shown to
// first-time visitors on the home screen, and any time at /welcome (the "1-minute tour" link in How Loopin works).

type Slide = { id: string; title: string; caption: string; art: React.ReactNode };

const owed = "text-owed";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`w-full rounded-[22px] border border-line bg-white p-5 ${className}`}>{children}</div>;
}

function Dot({ name, tone = "bg-mist" }: { name: string; tone?: string }) {
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone} font-display text-sm font-semibold text-fg`}>
      {name.charAt(0)}
    </span>
  );
}

// Three of Loopin's own group pictures as polaroids, fanning in: a trip, a
// home, the two of you. Under them, the kinds of group (the same names as New group).
function Cheers() {
  const shots: [CoverChoice, string, number, string][] = [
    ["beach", "Trip", -9, "rise-2"],
    ["city", "Home", 2, "rise-3"],
    ["couple", "Couple", 10, "rise-4"],
  ];
  return (
    <div className="relative flex flex-col items-center">
      <div className="relative flex items-end">
        {shots.map(([kind, label, tilt, d], i) => (
          <span key={label} className={`rise ${d} relative block w-[96px] bg-[#f4f1e8] p-[5px] pb-0 shadow-[0_16px_28px_-12px_rgba(0,0,0,0.95)] ${i ? "-ml-4" : ""}`} style={{ transform: `rotate(${tilt}deg) translateY(${i === 1 ? -10 : 0}px)`, zIndex: i === 1 ? 2 : 1 }}>
            <span className="relative block h-[92px] overflow-hidden bg-[#222]">
              <GroupCover kind={kind} uid={`tour-${label}`} small sizes="96px" />
            </span>
            <span className="block py-1 text-center font-hand text-[18px] font-bold leading-tight text-[#2a2620]">{label}</span>
          </span>
        ))}
      </div>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {["Trip", "Home", "Couple", "Game night"].map((t, i) => (
          <span key={t} className={`nobreak rise rise-${Math.min(i + 2, 5)} rounded-full border border-line bg-canvas px-3 py-1 text-xs text-gray-600`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

// A postcard, as the tour shows it: cream card, a stamp, a handwritten line. Drawn here, no photo needed.
function PostcardArt() {
  return (
    <div className="rise relative w-full max-w-[270px]" data-tour-postcard>
      <div className="relative -rotate-3 bg-[#f4f1e8] p-4 pb-5 shadow-[0_24px_40px_-18px_rgba(0,0,0,0.95)]">
        <span aria-hidden className="absolute right-3 top-3 flex h-12 w-10 items-center justify-center border-2 border-dashed border-[#b8956a]/70 text-[#b8956a]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 13l18-8-6 15-3-6-6-1Z" />
          </svg>
        </span>
        <p className="font-hand text-[26px] font-bold leading-[1.05] text-[#2a2620]">Wish you were here</p>
        <p className="mt-3 max-w-[170px] font-hand text-[19px] leading-tight text-[#4a4338]">The beach, the bill and the best dinner of the trip.</p>
        <span aria-hidden className="mt-4 block h-px w-3/5 bg-[#2a2620]/25" />
        <span aria-hidden className="mt-2 block h-px w-2/5 bg-[#2a2620]/25" />
      </div>
    </div>
  );
}

// A passport page with three stamps (place names only).
function PassportArt() {
  return (
    <div className="rise relative w-full max-w-[260px] rounded-[22px] border border-line bg-white p-5 shadow-[0_24px_40px_-18px_rgba(0,0,0,0.95)]" data-tour-passport>
      <p className="text-center text-[13px] font-semibold text-fg/55">Passport</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {["Goa", "Lisbon", "Bangkok"].map((place, i) => (
          <span
            key={place}
            className="flex aspect-square items-center justify-center rounded-full border-2 border-fg/40 px-1 text-center font-display text-[13px] font-semibold leading-none text-fg/75"
            style={{ transform: `rotate(${[-8, 5, -3][i]}deg)` }}
          >
            {place}
          </span>
        ))}
      </div>
      <p className="mt-4 text-center text-sm text-fg/75">3 stamps and counting</p>
    </div>
  );
}

// A trip's Wrapped, as a story poster: progress segments on top, then what the story is made of.
// Only things Wrapped really shows: the total, the biggest splurge, who paid most, the busiest day.
function StoryPoster({ L }: { L: Local }) {
  return (
    <div className="rise relative w-full max-w-[260px] overflow-hidden rounded-[24px] border border-line bg-white p-4 shadow-[0_24px_40px_-18px_rgba(0,0,0,0.95)]">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-[3px] flex-1 rounded-full ${i < 2 ? "bg-fg" : "bg-fg/25"}`} />
        ))}
      </div>
      <p className="mt-6 text-[13px] font-medium leading-none text-fg/60">{L.india ? "Goa, wrapped" : "Lake weekend, wrapped"}</p>
      <p className="mt-2 font-display text-[34px] font-semibold leading-[1.02] tracking-tight text-fg">{L.m(L.india ? 48600 : 1240)}</p>
      <p className="mt-1 text-xs text-fg/60">4 of you · about {L.m(L.india ? 12150 : 310)} each</p>
      <ul className="mt-5 space-y-2 border-t border-fg/10 pt-4" data-story-lines>
        {["The splurge", "Where the money went", "The biggest day"].map((t, i) => (
          <li key={t} className={`rise rise-${i + 2} flex items-baseline gap-2.5 font-display text-[19px] font-semibold leading-tight tracking-tight text-fg`}>
            <span aria-hidden className="text-[13px] font-medium text-fg/55">
              {i + 1}
            </span>
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Examples in the visitor's own currency, with amounts that make sense there
// (₹ for India, dollars and similar everywhere else).
type Local = { m: (major: number) => string; cur: string; india: boolean };

function local(currency: string, india: boolean): Local {
  const d = decimalsOf(currency);
  return {
    m: (major) => formatMoney(Math.round(major * 10 ** d), currency),
    cur: currency,
    india,
  };
}

// A moment, drawn: a photo, a few words, the day and a reaction. (No real photo: it's only a picture of the idea.)
function MomentArt() {
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="rise flex h-[120px] items-center justify-center bg-mist text-fg/55">
        <CameraIcon size={34} />
      </div>
      <div className="px-4 pb-4 pt-3">
        <p className="rise rise-2 font-display text-[20px] font-semibold leading-snug">The boat we almost missed</p>
        <p className="rise rise-2 mt-0.5 text-[13px] text-fg/55">Day 3 · Only your group</p>
        <span className="rise rise-3 mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border-[1.5px] border-fg px-3 text-sm tabular-nums">
          <span aria-hidden>😂</span> 4
        </span>
      </div>
    </Card>
  );
}

function makeSlides(L: Local): Slide[] {
  const v = L.india ? { dinner: 1200, each: 300, back: 900 } : { dinner: 120, each: 30, back: 90 };
  return [
    {
      id: "group",
      title: "Make a group.",
      caption: "One for the trip, home, or the two of you. Friends join from a link or a QR code.",
      art: <Cheers />,
    },
    {
      id: "add",
      title: "Add what you paid.",
      caption: "Type it, scan the bill or just say it. Loopin splits it to the last paisa or cent, in any currency.",
      art: (
        <Card>
          <p className="rise text-xs text-gray-400">Beach dinner</p>
          <p className="rise rise-2 mt-1 font-display text-[34px] font-semibold leading-none tracking-tight">{L.m(v.dinner)}</p>
          <div className="rise rise-3 mt-4 space-y-2">
            <span className="flex items-center gap-2.5 rounded-[14px] bg-mist px-3 py-2.5 text-sm">
              <Dot name="You" tone="bg-canvas" />
              <span className="min-w-0 flex-1 truncate">Paid by You</span>
              <span className="text-fg/75">Change</span>
            </span>
            <span className="flex items-center gap-2.5 rounded-[14px] bg-mist px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">Split between 4 people</span>
                <span className="block truncate text-xs text-fg/55">Equally · {L.m(v.each)} each</span>
              </span>
              <span className="text-fg/75">Change</span>
            </span>
          </div>
          <p className={`rise rise-4 mt-4 text-right text-sm font-semibold ${owed}`}>You’re owed {L.m(v.back)}</p>
        </Card>
      ),
    },
    {
      id: "settle",
      title: "See who owes. Then settle.",
      caption: "Pay each other however you like. It counts once the person you paid confirms. Loopin never moves money; it just keeps the score straight.",
      art: (
        <Card>
          <div className="rise flex items-center gap-3">
            <Dot name="Ravi" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Ravi pays you</span>
              <span className="block text-xs text-gray-400">One payment clears the trip</span>
            </span>
            <span className={`font-display text-lg ${owed}`}>{L.m(v.back)}</span>
          </div>
          <div className="rise rise-3 mt-4 rounded-2xl bg-mist p-3">
            <p className="text-sm">
              Ravi says they paid
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center text-[13px] font-semibold">
              <span className="rounded-full bg-fg px-3 py-2 text-canvas">Confirm received</span>
              <span className="rounded-full border border-line px-3 py-2 text-fg/80">Not received</span>
            </div>
          </div>
        </Card>
      ),
    },
    {
      id: "story",
      title: "Every trip becomes a story.",
      caption: "When it’s over, Loopin turns the spending into a short story to share with the group.",
      art: <StoryPoster L={L} />,
    },
    {
      id: "postcard",
      title: "Send a postcard.",
      caption: "Pick a photo from the trip, write a line and send it to a friend, in Loopin or on WhatsApp.",
      art: <PostcardArt />,
    },
    {
      id: "moment",
      title: "Keep the little moments.",
      caption: "Add one photo and a few words to your trip group. Only the people in it see them.",
      art: <MomentArt />,
    },
    {
      id: "passport",
      title: "Collect your passport.",
      caption: "Every trip adds a stamp. See the places you’ve been to. It’s private until you choose to share it.",
      art: <PassportArt />,
    },
  ];
}

export function IntroTour({
  startHref = "/groups/new",
  cta = "Create your first group",
  signInHref,
  currency = "USD",
  india = false,
}: {
  startHref?: string;
  cta?: string;
  signInHref?: string;
  currency?: string;
  india?: boolean;
}) {
  const slides = useMemo(() => makeSlides(local(currency, india)), [currency, india]);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const last = active === slides.length - 1;

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setActive(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="intro-tour -mb-24 flex min-h-[calc(100dvh-3rem)] flex-col">
      <header className="flex items-center justify-between">
        <p className="font-display text-[26px] font-semibold leading-none tracking-tight">loopin</p>
        <span className="flex items-center gap-3">
          <GetAppButton variant="icon" className="h-9" />
          {/* A full page load (not an in-app hop), so Home re-reads "tour seen" and shows the start screen. */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              seen();
              window.location.assign("/");
            }}
            aria-label="Home"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-gray-700 active:bg-mist"
          >
            <HomeIcon size={18} />
          </a>
          <Link href={startHref} onClick={seen} className="hit -my-1 px-1 py-2.5 text-sm text-gray-500">
            Skip
          </Link>
        </span>
      </header>

      <div className="mt-6 flex gap-1.5" role="tablist" aria-label="Tour">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={`Slide ${i + 1}`}
            onClick={() => go(i)}
            className={`hit hit-lg h-1 flex-1 rounded-full transition-colors ${i <= active ? "bg-fg" : "bg-gray-300"}`}
          />
        ))}
      </div>

      <div ref={track} tabIndex={0} aria-label="Tour slides" className="no-scrollbar -mx-5 mt-8 flex flex-1 snap-x snap-mandatory overflow-x-auto">
        {slides.map((s, i) => (
          <section
            key={s.id}
            className="tour-slide flex w-full shrink-0 snap-center flex-col px-5"
            data-active={i === active}
            aria-hidden={i !== active}
            data-tour-slide={s.id}
            onClick={(e) => {
              // Like stories: tap the right side for the next slide, the left side to go back.
              const r = e.currentTarget.getBoundingClientRect();
              if (e.clientX - r.left < r.width * 0.4) go(Math.max(0, active - 1));
              else if (!last) go(active + 1);
            }}
          >
            <h1 className="font-display text-[32px] font-semibold leading-[1.1] tracking-tight">{s.title}</h1>
            <div className="flex flex-1 items-center justify-center py-8">{s.art}</div>
            <p className="min-h-[3.5rem] text-center text-sm text-gray-500">{s.caption}</p>
          </section>
        ))}
      </div>

      <div className="mt-6 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Link href={startHref} onClick={seen} className="pop block w-full bg-fg px-4 py-4 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]">
          {cta}
        </Link>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => go(active - 1)}
            disabled={active === 0}
            className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 active:bg-mist disabled:opacity-0"
            data-tour-back
          >
            Back
          </button>
          <span className="text-xs tabular-nums text-gray-400" data-tour-at>
            {active + 1} / {slides.length}
          </span>
          <button type="button" onClick={() => go(last ? 0 : active + 1)} className="rounded-full px-4 py-2 text-sm font-medium text-fg active:bg-mist" data-tour-next>
            {last ? "See it again" : "Next"}
          </button>
        </div>
        {/* One link under the button: sign-in when it applies, otherwise the guide. */}
        {last && !signInHref && (
          <Link href="/how-it-works" onClick={seen} className="block text-center text-xs text-gray-500" data-tour-guide-link>
            <span className="font-medium text-fg underline underline-offset-4">Every feature, explained</span>
          </Link>
        )}
        {signInHref && (
          <Link href={signInHref} className="block text-center text-xs text-gray-500">
            Save your groups to your email · <span className="font-medium text-fg underline underline-offset-4">Sign up or sign in</span>
          </Link>
        )}
      </div>
    </div>
  );
}

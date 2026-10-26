"use client";

import Link from "@/components/Link";
import { GetAppButton } from "./GetApp";
import { HomeIcon } from "./icons";

// Remember the tour was seen, so Home shows the start screen next time.
const seen = () => {
  try {
    document.cookie = "lp_tour=1; path=/; max-age=31536000; samesite=lax";
  } catch {
    /* ignore */
  }
};
import { useEffect, useMemo, useRef, useState } from "react";
import { currencyInfo, decimalsOf, formatMoney } from "@/lib/money";

// The intro tour, in the visitor's own currency: six swipeable slides (start, balances, currencies, settling, home & couples, undo) that show what Loopin does, each with
// a small animated picture. Shown to first-time visitors on the home screen,
// and any time at /welcome.

type Slide = { id: string; title: [string, string]; caption: string; art: React.ReactNode };

const owed = "text-owed";
const owe = "text-owe";

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

// Two beer glasses that swing in and clink, with bubbles and a spark.
function Cheers() {
  const Mug = ({ flip }: { flip?: boolean }) => (
    <svg viewBox="0 0 90 110" className={`h-32 w-24 ${flip ? "mug-right" : "mug-left"}`} aria-hidden>
      <g transform={flip ? "translate(90 0) scale(-1 1)" : undefined}>
        <path d="M66 38h8a12 12 0 0 1 12 12v18a12 12 0 0 1-12 12h-8" fill="none" stroke="#f4f2ec" strokeWidth="6" />
        <rect x="8" y="28" width="60" height="76" rx="8" fill="#e8a33a" />
        <rect x="8" y="28" width="60" height="76" rx="8" fill="url(#shine)" />
        <path d="M6 30c0-12 10-18 18-14 4-8 18-10 24-2 8-6 22-2 22 10 6 2 6 10 0 12H6z" fill="#f4f2ec" />
        <circle className="bubble" cx="24" cy="86" r="3" fill="#fbe7b0" />
        <circle className="bubble" style={{ animationDelay: "0.7s" }} cx="44" cy="92" r="2.5" fill="#fbe7b0" />
        <circle className="bubble" style={{ animationDelay: "1.3s" }} cx="34" cy="78" r="2" fill="#fbe7b0" />
      </g>
    </svg>
  );
  return (
    <div className="relative flex flex-col items-center">
      <svg width="0" height="0" aria-hidden>
        <defs>
          <linearGradient id="shine" x1="0" x2="1">
            <stop offset="0.1" stopColor="#fff" stopOpacity="0.25" />
            <stop offset="0.35" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <span className="clink absolute left-1/2 top-0 -translate-x-1/2 text-4xl text-[#fbe7b0]" aria-hidden>
        ✦
      </span>
      <div className="mt-6 flex items-end">
        <Mug />
        <Mug flip />
      </div>
      <div className="mt-6 flex gap-2">
        {["✈️ Trip", "🏠 Flat", "💞 Couple"].map((t, i) => (
          <span key={t} className={`rise rise-${i + 2} rounded-full border border-line bg-canvas px-3 py-1 text-xs text-gray-600`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

// Examples in the visitor's own currency, with amounts that make sense there
// (₹ for India, dollars and similar everywhere else).
type Local = { m: (major: number) => string; cur: string; foreign: string; india: boolean };

function local(currency: string, india: boolean): Local {
  const d = decimalsOf(currency);
  return {
    m: (major) => formatMoney(Math.round(major * 10 ** d), currency),
    cur: currency,
    foreign: india ? "THB" : currency === "EUR" ? "USD" : "EUR",
    india,
  };
}

function makeSlides(L: Local): Slide[] {
  const v = L.india
    ? { owe: 240, owed1: 680, owed2: 500, total: 940, foreignAmt: 1800, conv: 5104, fee: 153, real: 5257, rent: 42000, ahead: 2670, paid: 3600, lent: 2700 }
    : { owe: 24, owed1: 68, owed2: 50, total: 94, foreignAmt: 120, conv: 130.5, fee: 3.92, real: 134.42, rent: 2400, ahead: 267, paid: 48, lent: 36 };
  const flag = (c: string) => currencyInfo(c).flag;
  return [

  {
    id: "cheers",
    title: ["Split it.", "Cheers. 🍻"],
    caption: "Free, no ads. Make a group for a trip, a flat, the two of you, or a class gift. Friends join from a link, a QR code or an email in 30 seconds. No password.",
    art: <Cheers />,
  },
  {
    id: "owes",
    title: ["See who owes who.", "At a glance."],
    caption: "Every expense shows what it means for you. Balances update the moment anyone adds something.",
    art: (
      <Card>
        <p className="rise text-xs text-gray-400">{L.india ? "Goa weekend" : "Lake weekend"}</p>
        <div className="rise rise-2 mt-3 flex items-center gap-3">
          <Dot name="Maya" />
          <span className="flex-1 text-sm">You owe Maya</span>
          <span className={`font-display text-lg ${owe}`}>{L.m(v.owe)}</span>
        </div>
        <div className="rise rise-3 mt-3 flex items-center gap-3">
          <Dot name="Sam" />
          <span className="flex-1 text-sm">Sam owes you</span>
          <span className={`font-display text-lg ${owed}`}>{L.m(v.owed1)}</span>
        </div>
        <div className="rise rise-4 mt-3 flex items-center gap-3">
          <Dot name="Priya" />
          <span className="flex-1 text-sm">Priya owes you</span>
          <span className={`font-display text-lg ${owed}`}>{L.m(v.owed2)}</span>
        </div>
        <div className="rise rise-4 mt-4 h-1.5 overflow-hidden rounded-full bg-mist">
          <div className="meter-bar h-full w-3/4 origin-left rounded-full bg-[#25a96f]" />
        </div>
        <p className="rise rise-5 mt-2 text-right text-xs text-gray-400">You’re owed {L.m(v.total)} overall</p>
      </Card>
    ),
  },
  {
    id: "currency",
    title: ["Any currency.", "The real cost."],
    caption: "Live exchange rates, plus your card’s foreign-transaction fee — something most split apps ignore. Balances show in both currencies.",
    art: (
      <Card>
        <div className="rise flex items-center justify-between">
          <span className="rounded-full bg-mist px-3 py-1 text-sm">{flag(L.foreign)} {L.foreign}</span>
          <span className="text-gray-400">→</span>
          <span className="rounded-full bg-mist px-3 py-1 text-sm">{flag(L.cur)} {L.cur}</span>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="rise rise-2 flex justify-between"><dt className="text-gray-500">Dinner, paid by card</dt><dd>{formatMoney(v.foreignAmt * 100, L.foreign)}</dd></div>
          <div className="rise rise-3 flex justify-between"><dt className="text-gray-500">At today’s rate</dt><dd>{L.m(v.conv)}</dd></div>
          <div className="rise rise-4 flex justify-between"><dt className="text-gray-500">Card fee 3%</dt><dd className={owe}>+ {L.m(v.fee)}</dd></div>
          <div className="rise rise-5 flex justify-between border-t border-line pt-2 font-semibold"><dt>Real cost to split</dt><dd className="font-display text-lg">{L.m(v.real)}</dd></div>
        </dl>
      </Card>
    ),
  },
  {
    id: "settle",
    title: ["Fewest payments.", "One tap."],
    caption: "Smart Settle works out the shortest way to square up, inside a group or across all your groups. Trip over? Share the trip report on WhatsApp.",
    art: (
      <Card>
        <svg viewBox="0 -14 240 140" className="h-36 w-full" aria-hidden>
          <g className="tangle" stroke="#8a877f" strokeWidth="1.6" fill="none">
            <path d="M30 20 L210 20" /><path d="M30 20 L210 90" /><path d="M30 90 L210 20" /><path d="M30 90 L210 90" /><path d="M30 20 L30 90" /><path d="M210 20 L210 90" />
          </g>
          <g className="clean" stroke="#6fe3a8" strokeWidth="3" fill="none" strokeLinecap="round">
            <path d="M44 22 C 100 30, 140 30, 196 22" /><path d="M44 88 C 100 80, 140 80, 196 88" />
          </g>
          {([[30, 20, "Emma"], [30, 90, "Leo"], [210, 20, "Aisha"], [210, 90, "Noah"]] as const).map(([x, y, t]) => (
            <g key={t}>
              <circle cx={x} cy={y} r="13" fill="#1f1f24" stroke="#2b2b31" />
              <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fill="#f4f2ec">{t.slice(0, 1)}</text>
              <text x={x} y={y > 50 ? y + 26 : y - 18} textAnchor="middle" fontSize="9" fill="#8a877f">{t}</text>
            </g>
          ))}
        </svg>
        <p className="rise rise-3 text-center text-sm text-gray-500">
          6 payments → <strong className="text-fg">2</strong>
        </p>
      </Card>
    ),
  },
  {
    id: "home",
    title: ["Flats & couples.", "Bills on repeat."],
    caption: "Set rent and Wi-Fi to repeat monthly and Loopin adds them on the day. Electricity asks whoever pays, and couples see who’s ahead of their split.",
    art: (
      <Card>
        <p className="rise text-xs text-gray-400">{L.india ? "Flat 402" : "Apt 4B"} · This month</p>
        <div className="rise rise-2 mt-3 flex items-center justify-between text-sm">
          <span>Rent</span>
          <span className="flex items-center gap-2">
            <span className="font-display">{L.m(v.rent)}</span>
            <span className={`text-xs ${owed}`}>added ✓</span>
          </span>
        </div>
        <div className="rise rise-3 mt-2.5 flex items-center justify-between text-sm">
          <span>Electricity</span>
          <span className="border border-gray-300 px-2.5 py-1 text-xs font-semibold">Enter amount</span>
        </div>
        <div className="rise rise-4 mt-2.5 flex items-center justify-between text-sm">
          <span>{L.india ? "Milk" : "Internet"}</span>
          <span className="font-display">{L.india ? `${L.m(68)}/day` : `${L.m(60)}/mo`}</span>
        </div>
        <div className="rise rise-5 mt-4 border-t border-line pt-3">
          <p className="text-xs text-gray-400">Us · October together</p>
          <p className={`mt-1 font-display text-lg font-semibold ${owed}`}>Overall you’re {L.m(v.ahead)} ahead</p>
        </div>
      </Card>
    ),
  },
  {
    id: "pot",
    title: ["Card night?", "The Pot keeps score."],
    caption: "Poker or Teen Patti: note what each player takes from the pot and puts back. Loopin shows who won and who pays whom.",
    art: (
      <Card className="[background:radial-gradient(90%_100%_at_100%_0%,rgba(31,107,74,0.35)_0%,transparent_60%)]">
        <p className="rise text-xs text-gray-400">🃏 Teen Patti · Diwali night</p>
        {(
          [
            ["Ravi", L.india ? 2000 : 200, L.india ? 2600 : 260],
            ["You", L.india ? 1000 : 100, L.india ? 700 : 70],
            ["Meera", L.india ? 1500 : 150, L.india ? 1200 : 120],
          ] as const
        ).map(([who, took, back], i) => (
          <div key={who} className={`rise rise-${i + 2} mt-2.5 flex items-center justify-between text-sm`}>
            <span className="flex items-center gap-2">
              <Dot name={who} />
              <span>
                <span className="block font-medium">{who}</span>
                <span className="block text-[11px] text-gray-400">
                  took {L.m(took)} · back {L.m(back)}
                </span>
              </span>
            </span>
            <span className={`font-display font-semibold ${back > took ? owed : owe}`}>
              {back > took ? "+" : "−"}
              {L.m(Math.abs(back - took))}
            </span>
          </div>
        ))}
        <p className="rise rise-5 mt-4 border-t border-line pt-3 text-sm">
          You pay Ravi <strong className="font-display">{L.m(L.india ? 300 : 30)}</strong> · Meera pays Ravi <strong className="font-display">{L.m(L.india ? 300 : 30)}</strong>
        </p>
      </Card>
    ),
  },
  {
    id: "undo",
    title: ["Oops?", "Undo anything."],
    caption: "Anyone can fix a mistake. Every change is kept in the history and everyone in the group is told.",
    art: (
      <Card className="relative">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-mist text-lg">🍽️</span>
          <span className="relative flex-1">
            <span className="block text-sm font-medium">Pizza night</span>
            <span className="block text-xs text-gray-400">You paid {L.m(v.paid)}</span>
            <span className="strike absolute left-0 top-2.5 h-px w-full bg-gray-400" />
          </span>
          <span className="text-sm text-owed">you lent {L.m(v.lent)}</span>
        </div>
        <div className="undo-pill mx-auto mt-5 flex w-fit items-center gap-3 border border-line bg-canvas px-4 py-2 text-sm">
          Deleted · <span className="font-semibold">Undo ↺</span>
        </div>
      </Card>
    ),
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
          <Link href={startHref} onClick={seen} className="py-1 text-sm text-gray-500">
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
            className={`h-1 flex-1 rounded-full transition-colors ${i <= active ? "bg-fg" : "bg-gray-300"}`}
          />
        ))}
      </div>

      <div ref={track} className="no-scrollbar -mx-5 mt-8 flex flex-1 snap-x snap-mandatory overflow-x-auto">
        {slides.map((s, i) => (
          <section
            key={s.id}
            className="tour-slide flex w-full shrink-0 snap-center flex-col px-5"
            data-active={i === active}
            aria-hidden={i !== active}
          >
            <h1 className="font-display text-[40px] font-semibold leading-[1.05] tracking-tight">
              {s.title[0]}
              <br />
              <span className="text-gray-500">{s.title[1]}</span>
            </h1>
            <div className="flex flex-1 items-center justify-center py-8">{s.art}</div>
            <p className="min-h-[3.5rem] text-center text-sm text-gray-500">{s.caption}</p>
          </section>
        ))}
      </div>

      <div className="mt-6 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {last && <GetAppButton variant="card" />}
        <Link href={startHref} onClick={seen} className="pop block w-full bg-fg px-4 py-4 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]">
          {cta}
        </Link>
        <button type="button" onClick={() => go(last ? 0 : active + 1)} className="block w-full py-2 text-center text-sm font-medium text-gray-600">
          {last ? "↺ See it again" : "Next →"}
        </button>
        {signInHref && (
          <Link href={signInHref} className="block text-center text-xs text-gray-500">
            Save your groups to your email · <span className="font-medium text-fg underline underline-offset-4">Sign up or sign in</span>
          </Link>
        )}
      </div>
    </div>
  );
}

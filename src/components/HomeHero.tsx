import Image from "next/image";
import Link from "@/components/Link";
import { GroupCover } from "@/components/GroupCover";
import { avatarTone } from "@/components/ui";
import type { CoverChoice } from "@/lib/covers";

// The top of Home: your next trip's photo, full width, with the countdown in big type over it
// ("Goa in / 12 days"); without a trip, your most active group's picture and a greeting.
// The header (icons) and the stories sit on the photo too.
export function HomeHero({
  photo,
  cover,
  uid,
  letter,
  crew,
  chip,
  small,
  big,
  href,
  header,
  children,
  tall,
  bigLength = 0,
  label,
  countdown,
  extra,
}: {
  photo?: string;
  cover?: { kind: CoverChoice; src?: string };
  uid: string;
  letter?: string;
  crew: string[];
  chip?: string;
  small: string;
  big?: React.ReactNode;
  bigLength?: number;
  href?: string;
  label?: string;
  countdown?: string;
  extra?: React.ReactNode;
  header: React.ReactNode;
  children?: React.ReactNode;
  tall: boolean;
}) {
  const size = !big ? "" : bigLength <= 7 ? "text-[clamp(64px,21vw,88px)]" : bigLength <= 10 ? "text-[clamp(52px,16vw,68px)]" : "text-[clamp(40px,12vw,52px)]";
  const words = (
    <>
      {chip && (
        <span className="glass inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[13px] font-semibold">
          {crew.length > 0 && (
            <span className="flex" aria-hidden>
              {crew.slice(0, 3).map((n, i) => (
                <span key={`${n}-${i}`} className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] border-[#1a1a1e] text-[10px] font-bold ${i ? "-ml-1.5" : ""} ${avatarTone(n)}`}>
                  {n.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
          )}
          {chip}
        </span>
      )}
      <span className={`block font-display font-medium leading-none tracking-[-0.02em] ${big ? "mt-4 text-[30px]" : "mt-4 text-[clamp(34px,10vw,42px)] font-semibold leading-[1.04]"}`}>{small}</span>
      {big && (
        <span className={`block font-display font-semibold leading-[0.92] tracking-[-0.03em] [text-shadow:0_4px_30px_rgba(0,0,0,0.35)] ${size}`} data-hero-big>
          {big}
        </span>
      )}
    </>
  );
  return (
    <section aria-label={label ?? small} data-countdown={countdown} className="relative -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))]" data-home-hero>
      <div className={`relative overflow-hidden ${tall ? "h-[500px]" : "h-[380px]"}`} aria-hidden>
        {photo ? (
          <Image src={photo} alt="" fill priority sizes="(max-width: 448px) 100vw, 448px" quality={80} className="lp-drift object-cover" />
        ) : cover ? (
          <GroupCover kind={cover.kind} src={cover.src} uid={`hero-${uid}`} letter={letter} sizes="(max-width: 448px) 100vw, 448px" priority drift />
        ) : null}
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,13,15,0.6)_0%,rgba(13,13,15,0)_24%,rgba(13,13,15,0.12)_46%,rgba(13,13,15,0.86)_80%,#0d0d0f_100%)]" />
      </div>
      <div className="absolute inset-x-0 top-0 px-5 pt-[max(1.1rem,env(safe-area-inset-top))]">{header}</div>
      <div className={`absolute inset-x-5 ${tall ? "top-[118px]" : "top-[104px]"} text-fg`}>
        {href ? (
          <Link href={href} className="block active:opacity-90">
            {words}
          </Link>
        ) : (
          words
        )}
        {extra && <div className="absolute right-0 top-0 flex items-center gap-2">{extra}</div>}
      </div>
      {children && <div className={`relative z-10 px-5 ${tall ? "-mt-[176px]" : "-mt-[150px]"}`}>{children}</div>}
    </section>
  );
}

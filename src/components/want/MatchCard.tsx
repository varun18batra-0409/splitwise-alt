"use client";

import Image from "next/image";
import { useFormStatus } from "react-dom";
import Link from "@/components/Link";
import { useRequestKey } from "@/components/FreshKeyInput";
import { planTogetherAction } from "@/app/wish-actions";

// "You and Nupur both want to go": a place you both put on your lists and each showed the other. One button: Plan together
// makes a trip named after the country and invites them the usual way (they choose Join or Not now). If you two already have
// that trip, the button opens it instead.
export function MatchCard({ friendId, name, code, country, photo, tripId }: { friendId: string; name: string; code: string; country: string; photo?: string | null; tripId?: string }) {
  const rid = useRequestKey();
  return (
    <article className="grid grid-cols-[36%_1fr] gap-1 overflow-hidden rounded-[20px] border border-fg/25 bg-white p-1.5" data-match-card={`${friendId}|${code}`}>
      {photo ? (
        <div className="relative min-h-[120px] overflow-hidden rounded-[14px] bg-mist">
          <Image src={photo} alt="" fill sizes="140px" className="object-cover" />
        </div>
      ) : (
        <div className="min-h-[120px] rounded-[14px] bg-mist" aria-hidden />
      )}
      <div className="min-w-0 py-2 pl-2.5 pr-2">
        <h3 className="font-display text-[22px] font-semibold leading-tight tracking-tight [overflow-wrap:normal] [word-break:normal]">{country}</h3>
        <p className="mt-1 text-[14px] leading-snug text-fg/75">You and {name} both want to go</p>
        {tripId ? (
          <Link href={`/groups/${tripId}`} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-fg/25 px-5 py-1.5 text-center text-[15px] font-semibold leading-tight text-fg active:bg-fg/10" data-open-plan>
            Open your {country} trip
          </Link>
        ) : (
          <form action={planTogetherAction}>
            <input type="hidden" name="friendId" value={friendId} />
            <input type="hidden" name="country" value={code} />
            <input type="hidden" name="rid" value={rid} suppressHydrationWarning />
            <Plan />
          </form>
        )}
      </div>
    </article>
  );
}

function Plan() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="mt-3 inline-flex h-11 items-center justify-center rounded-full border border-fg/25 px-5 text-[15px] font-semibold text-fg transition-transform active:scale-[0.97] active:bg-fg/10 disabled:opacity-60" data-plan-together>
      {pending ? "Making your trip…" : "Plan together"}
    </button>
  );
}

import Image from "next/image";
import { ShareIcon } from "@/components/PassportIcons";
import { CountryPicker } from "@/components/CountryPicker";
import { WishCard } from "@/components/want/WishCard";
import { MatchCard } from "@/components/want/MatchCard";
import { WishShareSheet } from "@/components/want/WishShareSheet";
import { addWishesAction } from "@/app/wish-actions";
import { countryPhoto } from "@/lib/country-photos";
import { countryOf } from "@/lib/geo";
import { SHARE_ALL, WISH_LIMIT, joinNames } from "@/lib/wishes";
import { currentFriends, existingPlans, loadMyWishes, matches, mySharing, sharedWithMe } from "@/lib/wishes-db";

// The Want to go tab: a private list of places. Matches first (a place you both want and each showed the other), then your
// list with who can see each place, Add a place | Share, and what friends showed you, grouped by friend.
// All the access rules are in src/lib/wishes-db.ts; this only draws what it returns.
export async function WantToGoTab({ accountId, wished, full }: { accountId: string; wished?: string; full?: boolean }) {
  const [mine, friends, shares, theirs, ms] = await Promise.all([loadMyWishes(accountId), currentFriends(accountId), mySharing(accountId), sharedWithMe(accountId), matches(accountId)]);
  const plans = await existingPlans(accountId, ms);
  const name = (c: string) => countryOf(c)?.name ?? c;
  const places = [...mine].sort((a, b) => name(a).localeCompare(name(b), "en")).map((code) => ({ code, name: name(code) }));
  const seen = shares.filter((s) => s.now).map((s) => ({ friendId: s.friendId, country: s.country }));
  const who = (c: string, now: boolean) => [...new Set(shares.filter((s) => s.now === now && (s.country === c || s.country === SHARE_ALL)).map((s) => s.name))].sort((a, b) => a.localeCompare(b, "en"));

  return (
    <div data-want-tab>
      {wished !== undefined && (
        <p role="status" className="mb-3 text-sm text-fg/75">
          {full ? `Your list is full (${WISH_LIMIT} places).` : Number(wished) > 1 ? `${Number(wished)} places added to your list.` : Number(wished) === 1 ? "Added to your list." : "Those were already on your list."}
        </p>
      )}

      {ms.length > 0 && (
        <section className="mb-6 space-y-3" aria-label="You both want to go" data-want-matches>
          {ms.flatMap((m) =>
            m.countries.map((c) => <MatchCard key={`${m.friendId}-${c}`} friendId={m.friendId} name={m.name} code={c} country={name(c)} photo={countryPhoto(c)} tripId={plans[`${m.friendId}|${c}`]} />),
          )}
        </section>
      )}

      <section id="list" className="scroll-mt-4" aria-labelledby="want-h">
        <h2 id="want-h" className="mb-3 font-display text-[26px] font-semibold leading-tight tracking-tight">
          Your list
        </h2>
        {mine.length === 0 ? (
          <div className="rounded-[20px] border border-line bg-white px-5 py-5">
            <p className="font-display text-xl font-semibold tracking-tight">Where do you want to go?</p>
            <p className="mt-1 text-sm text-fg/75">Add places you’d love to visit. Only you can see your list, unless you share it.</p>
          </div>
        ) : (
          <div className="space-y-3" data-wish-cards>
            {places.map((p) => {
              const now = who(p.code, true);
              const away = who(p.code, false);
              return (
                <WishCard
                  key={p.code}
                  code={p.code}
                  name={p.name}
                  photo={countryPhoto(p.code)}
                  lock={now.length ? `Shared with ${joinNames(now)}` : away.length ? `Shared with ${joinNames(away)} · when you’re in a group together` : "Only you"}
                  away={now.length && away.length ? `Also ${joinNames(away)} · when you’re in a group together` : undefined}
                />
              );
            })}
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <CountryPicker added={mine} mode="want" action={addWishesAction} tile />
          <WishShareSheet
            friends={friends.map((f) => ({ id: f.id, name: f.name.trim().split(/\s+/)[0] || f.name }))}
            places={places}
            shares={seen}
            label={
              <>
                <ShareIcon size={20} />
                Share
              </>
            }
          />
        </div>
      </section>

      {theirs.length > 0 && (
        <section className="mt-8" aria-labelledby="shared-h" data-shared-with-me>
          <h2 id="shared-h" className="mb-3 font-display text-[26px] font-semibold leading-tight tracking-tight">
            Shared with you
          </h2>
          <div className="space-y-3">
            {theirs.map((f) => (
              <div key={f.ownerId} className="rounded-[20px] border border-line bg-white px-4 py-3.5" data-shared-from={f.name}>
                <p className="text-[16px] font-semibold">{f.name}</p>
                <ul className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-3 min-[390px]:grid-cols-4">
                  {f.countries.map((c) => {
                    const photo = countryPhoto(c);
                    return (
                      <li key={c} className="flex min-w-0 flex-col items-center" data-shared-place={c}>
                        <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[14px] bg-[#efe8d6]">
                          {photo ? <Image src={photo} alt="" fill sizes="56px" className="object-cover" /> : <span aria-hidden className="text-[13px] font-extrabold text-[#5c564a]">{c}</span>}
                        </span>
                        <span className="mt-1 w-full text-center text-[13px] leading-tight text-fg/85">{name(c)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

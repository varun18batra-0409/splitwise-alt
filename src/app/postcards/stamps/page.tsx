import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { PageHeader } from "@/components/ui";
import { headers } from "next/headers";
import { visitorRegion } from "@/lib/region";
import { RARE, RARE_STAMP_IDS, baseStamp, rareOpen, rareStampsFor, stampSvg, withHome } from "@/lib/postcards/catalog";

export const metadata = { title: "Stamp album", robots: { index: false } };

// The rare stamps: each is on issue for a short window a year. A card you send or get with one puts it
// in your album; the rest wait as faint outlines with when they come back.
export default async function StampAlbumPage() {
  const me = await getAccount();
  if (!me) redirect("/signin?back=/postcards/stamps");
  const used = await db.postcard.findMany({
    where: { stamp: { startsWith: "r:" }, OR: [{ fromId: me.id }, { toId: me.id, OR: [{ opensAt: null }, { opensAt: { lte: new Date() } }] }] },
    select: { stamp: true },
    distinct: ["stamp"],
  });
  const have = new Set(used.map((u) => baseStamp(u.stamp)));
  const home = (me.homeCountry || visitorRegion(await headers()).country || "IN").toUpperCase();
  // The stamps issued where you live, plus any others you've been sent.
  const list = RARE_STAMP_IDS.filter((id) => rareStampsFor(home).includes(id) || have.has(id));
  const count = list.filter((id) => have.has(id)).length;
  return (
    <>
      <PageHeader title="Stamp album" back="/postcards" />
      <p className={`-mt-4 text-sm leading-relaxed text-fg/60 ${count > 0 ? "mb-2" : "mb-8"}`}>Limited stamps, each on issue for a few days or weeks a year. Send or receive a card with one to keep it here.</p>
      {/* No "0 of 9 collected": the count shows once there is a first stamp. */}
      {count > 0 && (
        <p className="mb-8 font-display text-[22px] font-semibold tracking-tight" data-album-count>
          {count} of {list.length} collected
        </p>
      )}
      <ul className="grid grid-cols-3 gap-x-4 gap-y-7 rounded-[22px] bg-[radial-gradient(120%_90%_at_0%_0%,#2a2620,#1b1915_70%)] px-5 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        {list.map((id, i) => {
          const r = RARE[id.slice(2)];
          const got = have.has(id);
          const open = rareOpen(id);
          return (
            <li key={id} className="flex flex-col items-center text-center" data-album-stamp={id} data-collected={got ? "1" : "0"}>
              <span
                aria-hidden
                className={`block w-[72px] [&>svg]:h-auto [&>svg]:w-full ${got ? `drop-shadow-[0_3px_4px_rgba(0,0,0,0.5)] ${i % 2 ? "rotate-[2deg]" : "-rotate-[2deg]"}` : "opacity-[0.16] grayscale"}`}
                dangerouslySetInnerHTML={{ __html: stampSvg(withHome(id, home), `al${i}`) }}
              />
              <span className={`mt-2 text-[12.5px] font-semibold ${got ? "text-fg" : "text-fg/60"}`}>{r.name}</span>
              <span className={`text-[11px] ${open ? "text-[#e2c27a]" : "text-fg/60"}`}>{open ? "On issue now" : r.when}</span>
            </li>
          );
        })}
      </ul>
      <Link href="/postcards/new" className="pop mt-8 flex h-12 items-center justify-center bg-fg text-[15px] font-semibold text-canvas">
        Write a postcard
      </Link>
    </>
  );
}

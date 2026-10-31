import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { PageHeader } from "@/components/ui";
import { PostcardFront } from "@/components/postcards/Card";
import { POSTCARD_FONTS_URL, openRareStamps, stampSvg } from "@/lib/postcards/catalog";
import { cardProps } from "@/lib/postcards/view";
import { SealedEnvelope, SealMark } from "@/components/postcards/Sealed";

export const metadata = { title: "Postcards", robots: { index: false } };

// Your postcards: the ones people sent you (new ones first) and the ones you sent.
export default async function PostcardsPage() {
  const me = await getAccount();
  if (!me) redirect("/signin?back=/postcards");
  const [got, sent, tz] = await Promise.all([
    db.postcard.findMany({ where: { toId: me.id }, orderBy: { createdAt: "desc" }, take: 60 }),
    db.postcard.findMany({ where: { fromId: me.id }, orderBy: { createdAt: "desc" }, take: 60 }),
    getTimeZone(),
  ]);
  const ids = [...new Set([...got.map((p) => p.fromId), ...sent.map((p) => p.toId)])];
  const names = new Map((ids.length ? await db.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((a) => [a.id, a.name.trim().split(/\s+/)[0] || "A friend"]));
  const now = new Date();
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz });
  const tilt = ["-rotate-[2deg]", "rotate-[1.5deg]", "-rotate-[1deg]", "rotate-[2.5deg]"];
  const shelf = (list: typeof got, who: (p: (typeof got)[number]) => string, label: string) => (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6" aria-label={label}>
      {list.map((p, i) => (
        <li key={p.id} data-postcard-item={p.id}>
          <Link href={`/postcards/${p.id}`} className={`relative block transition-transform active:scale-[0.97] ${tilt[i % tilt.length]}`}>
            {label === "Received" && p.opensAt && p.opensAt > now ? <SealedEnvelope from="" opens={short.format(p.opensAt)} small /> : <PostcardFront {...cardProps(p, "", tz).front} />}
            {p.reaction && <SealMark id={p.reaction} k={`s${p.id}`} className="absolute -bottom-3 -right-2 w-[24%] rotate-[10deg]" />}
          </Link>
          <p className="mt-2.5 flex items-center gap-1.5 truncate text-[13px] text-fg/70">
            {label === "Received" && !p.readAt && <span aria-label="New" className="h-2 w-2 shrink-0 rounded-full bg-owed" />}
            {who(p)}
          </p>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <link rel="stylesheet" href={POSTCARD_FONTS_URL} precedence="default" />
      <PageHeader title="Postcards" back="/account" />
      <p className="-mt-4 mb-6 text-sm leading-relaxed text-fg/60">Warm notes between people who’ve shared a group. Send one from any group, or from here.</p>
      <Link href="/postcards/new" className="pop mb-9 flex h-12 items-center justify-center bg-fg text-[15px] font-semibold text-canvas">
        Write a postcard
      </Link>
      <Link href="/postcards/stamps" className="-mt-5 mb-9 flex items-center gap-4 rounded-[20px] border border-line px-5 py-4 active:opacity-90" data-stamp-album-link>
        <span aria-hidden className="w-9 shrink-0 rotate-[-4deg] drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)] [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: stampSvg(openRareStamps()[0] ?? "r:newyear", "alb") }} />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[17px] font-semibold">Stamp album</span>
          <span className="block text-[13px] text-fg/55">{openRareStamps().length ? "A limited stamp is on issue now" : "Rare stamps you’ve collected"}</span>
        </span>
        <span aria-hidden className="text-xl">›</span>
      </Link>
      <h2 className="mb-4 font-display text-[22px] font-semibold tracking-tight">Received</h2>
      {got.length ? shelf(got, (p) => `From ${names.get(p.fromId) ?? "a friend"}`, "Received") : <p className="mb-2 rounded-[18px] bg-mist px-4 py-6 text-center text-sm text-fg/55">Postcards people send you land here.</p>}
      <h2 className="mb-4 mt-10 font-display text-[22px] font-semibold tracking-tight">Sent</h2>
      {sent.length ? shelf(sent, (p) => `To ${names.get(p.toId) ?? "a friend"}`, "Sent") : <p className="rounded-[18px] bg-mist px-4 py-6 text-center text-sm text-fg/55">Nothing sent yet.</p>}
    </>
  );
}

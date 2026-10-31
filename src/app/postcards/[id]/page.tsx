import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/Notice";
import { PostcardFlip, PostcardShare } from "@/components/postcards/PostcardView";
import { POSTCARD_FONTS_URL } from "@/lib/postcards/catalog";
import { cardProps } from "@/lib/postcards/view";
import { SealedEnvelope, SealMark } from "@/components/postcards/Sealed";
import { REACTIONS, reactionOf } from "@/lib/postcards/looks";
import { reactPostcardAction } from "@/app/postcard-actions";

export const metadata = { title: "Postcard", robots: { index: false } };

// One postcard, for the person who sent it or the person it went to: it lies on a warm table and
// turns over when tapped. Opening it marks it read.
export default async function PostcardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; sealed?: string }> }) {
  const { id } = await params;
  const { sent, sealed } = await searchParams;
  const me = await getAccount();
  if (!me) redirect(`/signin?back=/postcards/${id}`);
  const p = await db.postcard.findFirst({ where: { id, OR: [{ fromId: me.id }, { toId: me.id }] } });
  if (!p) notFound();
  const mine = p.fromId === me.id;
  const shut = Boolean(p.opensAt && p.opensAt > new Date());
  if (!mine && !p.readAt && !shut) await db.postcard.update({ where: { id }, data: { readAt: new Date() } });
  const [from, to, tz] = await Promise.all([
    db.account.findUnique({ where: { id: p.fromId }, select: { name: true } }),
    db.account.findUnique({ where: { id: p.toId }, select: { name: true } }),
    getTimeZone(),
  ]);
  const first = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] || "A friend";
  const c = cardProps(p, first(from?.name), tz);
  const opens = p.opensAt ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(p.opensAt) : "";
  const r = reactionOf(p.reaction);

  return (
    <>
      <link rel="stylesheet" href={POSTCARD_FONTS_URL} precedence="default" />
      <div aria-hidden data-tint="postcard" className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(120%_80%_at_50%_20%,#3a2c20_0%,#1a1410_55%,#0d0d0f_100%)]" />
      <PageHeader title={mine ? `To ${first(to?.name)}` : `From ${first(from?.name)}`} back="/postcards" />
      {sent && (
        <Notice params={["sent"]} className="mb-5">
          Sent{Number(sent) > 1 ? ` to ${Number(sent)} people` : ""}. It’s waiting in their postcards.
        </Notice>
      )}
      {sealed && (
        <Notice params={["sealed"]} className="mb-5">
          Sealed and sent back.
        </Notice>
      )}
      {shut && !mine ? (
        <>
          <p className="-mt-3 mb-8 text-center font-display text-[26px] font-semibold leading-tight tracking-tight" data-postcard-title>
            A sealed postcard
          </p>
          <div className="mx-auto max-w-[420px] -rotate-[2deg]">
            <SealedEnvelope from={first(from?.name)} opens={opens} />
          </div>
          <p className="mt-6 text-center text-sm leading-relaxed text-fg/60">
            {first(from?.name)} wrote this for {opens}.<br />
            It opens that morning. We’ll let you know.
          </p>
        </>
      ) : (
        <>
          <p className="-mt-3 mb-8 text-center font-display text-[26px] font-semibold leading-tight tracking-tight" data-postcard-title>
            {p.words ? `Greetings from ${p.words}` : mine ? "Your postcard" : "A postcard for you"}
          </p>
          <div className="relative mx-auto max-w-[420px] -rotate-[2deg]">
            <PostcardFlip front={c.front} back={c.back} />
            {r && <SealMark id={r.id} k={p.id} className="absolute -bottom-5 -right-3 w-[17%] rotate-[10deg]" />}
          </div>
          <p className="mt-6 text-center text-sm text-fg/50">Tap the card to turn it over</p>
          {mine && shut && (
            <p className="mt-3 text-center text-sm text-[#e2a3a7]" data-sealed-until>
              Sealed for {first(to?.name)} until {opens}
            </p>
          )}
          {r && (
            <p className="mt-3 text-center text-sm text-fg/70" data-reaction={r.id}>
              {mine ? `${first(to?.name)} sealed it: “${r.name}”` : `You sealed it: “${r.name}”`}
            </p>
          )}
        </>
      )}
      <div className="mx-auto mt-8 max-w-[420px] space-y-3">
        {!mine && !shut && (
          <section aria-label="Seal it back" className="mb-6">
            <p className="mb-3 text-center text-[13px] font-semibold text-fg/55">Press a seal back on it</p>
            <div className="flex justify-center gap-3">
              {REACTIONS.map((x) => (
                <form key={x.id} action={reactPostcardAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="reaction" value={x.id} />
                  <button type="submit" aria-label={`Seal: ${x.name}`} aria-pressed={p.reaction === x.id} data-haptic="success" className={`flex w-[58px] flex-col items-center gap-1.5 transition-transform active:scale-90 ${p.reaction && p.reaction !== x.id ? "opacity-45" : ""}`}>
                    <SealMark id={x.id} k={`b${x.id}`} className="w-[46px]" />
                    <span className="text-[10.5px] leading-tight text-fg/65">{x.name}</span>
                  </button>
                </form>
              ))}
            </div>
          </section>
        )}
        {!mine && !shut && (
          <Link href={`/postcards/new?to=${p.fromId}${p.groupId ? `&group=${p.groupId}` : ""}`} className="pop flex h-12 items-center justify-center bg-fg text-[15px] font-semibold text-canvas">
            Write back
          </Link>
        )}
        {mine && (
          <Link href={`/postcards/new?from=${p.id}`} className="pop flex h-12 items-center justify-center bg-fg text-[15px] font-semibold text-canvas" data-send-again>
            Use this card again
          </Link>
        )}
        {!shut || mine ? <PostcardShare front={c.front} back={c.back} name={`postcard-${p.id.slice(-6)}`} /> : null}
      </div>
    </>
  );
}

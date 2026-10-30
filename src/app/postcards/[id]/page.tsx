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

export const metadata = { title: "Postcard", robots: { index: false } };

// One postcard, for the person who sent it or the person it went to: it lies on a warm table and
// turns over when tapped. Opening it marks it read.
export default async function PostcardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { id } = await params;
  const { sent } = await searchParams;
  const me = await getAccount();
  if (!me) redirect(`/signin?back=/postcards/${id}`);
  const p = await db.postcard.findFirst({ where: { id, OR: [{ fromId: me.id }, { toId: me.id }] } });
  if (!p) notFound();
  const mine = p.fromId === me.id;
  if (!mine && !p.readAt) await db.postcard.update({ where: { id }, data: { readAt: new Date() } });
  const [from, to, tz] = await Promise.all([
    db.account.findUnique({ where: { id: p.fromId }, select: { name: true } }),
    db.account.findUnique({ where: { id: p.toId }, select: { name: true } }),
    getTimeZone(),
  ]);
  const first = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] || "A friend";
  const c = cardProps(p, first(from?.name), tz);

  return (
    <>
      <link rel="stylesheet" href={POSTCARD_FONTS_URL} precedence="default" />
      <div aria-hidden data-tint="postcard" className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(120%_80%_at_50%_20%,#3a2c20_0%,#1a1410_55%,#0d0d0f_100%)]" />
      <PageHeader title={mine ? `To ${first(to?.name)}` : `From ${first(from?.name)}`} back="/postcards" />
      {sent && (
        <Notice params={["sent"]} className="mb-5">
          Sent{Number(sent) > 1 ? ` to ${Number(sent)} people` : ""}. It’s waiting in their passport.
        </Notice>
      )}
      <p className="-mt-3 mb-8 text-center font-display text-[26px] font-semibold leading-tight tracking-tight" data-postcard-title>
        {p.words ? `Greetings from ${p.words}` : mine ? "Your postcard" : "A postcard for you"}
      </p>
      <div className="mx-auto max-w-[420px] -rotate-[2deg]">
        <PostcardFlip front={c.front} back={c.back} start={mine || p.readAt ? "front" : "front"} />
      </div>
      <p className="mt-6 text-center text-sm text-fg/50">Tap the card to turn it over</p>
      <div className="mx-auto mt-8 max-w-[420px] space-y-3">
        {!mine && (
          <Link href={`/postcards/new?to=${p.fromId}${p.groupId ? `&group=${p.groupId}` : ""}`} className="pop flex h-12 items-center justify-center bg-fg text-[15px] font-semibold text-canvas">
            Write back
          </Link>
        )}
        <PostcardShare front={c.front} back={c.back} name={`postcard-${p.id.slice(-6)}`} />
      </div>
    </>
  );
}

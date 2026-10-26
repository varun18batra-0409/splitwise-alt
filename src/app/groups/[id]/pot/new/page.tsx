import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { startGameAction } from "@/app/pot-actions";
import { POT_GAMES } from "@/lib/pot";

// Start a game: what you're playing and who's at the table.
export default async function NewGamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; first?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const group = await db.group.findUnique({ where: { id }, include: { members: { where: { leftAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) notFound();
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect("/private");
  if (group.type !== "pot") redirect(`/groups/${group.id}`);
  const chip =
    "relative flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold has-[:checked]:border-fg has-[:checked]:bg-fg has-[:checked]:text-canvas has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent";
  return (
    <>
      <PageHeader title="Start a game" back={`/groups/${group.id}`} />
      {sp.error && <ErrorNote>{sp.error.slice(0, 160)}</ErrorNote>}
      {sp.first && (
        <p className="-mt-3 mb-5 rounded-xl bg-owed/10 px-4 py-3 text-sm text-owed">
          Your Pot is ready 🃏 Add the players below: just their names is fine, nobody has to join Loopin.
        </p>
      )}
      <p className="-mt-3 mb-6 text-sm text-gray-500">Everyone takes money from the pot to play and puts back what’s left at the end. Loopin works out who won and who pays whom.</p>
      <form action={startGameAction} className="space-y-6">
        <input type="hidden" name="groupId" value={group.id} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-600">What are you playing?</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {POT_GAMES.map((g, i) => (
              <label key={g.id} className={chip}>
                <input type="radio" name="game" value={g.id} defaultChecked={i === 0} className="sr-only" />
                <span aria-hidden>{g.emoji}</span> {g.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">
            Name <span className="font-normal text-gray-400">(optional)</span>
          </span>
          <input name="name" maxLength={60} placeholder="Diwali night, Round 2…" autoComplete="off" className={inputClass} />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-600">Who’s playing?</legend>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {group.members.map((m) => (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                  <input type="checkbox" name="players" value={m.id} defaultChecked className="h-5 w-5 accent-[#6fe3a8]" />
                  <span className="min-w-0 flex-1 truncate">{m.id === myId ? `${m.name} (you)` : m.name}</span>
                  {!m.accountId && <span className="text-[11px] text-gray-400">just a name</span>}
                </label>
              </li>
            ))}
          </ul>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium text-gray-600">
              Add players by name <span className="font-normal text-gray-400">(they don’t need Loopin)</span>
            </span>
            <input name="newNames" maxLength={1000} placeholder="Chirag, Dev, Neha" autoComplete="off" className={inputClass} />
          </label>
          <p className="mt-2 text-xs text-gray-500">
            Just names is fine: you keep count for them. If they ever want to see it themselves, they can{" "}
            <Link href={`/groups/${group.id}/invite`} className="font-semibold text-fg underline">
              join with the link
            </Link>{" "}
            and take over their name. You’re the host: you finish the game.
          </p>
        </fieldset>
        <button type="submit" className={primaryButtonClass}>
          Start the game
        </button>
      </form>
    </>
  );
}

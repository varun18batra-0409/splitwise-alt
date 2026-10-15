import { notFound } from "next/navigation";
import { GetAppButton } from "@/components/GetApp";
import { db } from "@/lib/db";
import { joinAsExisting, joinAsNew } from "@/app/actions";
import { Avatar, ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";

// Where invite links land. No account needed — just pick or type a name.
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { code } = await params;
  const { error } = await searchParams;
  const group = await db.group.findUnique({
    where: { inviteCode: code },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!group || group.deletedAt) notFound();

  return (
    <>
      <PageHeader title={`Join ${group.name}`} />

      {error === "taken" && (
        <ErrorNote>That name is already in the group. Tap it in the list instead, or use a different name.</ErrorNote>
      )}
      {error === "missing" && <ErrorNote>Please type your name.</ErrorNote>}
      {error === "busy" && <ErrorNote>Too many joins from here in the last hour. Wait a bit and try again.</ErrorNote>}

      {group.members.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium text-gray-600">Are you one of these people?</h2>
          <ul className="space-y-2">
            {group.members.map((m) => (
              <li key={m.id}>
                <form action={joinAsExisting}>
                  <input type="hidden" name="code" value={code} />
                  <input type="hidden" name="memberId" value={m.id} />
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left active:bg-gray-50"
                  >
                    <Avatar name={m.name} />
                    <span className="font-medium">{m.name}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={joinAsNew} className="space-y-4">
        <input type="hidden" name="code" value={code} />
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">
            {group.members.length > 0 ? "Not on the list? Enter your name" : "Your name"}
          </span>
          <input name="name" required placeholder="Your name" autoComplete="given-name" className={inputClass} />
        </label>
        <button type="submit" className={primaryButtonClass}>
          Join group
        </button>
      </form>

      {/* Opened from an invite: offer the app straight away. */}
      <GetAppButton variant="card" className="mt-10" />
    </>
  );
}

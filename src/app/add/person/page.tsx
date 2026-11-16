import { redirect } from "next/navigation";
import { getAccount, getMemberships } from "@/lib/identity";
import { loadMyGroupsLight } from "@/lib/group-data";
import { knownPeople } from "@/lib/invites";
import { directEntries } from "@/lib/direct-db";
import { directEntryOn } from "@/lib/direct";
import { startDirectWith } from "@/app/direct-actions";
import { FreshKey } from "@/components/FreshKey";
import { Initial } from "@/components/SettleUp";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";

// "With a person": pick someone, and go straight to Add expense with them. Only people you already know are listed:
// your existing pairs, and account holders you share an open group with. Anyone else is added by name (an email is optional).
// Names only: no email search, no contacts, no list of everyone on Loopin.
export default async function PickPerson({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; name?: string; email?: string }> }) {
  if (!directEntryOn()) redirect("/add");
  const sp = await searchParams;
  const account = await getAccount();
  if (!account) redirect("/signin?back=/add/person");
  const memberships = await getMemberships();
  const q = (sp.q ?? "").trim().replace(/\s+/g, " ").slice(0, 60).toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  const [rows, known] = await Promise.all([loadMyGroupsLight(memberships, { includeDirect: true }), knownPeople(account.id)]);
  const pairs = directEntries(rows.filter((r) => r.group.type === "direct"));
  const paired = new Set(pairs.map((p) => p.other.accountId).filter((x): x is string => Boolean(x)));
  const recent = pairs.filter((p) => match(p.other.name));
  const fromGroups = known.filter((k) => !paired.has(k.accountId) && match(k.name));

  const rowClass = "flex min-h-[60px] w-full items-center gap-3 rounded-[20px] border border-line bg-white px-3.5 py-2.5 text-left active:bg-mist";
  const person = (name: string, note: string) => (
    <>
      <Initial name={name} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-medium leading-snug">{name}</span>
        <span className="block truncate text-[13.5px] text-fg/60">{note}</span>
      </span>
      <span aria-hidden className="text-fg/60">›</span>
    </>
  );
  const head = (label: string) => <h2 className="mb-2 mt-6 px-1 text-[13px] font-semibold tracking-[0.14em] text-fg/75">{label}</h2>;

  return (
    <>
      <PageHeader title="With a person" back="/add" />
      {sp.error && <ErrorNote>{sp.error.slice(0, 200)}</ErrorNote>}

      <form method="get" role="search" className="mb-1 flex gap-2">
        <input name="q" defaultValue={sp.q?.slice(0, 60) ?? ""} placeholder="Search by name" aria-label="Search by name" autoComplete="off" className={`${inputClass} min-w-0 flex-1`} />
        <button type="submit" className="min-h-12 shrink-0 rounded-full border border-fg/25 px-5 text-[15px] font-semibold active:bg-fg/10">
          Search
        </button>
      </form>

      {recent.length > 0 && (
        <section aria-label="Recent" data-direct-recent>
          {head("RECENT")}
          <ul className="space-y-2">
            {recent.map((p) => (
              <li key={p.groupId}>
                <form action={startDirectWith}>
                  <FreshKey name="rid" />
                  <input type="hidden" name="kind" value="pair" />
                  <input type="hidden" name="groupId" value={p.groupId} />
                  <button type="submit" className={rowClass} data-person-row={p.other.name}>
                    {person(p.other.name, p.shared ? "On Loopin" : "Only you")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fromGroups.length > 0 && (
        <section aria-label="From your groups" data-direct-known>
          {head("FROM YOUR GROUPS")}
          <ul className="space-y-2">
            {fromGroups.map((k) => (
              <li key={k.accountId}>
                <form action={startDirectWith}>
                  <FreshKey name="rid" />
                  <input type="hidden" name="kind" value="account" />
                  <input type="hidden" name="accountId" value={k.accountId} />
                  <button type="submit" className={rowClass} data-person-row={k.name}>
                    {person(k.name, "On Loopin")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {q && recent.length === 0 && fromGroups.length === 0 && <p className="mt-6 px-1 text-[15px] text-fg/65">Nobody called “{sp.q?.slice(0, 60)}” yet. Add them below.</p>}

      <section aria-label="Add someone new" data-direct-new>
        {head("ADD SOMEONE NEW")}
        <form action={startDirectWith} className="space-y-3 rounded-[22px] border border-line bg-white p-4">
          <FreshKey name="rid" />
          <input type="hidden" name="kind" value="new" />
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-fg/65">Their name</span>
            <input name="name" required maxLength={40} defaultValue={sp.name ? sp.name.slice(0, 40) : sp.q && fromGroups.length + recent.length === 0 ? sp.q.slice(0, 40) : ""} placeholder="Rohan" autoComplete="off" className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-fg/65">Their email (optional)</span>
            <input name="email" type="email" inputMode="email" maxLength={200} defaultValue={sp.email?.slice(0, 200) ?? ""} placeholder="to invite them to see it" autoComplete="off" className={inputClass} />
          </label>
          <p className="text-[13.5px] leading-snug text-fg/60">Only you can see this until they join.</p>
          <button type="submit" className={primaryButtonClass} data-direct-new-go>
            Continue
          </button>
        </form>
      </section>
    </>
  );
}

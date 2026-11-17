import { ChipRow } from "@/components/ChipRow";
import Image from "next/image";
import Link from "@/components/Link";
import { getMemberships } from "@/lib/identity";
import { loadAllMemories } from "@/lib/moments-db";
import { memoryHref } from "@/lib/home/memories";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Memories", robots: { index: false } };
export const dynamic = "force-dynamic";

// Every memory you may see, newest first, as square polaroids. Same rules as Home's Memories row (loadAllMemories shares its loader):
// only groups you are in right now, nothing from people you blocked (or who blocked you), nothing after you left, canSeeMoment on every row.
// ?g=<groupId> filters to one group, but only a group that has its own chip here; anything else is the same as All groups.
const INK = "#26231d";
const tilt = ["-rotate-[1.5deg]", "rotate-[1deg]"];

export default async function MemoriesPage({ searchParams }: { searchParams: Promise<{ g?: string | string[] }> }) {
  const sp = (await searchParams) ?? {};
  const g = typeof sp.g === "string" ? sp.g : undefined;
  const memberships = await getMemberships();
  const { chips, selected, memories } = await loadAllMemories(memberships, { groupId: g });
  const chip = (on: boolean) =>
    `flex min-h-11 shrink-0 items-center rounded-full border px-4 text-[15px] font-medium active:opacity-70 ${on ? "border-fg bg-fg text-canvas" : "border-fg/25 text-fg/85"}`;
  return (
    <div className="pb-16" data-memories-page>
      <PageHeader title="Memories" back="/" />
      {memories.length === 0 ? (
        <div className="py-6" data-memories-empty>
          <p className="text-[17px] leading-snug text-fg/80">No memories yet. Add a moment to a trip and it shows up here.</p>
          <Link href="/groups" className="mt-3 flex min-h-11 items-center text-[15px] font-medium text-fg/85 underline underline-offset-4">
            Your groups
          </Link>
        </div>
      ) : (
        <>
          {/* Chip names are shown in full (no "…"); the row scrolls, runs to the screen's edges and fades while there is more to the right. */}
          <ChipRow label="Filter by group" dataKey="data-memories-filters">
            <Link href="/memories" className={chip(!selected)} aria-current={!selected ? "true" : undefined} data-memories-filter="all">
              All groups
            </Link>
            {chips.map((c) => (
              <Link key={c.groupId} href={`/memories?g=${c.groupId}`} className={chip(selected === c.groupId)} aria-current={selected === c.groupId ? "true" : undefined} data-memories-filter={c.groupId}>
                <span className="whitespace-nowrap">{c.name}</span>
              </Link>
            ))}
          </ChipRow>
          <ul aria-label="Memories" className="grid grid-cols-2 gap-x-4 gap-y-6 px-1" data-memories-grid-page>
            {memories.map((m, i) => (
              <li key={m.id} className="min-w-0">
                <Link
                  href={memoryHref(m.groupId, m.id, "memories", selected)}
                  aria-label={`${m.caption || "A moment"}, from ${m.groupName}`}
                  className={`lp-press block ${tilt[i % 2]} active:rotate-0 motion-reduce:rotate-0`}
                  data-memories-card={m.id}
                >
                  <span className="block bg-[#f4f1e8] p-[5px] pb-0 shadow-[0_16px_30px_-12px_rgba(0,0,0,0.95),0_2px_6px_rgba(0,0,0,0.35)]">
                    <span className="relative block aspect-square overflow-hidden bg-[#1c1b20]">
                      <Image src={m.thumb} alt="" aria-hidden fill unoptimized sizes="50vw" className="object-cover" />
                      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.10),transparent_40%,rgba(0,0,0,0.12))]" />
                    </span>
                    <span className="block px-1 pb-1.5 pt-0.5 leading-none" style={{ color: INK }}>
                      <span className="block truncate font-hand text-[20px] font-bold leading-[1.1]" data-memory-caption>
                        {m.caption || "A moment"}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] font-semibold text-[#6d685e]" data-memory-group>
                        {m.groupName}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

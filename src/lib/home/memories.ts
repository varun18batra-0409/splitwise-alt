// Home's "Memories" row: square polaroids of the newest moments THIS person may see, across their groups, under the story circles.
// Pure. Every moment goes through canSeeMoment (src/lib/moments-access.ts) here, again, whatever the loader already filtered:
// a moment the viewer can't see is never listed and its photo address never leaves this function.
import { canSeeMoment, type MomentFacts, type MomentViewer } from "../moments-access";

export type MemoryGroup = {
  groupId: string;
  name: string;
  viewer: MomentViewer;
  moments: (MomentFacts & { id: string; caption: string })[];
};

export type HomeMemory = { id: string; groupId: string; groupName: string; caption: string; thumb: string; href: string };

export const MEMORY_MAX = 10;
export const MEMORIES_PAGE_MAX = 120; // the /memories page: the newest 120, no endless scrolling
export const HOME_PREVIEW = 1; // Home shows one memory (the front polaroid)

// Home shows "See all" only when there is more than the one memory it shows.
export const hasMoreMemories = (count: number) => count > HOME_PREVIEW;

// The moment viewer, with "Back" returning to Home (the default) or to /memories (keeping that page's group filter).
export function memoryHref(groupId: string, id: string, from: "home" | "memories" = "home", filter = ""): string {
  const base = `/groups/${groupId}/moments/${id}`;
  if (from === "home") return `${base}?from=home`;
  return filter && /^[A-Za-z0-9_-]{1,40}$/.test(filter) ? `${base}?from=memories&g=${filter}` : `${base}?from=memories`;
}

// A group's Memories tab (every trip has one).
export const groupMemoriesHref = (groupId: string) => `/groups/${groupId}?tab=memories`;

// Where "Back" goes from the moment viewer. Anything unknown goes to the group's moments list (the caller's default).
export function memoriesBack(from: string | undefined, g: string | undefined): string | null {
  if (from === "home") return "/";
  if (from !== "memories") return null;
  return g && /^[A-Za-z0-9_-]{1,40}$/.test(g) ? `/memories?g=${g}` : "/memories";
}

export function pickMemories(groups: MemoryGroup[], thumbOf: (id: string) => string, max = MEMORY_MAX): HomeMemory[] {
  return groups
    .flatMap((g) => g.moments.filter((m) => canSeeMoment(g.viewer, m)).map((m) => ({ g, m })))
    .sort((a, b) => b.m.createdAt.getTime() - a.m.createdAt.getTime() || b.m.id.localeCompare(a.m.id))
    .slice(0, max)
    .map(({ g, m }) => ({ id: m.id, groupId: g.groupId, groupName: g.name, caption: m.caption.trim(), thumb: thumbOf(m.id), href: memoryHref(g.groupId, m.id) }));
}

// ---------- The /memories page ----------
export type MemoryChip = { groupId: string; name: string };

// One chip per group that has at least one moment THIS viewer may see (canSeeMoment again), the group with the newest one first.
export function memoryChips(groups: MemoryGroup[]): MemoryChip[] {
  const seen = new Map<string, { name: string; at: number }>();
  for (const g of groups) {
    const newest = g.moments.filter((m) => canSeeMoment(g.viewer, m)).reduce((t, m) => Math.max(t, m.createdAt.getTime()), -1);
    if (newest < 0) continue;
    const had = seen.get(g.groupId);
    if (!had || newest > had.at) seen.set(g.groupId, { name: g.name, at: newest });
  }
  return [...seen.entries()].sort((a, b) => b[1].at - a[1].at || a[1].name.localeCompare(b[1].name)).map(([groupId, v]) => ({ groupId, name: v.name }));
}

// ?g= counts only when it names one of the chips (a group the viewer is in and can see something from). Anything else means "All groups".
export function chosenGroup(chips: MemoryChip[], g: string | undefined): string {
  return g && chips.some((c) => c.groupId === g) ? g : "";
}

export function memoriesPage(groups: MemoryGroup[], g: string | undefined, thumbOf: (id: string) => string, max = MEMORIES_PAGE_MAX): { chips: MemoryChip[]; selected: string; memories: HomeMemory[] } {
  const chips = memoryChips(groups);
  const selected = chosenGroup(chips, g);
  const memories = pickMemories(selected ? groups.filter((x) => x.groupId === selected) : groups, thumbOf, max);
  return { chips, selected, memories };
}

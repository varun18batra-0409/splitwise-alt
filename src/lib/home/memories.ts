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

// The moment viewer, with "Back" returning to Home.
export const memoryHref = (groupId: string, id: string) => `/groups/${groupId}/moments/${id}?from=home`;

export function pickMemories(groups: MemoryGroup[], thumbOf: (id: string) => string, max = MEMORY_MAX): HomeMemory[] {
  return groups
    .flatMap((g) => g.moments.filter((m) => canSeeMoment(g.viewer, m)).map((m) => ({ g, m })))
    .sort((a, b) => b.m.createdAt.getTime() - a.m.createdAt.getTime() || b.m.id.localeCompare(a.m.id))
    .slice(0, max)
    .map(({ g, m }) => ({ id: m.id, groupId: g.groupId, groupName: g.name, caption: m.caption.trim(), thumb: thumbOf(m.id), href: memoryHref(g.groupId, m.id) }));
}

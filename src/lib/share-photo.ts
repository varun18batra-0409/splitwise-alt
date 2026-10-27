import { db } from "./db";
import { coverOf, isPhoto, photoSrc } from "./covers";
import { placePhoto } from "./places";

// The picture for a group's share images (countdown, all square, Wrapped): the
// destination photo for a trip, else the group's own photo or picture, as a
// data address the picture maker can draw. JPEG and PNG only.
export async function photoData(group: { id: string; name: string; cover: string; type: string; coverAt: Date | null }, origin: string): Promise<string | null> {
  try {
    // The destination first (same picture as the countdown on Home), then the group's own.
    const dest = placePhoto(group.name);
    if (dest) {
      const res = await fetch(new URL(dest.src, origin));
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && /image\/(jpeg|png)/.test(type)) return `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    }
    const kind = coverOf(group);
    if (kind === "own") {
      const p = await db.groupPhoto.findUnique({ where: { groupId: group.id } });
      if (!p || (p.type !== "image/jpeg" && p.type !== "image/png")) return null; // the picture maker reads JPEG and PNG
      return `data:${p.type};base64,${Buffer.from(p.data).toString("base64")}`;
    }
    const src = isPhoto(kind) ? photoSrc(kind) : null;
    if (!src) return null;
    const res = await fetch(new URL(src, origin));
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/image\/(jpeg|png)/.test(type)) return null;
    return `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

import { db } from "./db";
import { coverOf, isPhoto, photoSrc } from "./covers";
import { placePhoto, tripPhotoSrc } from "./places";

// The picture for a group's share images (countdown, all square, Wrapped), as a data address the picture maker can draw.
// The same picture Home shows, in the same order:
//   1. the group's own photo, else a photo picked on purpose;
//   2. a trip with the default picture: the destination photo, read from the name AND "Where to?";
//   3. last, a photo for the name (a mood or friends photo when the place isn't known).
// JPEG and PNG only: the picture maker (ImageResponse) isn't known to draw WebP, so group photos are uploaded as JPEG
// (OwnPhoto) and an older WebP group photo falls through to the next choice until someone uploads again.
type ShareGroup = { id: string; name: string; cover: string; type: string; coverAt: Date | null; tripPlace?: string | null };

async function fetched(src: string, origin: string): Promise<string | null> {
  const res = await fetch(new URL(src, origin));
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  if (!res.ok || !/^image\/(jpeg|png)$/.test(type)) return null;
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

export async function photoData(group: ShareGroup, origin: string): Promise<string | null> {
  try {
    const kind = coverOf(group);
    if (kind === "own") {
      const p = await db.groupPhoto.findUnique({ where: { groupId: group.id } });
      if (p && (p.type === "image/jpeg" || p.type === "image/png")) {
        const { readPhoto } = await import("./photo-store");
        const bytes = await readPhoto(p);
        if (bytes) return `data:${p.type};base64,${Buffer.from(bytes).toString("base64")}`;
      }
    } else if (isPhoto(kind)) {
      const src = photoSrc(kind);
      const got = src ? await fetched(src, origin) : null;
      if (got) return got;
    }
    const dest = tripPhotoSrc(group);
    if (dest) {
      const got = await fetched(dest, origin);
      if (got) return got;
    }
    const mood = placePhoto(`${group.name} ${group.tripPlace ?? ""}`);
    return mood ? await fetched(mood.src, origin) : null;
  } catch {
    return null;
  }
}

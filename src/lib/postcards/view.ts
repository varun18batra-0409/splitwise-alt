import type { BackProps, FrontProps } from "@/components/postcards/Card";
import type { OneSideProps } from "@/components/postcards/OneSide";
import { postDate } from "./catalog";
import { fitOf, formatOf, photoSizeOf, type Format } from "./format";

// format, fit and photoSize are missing on rows from before they existed: those read as the original card (classic, full, small).
type Row = { id: string; front: string; photoId: string; words: string; lettering: string; tone?: string; look?: string; wordsAt?: string; wordsSize?: number; touches?: string; seal?: string; signoff?: string; message: string; hand: string; stamp: string; paper: string; ink?: string; address: string; place: string; createdAt: Date; format?: string; fit?: string; photoSize?: string };

// A saved postcard, as the props its sides are drawn from. `one` is set (and the card has no flip) for a one-side card.
export function cardProps(p: Row, fromName: string, tz: string): { format: Format; front: FrontProps; back: BackProps; one: OneSideProps | null } {
  let address: string[] = [];
  try {
    address = (JSON.parse(p.address) as unknown[]).map(String).slice(0, 3);
  } catch {
    address = [];
  }
  const format = formatOf(p.format);
  const photo = p.photoId ? `/api/postcard-photo/${p.photoId}` : undefined;
  const from = p.signoff || fromName;
  const date = postDate(p.createdAt, tz);
  return {
    format,
    front: { front: p.front, photo, words: p.words, lettering: p.lettering, tone: p.tone, look: p.look, wordsAt: p.wordsAt, wordsSize: p.wordsSize, touches: p.touches, fit: fitOf(p.fit), k: `f${p.id}` },
    back: { message: p.message, hand: p.hand, stamp: p.stamp, paper: p.paper, ink: p.ink, touches: p.touches, seal: p.seal, address, place: p.place, date, from, k: `b${p.id}` },
    one: format === "oneside" ? { size: photoSizeOf(p.photoSize), front: p.front, photo, look: p.look, message: p.message, hand: p.hand, stamp: p.stamp, paper: p.paper, ink: p.ink, touches: p.touches, seal: p.seal, place: p.place, date, from, k: `o${p.id}` } : null,
  };
}

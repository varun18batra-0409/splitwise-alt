import type { BackProps, FrontProps } from "@/components/postcards/Card";
import { postDate } from "./catalog";

type Row = { id: string; front: string; photoId: string; words: string; lettering: string; message: string; hand: string; stamp: string; paper: string; ink?: string; address: string; place: string; createdAt: Date };

// A saved postcard, as the props its two sides are drawn from.
export function cardProps(p: Row, fromName: string, tz: string): { front: FrontProps; back: BackProps } {
  let address: string[] = [];
  try {
    address = (JSON.parse(p.address) as unknown[]).map(String).slice(0, 3);
  } catch {
    address = [];
  }
  return {
    front: { front: p.front, photo: p.photoId ? `/api/postcard-photo/${p.photoId}` : undefined, words: p.words, lettering: p.lettering, k: `f${p.id}` },
    back: { message: p.message, hand: p.hand, stamp: p.stamp, paper: p.paper, ink: p.ink, address, place: p.place, date: postDate(p.createdAt, tz), from: fromName, k: `b${p.id}` },
  };
}

import Link from "@/components/Link";
import { PostcardFront } from "./Card";

// "Send a postcard": a quiet invitation in a group (open or closed) and in the passport.
export function SendPostcardCard({ href, front, words, line = "Say thank you, or just remember it together.", className = "" }: { href: string; front: string; words: string; line?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-send-postcard
      className={`relative block overflow-hidden rounded-[24px] border border-[#26262c] bg-[#16161a] px-4 py-4 active:scale-[0.99] ${className}`}
    >
      <span aria-hidden className="absolute -right-6 -top-3 w-[46%] rotate-[8deg]">
        <PostcardFront front={front} words={words} lettering="classic" k="send" />
      </span>
      <span className="relative block w-[54%]">
        <span className="block font-display text-[20px] font-semibold leading-tight">Send a postcard</span>
        <span className="mt-1.5 block text-[13px] leading-snug text-fg/60">{line}</span>
        <span className="mt-3 inline-flex h-9 items-center rounded-full border border-fg/25 px-4 text-[13px] font-semibold text-fg">Write one</span>
      </span>
    </Link>
  );
}

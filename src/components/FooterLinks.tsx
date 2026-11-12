import Link from "@/components/Link";

// The small links at the foot of a screen (FAQ, Privacy, Terms ...). Each one is its own 44px-tall tap target with room
// either side, so the right one is easy to hit on a phone (they used to be tiny words separated by dots).
export function FooterLinks({ links, className = "" }: { links: { href: string; label: string }[]; className?: string }) {
  return (
    <nav aria-label="More about Loopin" className={`flex flex-wrap items-center justify-center gap-x-2 ${className}`} data-footer-links>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-xs text-gray-400 underline underline-offset-4 active:text-fg">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export const HOME_FOOTER_LINKS = [
  { href: "/faq", label: "FAQ" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export const ACCOUNT_FOOTER_LINKS = [{ href: "/how-it-works", label: "How Loopin works" }, ...HOME_FOOTER_LINKS];

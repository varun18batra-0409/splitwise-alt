import Link from "@/components/Link";
import { GoHome } from "@/components/GoHome";
import { primaryButtonClass } from "@/components/ui";

export const metadata = { title: "Not here any more" };

// A screen that doesn't exist (often a group that was deleted, reached by
// swiping back): say so kindly and go Home.
export default function NotFound() {
  return (
    <section className="flex min-h-[60dvh] flex-col items-center justify-center text-center">
      <p className="font-display text-[26px] font-semibold leading-tight">This screen isn’t here any more</p>
      <p className="mt-2 text-sm text-gray-500">It may have been deleted. Taking you Home…</p>
      <Link href="/" replace className={`mt-6 ${primaryButtonClass} !w-auto px-8`}>
        Go to Home
      </Link>
      <GoHome />
    </section>
  );
}

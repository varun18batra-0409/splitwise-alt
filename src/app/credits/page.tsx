import { PageHeader } from "@/components/ui";
import credits from "@/generated/photo-credits.json";

export const metadata = { title: "Photo credits", robots: { index: false } };

// Who took the photos of places in India we show in trip stories and countdowns
// (Wikimedia Commons, free licences that ask for credit). The rest are from
// Unsplash, whose licence needs no credit, but we thank them anyway.
const nice = (slot: string) =>
  slot
    .replace(/^place-|^cover-/, "")
    .replace(/-\d+$/, "")
    .replace(/-in$/, " (road)")
    .replace(/^\w/, (c) => c.toUpperCase());

export default function CreditsPage() {
  const list = Object.entries(credits as Record<string, { by: string; license: string; page: string }>).sort(([a], [b]) => a.localeCompare(b));
  return (
    <>
      <PageHeader title="Photo credits" back="/how-it-works" />
      <p className="-mt-2 mb-6 text-sm text-gray-500">
        Thank you to the photographers. Photos of places in India are from Wikimedia Commons, under the licence shown (tap one to see the original). The other photos are from Unsplash, free to use under the Unsplash
        licence.
      </p>
      {list.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-6 text-center text-sm text-gray-500">All photos here are from Unsplash.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.map(([slot, c]) => (
            <li key={slot} className="py-3">
              <a href={c.page} target="_blank" rel="noopener noreferrer" className="block active:opacity-80">
                <span className="block font-medium">{nice(slot)}</span>
                <span className="block text-xs text-gray-500">
                  {c.by} · {c.license}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

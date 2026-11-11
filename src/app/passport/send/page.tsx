import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { PageHeader, ErrorNote, avatarTone } from "@/components/ui";
import { postcardPeople } from "@/lib/postcards/people";
import { sendPassportAction } from "./actions";

export const metadata = { title: "Send your passport", robots: { index: false } };

const ERRORS: Record<string, string> = {
  private: "Your passport is set to private. Change who can see it first.",
  none: "Pick who it’s for.",
  limit: "That’s a lot of sending today. Try again tomorrow.",
};

// Send your passport inside Loopin: tick people you've shared a group with; they get an alert.
export default async function SendPassportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const me = await getAccount();
  if (!me) redirect("/signin?back=/passport/send");
  const groups = await postcardPeople(me.id);
  const seen = new Set<string>();
  return (
    <>
      <PageHeader title="Send your passport" back="/passport" />
      {error && <ErrorNote>{ERRORS[error] ?? ERRORS.none}</ErrorNote>}
      <p className="-mt-4 mb-6 text-sm leading-relaxed text-fg/60">They’ll get an alert in Loopin that opens your passport. Only people you’ve shared a group with show here.</p>
      {groups.length === 0 ? (
        <p className="rounded-[18px] bg-mist px-4 py-6 text-center text-sm text-fg/55">Once friends join one of your groups, you can send it to them here.</p>
      ) : (
        <form action={sendPassportAction} data-allow-repeat="1">
          {groups.map((g) => {
            const people = g.people.filter((p) => !seen.has(p.id));
            people.forEach((p) => seen.add(p.id));
            if (!people.length) return null;
            return (
              <fieldset key={g.id} className="mb-5">
                <legend className="mb-1 text-[13px] font-semibold text-fg/55">{g.name}</legend>
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-3 py-2.5" data-passport-recipient={p.name}>
                    <span aria-hidden className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${avatarTone(p.name)}`}>{p.name.charAt(0).toUpperCase()}</span>
                    <span className="flex-1 text-[15px] font-semibold">{p.name}</span>
                    <input type="checkbox" name="to" value={p.id} className="peer h-6 w-6 shrink-0 appearance-none rounded-full border-[1.5px] border-fg/30 bg-transparent checked:border-fg checked:bg-fg" />
                  </label>
                ))}
              </fieldset>
            );
          })}
          <button type="submit" data-haptic="success" className="pop mt-4 flex h-12 w-full items-center justify-center bg-fg text-[15px] font-semibold text-canvas">
            Send in Loopin
          </button>
        </form>
      )}
      <Link href="/passport" className="mt-2 flex min-h-11 items-center justify-center text-sm text-fg/60 underline underline-offset-4">
        Not now
      </Link>
    </>
  );
}

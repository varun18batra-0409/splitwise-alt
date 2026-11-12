import Link from "@/components/Link";
import { PageHeader, primaryButtonClass } from "@/components/ui";
import { PhoneStatus } from "@/components/PushControls";
import { NotifySwitches } from "@/components/NotifySwitches";
import { getAccount } from "@/lib/identity";
import { parseAccountPrefs } from "@/lib/account-notify";

// Stored choices list what's switched off as `false`; the switches take a map of what's off (true = off).
function offMap(p: { push: Record<string, boolean>; email: Record<string, boolean> }) {
  const flip = (r: Record<string, boolean>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v === false).map(([k]) => [k, true]));
  return { push: flip(p.push), email: flip(p.email) };
}

// Notifications & email: what this phone allows, then what Loopin sends, switch by switch.
export default async function NotificationsAndEmail() {
  const account = await getAccount();
  const p = account ? parseAccountPrefs(account.notifyPrefs) : null;
  return (
    <>
      <PageHeader title="Notifications & email" back="/account" />
      <PhoneStatus />
      {account && p ? (
        <div className="mt-6">
          <NotifySwitches initial={offMap(p)} />
        </div>
      ) : (
        <section className="mt-6 rounded-2xl border border-line px-5 py-5">
          <p className="font-display text-lg font-semibold">Sign in to choose</p>
          <p className="mt-1 text-sm text-fg/60">Your choices are saved to your account, so they follow you to every phone.</p>
          <Link href="/signin?back=/account/notifications" className={`mt-4 ${primaryButtonClass}`}>
            Sign in or sign up
          </Link>
        </section>
      )}
    </>
  );
}

import { redirect } from "next/navigation";
import { PageHeader, secondaryButtonClass } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PasskeyAdd } from "@/components/Passkeys";
import { PushEndpointField } from "@/components/PushEndpointField";
import { removeMyPasskey, signOutOtherPhonesAction, signOutThisPhone } from "@/app/actions";
import { getAccount, guestGroupsOnPhone } from "@/lib/identity";
import { GuestMoveButton } from "@/components/GuestMoveSheet";
import { listPasskeys } from "@/lib/passkeys";
import { niceDate } from "@/lib/format";

export const metadata = { title: "Sign-in & devices", robots: { index: false } };

// You, Sign-in & devices: fingerprint / face sign-in, sign out of this phone, sign out of every other phone.
export default async function SignInDevicesPage({ searchParams }: { searchParams: Promise<{ others?: string }> }) {
  const { others } = await searchParams;
  const account = await getAccount();
  if (!account) redirect("/signin?back=/account/sign-in");
  const passkeys = await listPasskeys(account.id);
  // Guest groups that are only on this phone: signing out would lose them from it.
  const onlyHere = await guestGroupsOnPhone();
  const lost = onlyHere.map((g) => g.name).join(", ");
  return (
    <>
      <PageHeader title="Sign-in & devices" back="/account" />

      <section className="scroll-mt-4" id="sign-in">
        <h2 className="mb-1 text-base font-semibold">Fingerprint / face sign-in</h2>
        <p className="mb-4 text-sm text-gray-500">Sign in with one touch instead of a code. Your fingerprint never leaves your phone; Loopin only gets a key that proves it’s you.</p>
        {passkeys.length > 0 && (
          <ul className="mb-4 divide-y divide-line border-y border-line">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.label || "Passkey"}</span>
                  <span className="block text-xs text-gray-500">
                    Added {niceDate(p.createdAt.toISOString().slice(0, 10))}
                    {p.lastUsedAt ? ` · last used ${niceDate(p.lastUsedAt.toISOString().slice(0, 10))}` : ""}
                  </span>
                </span>
                <form action={removeMyPasskey}>
                  <input type="hidden" name="id" value={p.id} />
                  <ConfirmButton message="Remove this fingerprint / face sign-in?" className="rounded-full border border-line px-3.5 py-1.5 text-sm text-fg active:bg-mist">
                    Remove
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <PasskeyAdd className={secondaryButtonClass} label={passkeys.length ? "Add this phone too" : "Turn on fingerprint / face sign-in"} />
      </section>

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="mb-1 text-base font-semibold">Sign out of this phone</h2>
        {onlyHere.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-fg/80" data-only-here>
              These groups are only on this phone and will be lost from it: <span className="break-words font-medium">{lost}</span>. Your other groups stay safe in your email.
            </p>
            <GuestMoveButton groups={onlyHere} className="pop mb-3 block min-h-12 w-full bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas">
              Move them first
            </GuestMoveButton>
            <form action={signOutThisPhone}>
              <PushEndpointField />
              <ConfirmButton message={`Sign out anyway? ${lost} ${onlyHere.length === 1 ? "is" : "are"} only on this phone and will be lost from it.`} className={secondaryButtonClass}>
                Sign out anyway
              </ConfirmButton>
            </form>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-500">This phone forgets your groups. They stay safe in your email — sign in again to get them back.</p>
            <form action={signOutThisPhone}>
              <PushEndpointField />
              <ConfirmButton message="Sign out of this phone?" className={secondaryButtonClass}>
                Sign out
              </ConfirmButton>
            </form>
          </>
        )}
        <h2 className="mb-1 mt-8 text-base font-semibold" id="other-phones">
          Sign out on all other phones
        </h2>
        <p className="mb-4 text-sm text-gray-500">Lost a phone, or signed in somewhere you shouldn’t stay? Every other phone and browser is signed out. This one stays signed in.</p>
        {others === "out" && (
          <p className="mb-4 rounded-xl bg-mist px-4 py-3 text-sm" role="status" data-signed-out-others>
            Done. Every other phone has been signed out.
          </p>
        )}
        <form action={signOutOtherPhonesAction}>
          <PushEndpointField />
          <ConfirmButton message="Sign out on every other phone and browser?" className={secondaryButtonClass}>
            Sign out other phones
          </ConfirmButton>
        </form>
      </section>
    </>
  );
}

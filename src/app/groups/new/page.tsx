import { headers } from "next/headers";
import { createGroup } from "@/app/actions";
import { defaultCurrency } from "@/lib/region";
import { MemberInputs } from "@/components/MemberInputs";
import { CurrencySelect } from "@/components/CurrencySelect";
import { ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";

export default async function NewGroup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; name?: string }>;
}) {
  const { error, name } = await searchParams;
  const currency = defaultCurrency(await headers());

  return (
    <>
      <PageHeader title="New group" back="/" />
      {error === "busy" ? (
        <ErrorNote>Lots of groups made from here in the last hour. Wait a bit and try again.</ErrorNote>
      ) : (
        error && <ErrorNote>Please fill in the group name and your name.</ErrorNote>
      )}

      <form action={createGroup} className="space-y-8">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">Group name</span>
          <input name="groupName" required placeholder="Goa trip" defaultValue={(name ?? "").slice(0, 60)} autoComplete="off" className={inputClass} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">Your name</span>
          <input name="yourName" required placeholder="Your name" autoComplete="given-name" className={inputClass} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-600">
            Group currency <span className="font-normal text-gray-400">(balances are shown in this)</span>
          </span>
          <CurrencySelect name="currency" defaultValue={currency} />
        </label>

        <div>
          <span className="mb-2 block text-sm font-medium text-gray-600">
            Other people <span className="font-normal text-gray-400">(optional — they can also join by link)</span>
          </span>
          <MemberInputs />
        </div>

        <button type="submit" className={primaryButtonClass}>
          Create group
        </button>
      </form>
    </>
  );
}

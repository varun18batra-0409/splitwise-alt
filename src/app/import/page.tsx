import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { ErrorNote, PageHeader, primaryButtonClass } from "@/components/ui";
import { SplitwiseImport } from "@/components/SplitwiseImport";

export const metadata = { title: "Bring a group over from Splitwise" };

// Import a group from Splitwise's "Export as spreadsheet" file.
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const account = await getAccount();

  return (
    <>
      <PageHeader title="From Splitwise" back="/" />
      <h1 className="font-display text-[28px] font-semibold leading-tight">Bring a group over</h1>
      <p className="mt-2 text-sm text-gray-500">
        Every expense and payment comes across, with the same people and the same balances. Splitwise keeps its copy; nothing there changes.
      </p>

      <ol className="mt-5 space-y-2 rounded-[18px] bg-mist px-5 py-4 text-sm text-gray-600" aria-label="How to export from Splitwise">
        <li>
          <b>1.</b> In Splitwise, open the group and tap the <b>gear</b> (group settings).
        </li>
        <li>
          <b>2.</b> Tap <b>Export as spreadsheet</b>. Save the file, or send it to yourself.
        </li>
        <li>
          <b>3.</b> Come back here and pick that file. One group at a time.
        </li>
      </ol>

      <div className="mt-6">
        {error && <ErrorNote>{error.slice(0, 200)}</ErrorNote>}
        {account ? (
          <SplitwiseImport yourName={account.name ?? ""} />
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-500">First, a quick sign-in, so the group is yours on every phone. No password.</p>
            <Link href={`/signin?${new URLSearchParams({ back: "/import" })}`} className={primaryButtonClass}>
              Sign in or sign up
            </Link>
          </>
        )}
      </div>

      <p className="mt-8 text-center text-sm text-gray-500">
        <Link href="/switching" className="underline">
          Switching from Splitwise? What’s different
        </Link>
      </p>
    </>
  );
}

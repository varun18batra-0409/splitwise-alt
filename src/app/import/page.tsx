import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { ErrorNote, PageHeader, primaryButtonClass } from "@/components/ui";
import { SplitwiseImport } from "@/components/SplitwiseImport";

export const metadata = { title: "Bring a group over from another app" };

// Import a group from another app's exported spreadsheet (CSV).
export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const account = await getAccount();

  return (
    <>
      <PageHeader title="From another app" back="/" />
      <h1 className="font-display text-[28px] font-semibold leading-tight">Bring a group over</h1>
      <p className="mt-2 text-sm text-gray-500">
        Every expense and payment comes across, with the same people and the same balances. The other app keeps its copy; nothing there changes.
      </p>

      <ol className="mt-5 space-y-2 rounded-[18px] bg-mist px-5 py-4 text-sm text-gray-600" aria-label="How to export from the other app">
        <li>
          <b>1.</b> In the other app, open the group and look for <b>Export</b>, <b>Download</b> or <b>Spreadsheet (CSV)</b>, usually in the
          group’s settings. Save the file, or send it to yourself.
        </li>
        <li>
          <b>2.</b> Come back here and pick that file. One group at a time.
        </li>
        <li>
          <b>3.</b> Check what Loopin found. If the file isn’t one it already knows, it asks which column is which (date, what, amount, who
          paid, who it was for).
        </li>
      </ol>
      <details className="mt-3 text-sm text-gray-500">
        <summary className="cursor-pointer">Where’s the export in my app?</summary>
        <ul className="mt-2 space-y-1">
          <li>
            <b>Splitwise:</b> the group → gear → Export as spreadsheet.
          </li>
          <li>
            <b>Tricount, Settle Up and similar:</b> the group’s settings or menu → Export / Download as CSV or Excel. (If it gives an Excel
            file, open it and save as CSV.)
          </li>
          <li>
            <b>A spreadsheet you kept yourself</b> (Google Sheets, Excel): File → Download → CSV.
          </li>
          <li>
            <b>Loopin:</b> a group’s Settings → Download spreadsheet.
          </li>
        </ul>
      </details>

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
          Coming from another app? What’s different
        </Link>
      </p>
    </>
  );
}

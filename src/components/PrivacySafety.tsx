import { db } from "@/lib/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { aiConsentFor, type AiConsent } from "@/lib/ai-consent";
import { saveAiConsentForm } from "@/app/ai-actions";
import { unblockAction } from "@/app/safety-actions";

// "Privacy and safety" on the You page: whether Loopin's AI may read bills and lines, the people you blocked, and a way to reach us.
export async function PrivacySafety({ accountId, flags }: { accountId: string | null; flags: { ai?: string; blocked?: string; unblocked?: string } }) {
  const consent: AiConsent = await aiConsentFor(accountId);
  const blocks = accountId ? await db.block.findMany({ where: { blockerId: accountId }, orderBy: { createdAt: "desc" }, take: 100, select: { blockedId: true } }) : [];
  const names = blocks.length ? await db.account.findMany({ where: { id: { in: blocks.map((b) => b.blockedId) } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name.trim() || "Someone"]));
  const on = consent === "yes";
  const pill = "min-h-11 rounded-full border px-4 text-sm font-semibold";
  return (
    <section id="privacy" aria-label="Privacy and safety">

      <div className="rounded-2xl border border-line px-4 py-4" data-ai-setting={consent || "unasked"}>
        <p className="font-medium">Let AI read bills and lines</p>
        <p className="mt-1 text-sm text-gray-500">
          {on
            ? "On. When you scan a bill, or type a line Loopin can’t follow, it sends that photo or line and your group’s first names to Anthropic, an AI company."
            : consent === "no"
              ? "Off. Bill photos are attached and lines stay as you typed them; you fill in the rest by hand."
              : "Not asked yet. Loopin asks the first time it could use it. Nothing is sent before you say yes."}
        </p>
        {(flags.ai === "on" || flags.ai === "off") && (
          <p role="status" className="mt-2 text-sm text-emerald-400">
            {flags.ai === "on" ? "AI reading is on." : "AI reading is off."}
          </p>
        )}
        <form action={saveAiConsentForm} className="mt-3 flex gap-2">
          <button type="submit" name="answer" value="yes" aria-pressed={on} className={`${pill} ${on ? "border-fg shadow-[inset_0_0_0_0.5px_var(--color-fg)] text-fg" : "border-fg/15 active:bg-mist"}`}>
            Allow
          </button>
          <button type="submit" name="answer" value="no" aria-pressed={consent === "no"} className={`${pill} ${consent === "no" ? "border-fg shadow-[inset_0_0_0_0.5px_var(--color-fg)] text-fg" : "border-fg/15 active:bg-mist"}`}>
            Don’t allow
          </button>
        </form>
      </div>

      {(blocks.length > 0 || flags.blocked || flags.unblocked) && (
        <div className="mt-4" id="blocked" data-blocked-list>
          <h3 className="mb-1 text-sm font-semibold">Blocked people</h3>
          {flags.blocked && (
            <p role="status" className="mb-2 text-sm text-emerald-400">
              Blocked. You’ll still see shared group expenses and balances.
            </p>
          )}
          {flags.unblocked && (
            <p role="status" className="mb-2 text-sm text-emerald-400">
              Unblocked.
            </p>
          )}
          {blocks.length > 0 ? (
            <ul className="divide-y divide-line border-y border-line">
              {blocks.map((b) => (
                <li key={b.blockedId} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{nameOf.get(b.blockedId) ?? "Someone"}</span>
                  <form action={unblockAction}>
                    <input type="hidden" name="accountId" value={b.blockedId} />
                    <ConfirmButton message={`Unblock ${nameOf.get(b.blockedId) ?? "this person"}? They’ll be able to send you postcards and see your passport again.`} className="min-h-11 rounded-full border border-line px-4 text-sm font-medium active:bg-mist">
                      Unblock
                    </ConfirmButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No one blocked.</p>
          )}
        </div>
      )}
    </section>
  );
}

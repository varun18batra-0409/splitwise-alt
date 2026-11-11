import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { parseDetails } from "@/lib/events";
import { COPY_DAYS } from "@/lib/left-view";
import type { GroupView } from "./view";

// What someone who left (or was removed) sees at the top of the group: the day it stopped, and what
// has moved their own share since. The rest of the page is the group as it was up to that day.
export function LeftBanner({ v }: { v: GroupView }) {
  const { leaver, tz } = v;
  if (!leaver) return null;
  const day = niceDate(dayKey(leaver.leftAt, tz));
  return (
    <div className="mb-5 rounded-2xl bg-mist px-4 py-3" data-left-banner>
      <p className="font-semibold">{leaver.removed ? `You were removed on ${day}` : `You left on ${day}`}</p>
      <p className="mt-0.5 text-sm text-gray-500">You see the group up to that day, plus any later change to your own share.</p>
    </div>
  );
}

// On Activity: first what moved their share after they left, then the group up to that day.
export function LeftSections({ v }: { v: GroupView }) {
  const { leaver, group, tz } = v;
  if (!leaver) return null;
  const day = niceDate(dayKey(leaver.leftAt, tz));
  const after = group.events
    .filter((ev) => ev.createdAt.getTime() > leaver.leftAt.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return (
    <section className="mb-4" data-left-sections>
      {after.length > 0 && (
        <div className="mb-5" data-left-after>
          <h2 className="mb-1 text-sm font-semibold text-fg/70">After you left</h2>
          <ul className="divide-y divide-line border-y border-line">
            {after.map((ev) => {
              const mine = parseDetails(ev.details).find((d) => d.includes("’s share:"));
              return (
                <li key={ev.id} className="py-3">
                  <p className="text-sm">
                    <strong className="font-medium">{v.nameOf(ev.actorId)}</strong> {ev.text}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {mine ? `${mine.replace(/^.*?’s share:\s*/, "Your share ")} · ` : ""}
                    {niceDate(dayKey(ev.createdAt, tz))}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <h2 className="text-sm font-semibold text-fg/70">Up to {day}</h2>
    </section>
  );
}

// The note under the group for someone who left.
export function LeftFootnote({ v }: { v: GroupView }) {
  const { leaver, group } = v;
  if (!leaver) return null;
  const canDownload = Date.now() - leaver.leftAt.getTime() <= COPY_DAYS * 86_400_000;
  return (
    <p className="mt-8 text-xs leading-relaxed text-gray-500" data-left-footnote>
      New expenses the group adds without you aren’t shown.
      {canDownload && (
        <>
          {" "}You can still download the group’s history for {COPY_DAYS} days after leaving.{" "}
          <a href={`/groups/${group.id}/export`} download className="font-medium text-fg underline underline-offset-4">
            Download
          </a>
        </>
      )}
    </p>
  );
}

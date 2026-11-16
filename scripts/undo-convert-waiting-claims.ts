// Batch C: put back what scripts/convert-waiting-claims.ts did. WRITTEN, NOT RUN.
//
//   npx tsx scripts/undo-convert-waiting-claims.ts <undo-file.json>                      dry run (the default)
//   npx tsx scripts/undo-convert-waiting-claims.ts <undo-file.json> --apply --backup-done  does it
//
// For each id in the file: a converted note's payment is taken off and the note waits again; a closed note waits again; the history lines
// the conversion wrote are marked undone. A note is skipped (and counted) if it has been touched since, or if another note for the same
// pair is waiting now (only one may wait). Counts only; no names or amounts.
import { readFileSync } from "node:fs";
import { undoConvertedClaims, type Change } from "@/lib/convert-claims";

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  const apply = argv.includes("--apply");
  if (!file) {
    console.error("Give the undo file the conversion wrote.");
    process.exit(2);
  }
  if (apply && !argv.includes("--backup-done")) {
    console.error("Refusing to apply: add --backup-done once a backup of the database has been taken and the founder has said go.");
    process.exit(2);
  }
  // One line per note (the conversion writes as it goes), or one JSON list (an older file).
  const text = readFileSync(file, "utf8").trim();
  const parsed: unknown = text.startsWith("[") ? JSON.parse(text) : text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  if (!Array.isArray(parsed)) throw new Error("not an undo file");
  const changes: Change[] = parsed
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x) => ({
      claimId: String(x.claimId ?? ""),
      kind: x.kind === "converted" ? ("converted" as const) : ("expired" as const),
      ...(typeof x.paymentId === "string" ? { paymentId: x.paymentId } : {}),
      ...(typeof x.eventId === "string" ? { eventId: x.eventId } : {}),
    }))
    .filter((x) => x.claimId);
  console.log(apply ? "APPLYING" : "Dry run (nothing is written)");
  const r = await undoConvertedClaims(changes, { apply });
  console.log(`${apply ? "Put back" : "Would put back"}: ${r.putBack}`);
  console.log(`Skipped (changed since, or another note already waits): ${r.skipped}`);
}

main()
  .catch((err) => {
    console.error(`Failed: ${(err as Error)?.name ?? "Error"}`);
    process.exit(1);
  })
  .finally(() => process.exit(process.exitCode ?? 0));

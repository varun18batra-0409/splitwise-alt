// Batch C: deal with the "I've paid" notes still waiting. WRITTEN, NOT RUN. Run it once, straight after the deploy.
//
//   npx tsx scripts/convert-waiting-claims.ts                      dry run (the default): counts and reasons only, nothing is written
//   npx tsx scripts/convert-waiting-claims.ts --apply --backup-done  does it, after the founder's go-ahead and a backup
//
// Each waiting note that can safely count becomes a counted payment (from the note's payer, as if just recorded, no phone notifications).
// Every other note is closed, with a history line asking the payer to record it again. See src/lib/convert-claims.ts for the exact rules.
// An apply writes an id-only undo file (no names, no amounts) that scripts/undo-convert-waiting-claims.ts reads.
// It prints counts only. It never prints a name, an amount, a token or a secret, and only the HOST of the database.
import { writeFileSync } from "node:fs";
import { convertWaitingClaims } from "@/lib/convert-claims";

function host(): string {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return "the local database file";
  try {
    return new URL(url.replace(/^libsql:/, "https:")).host;
  } catch {
    return "an online database";
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  if (apply && !args.has("--backup-done")) {
    console.error("Refusing to apply: add --backup-done once a backup of the database has been taken and the founder has said go.");
    process.exit(2);
  }
  console.log(`${apply ? "APPLYING" : "Dry run (nothing is written)"} on ${host()}`);
  const s = await convertWaitingClaims({ apply });
  console.log(`Notes waiting: ${s.waiting}`);
  console.log(`${apply ? "Converted into counted payments" : "Would be converted into counted payments"}: ${s.converted}`);
  console.log(`${apply ? "Closed (record it again)" : "Would be closed (record it again)"}: ${s.expired}`);
  for (const [reason, n] of Object.entries(s.reasons)) console.log(`  closed because ${reason}: ${n}`);
  if (s.failed) console.log(`Notes whose own step failed (nothing changed for them): ${s.failed}`);
  if (apply) {
    const file = `convert-waiting-claims-undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(s.changes, null, 2), { mode: 0o600 });
    console.log(`Undo file written: ${file} (ids only). Keep it until you are sure.`);
  }
}

main()
  .catch((err) => {
    console.error(`Failed: ${(err as Error)?.name ?? "Error"}`);
    process.exit(1);
  })
  .finally(() => process.exit(process.exitCode ?? 0));

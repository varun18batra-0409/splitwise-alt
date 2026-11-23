# Weekly photo backup: setup in plain English

## Why this exists

Loopin's photos (group covers, postcards, receipts and moments) are stored as files in Vercel Blob. The database only
holds each photo's file name. So the nightly database backup can bring back every row, but not one photo. If the Blob
store were ever lost or emptied by mistake, the rows would come back pointing at photos that no longer exist.

This job fixes that. Every Sunday (about 03:00 India time) it:

1. Reads, from the database, the name of every photo file the app uses.
2. Copies each file that is not already in a SECOND, separate Blob store. Files never change once saved, so only new ones
   are copied; the first run copies everything and may take a while.
3. Opens a random sample of 20 of the copies and checks each is a real, non-empty file. This is the photo version of the
   restore drill. If one does not open, or if the database points to a photo the live store does not have, the run turns red.

It never changes the live photo store or the live database. It never deletes anything from the copy either, so a photo
removed in the app stays in the copy until you clear the second store yourself.

It does nothing, and says so in the run's log, until all four secrets below exist. Until then the weekly run is green and
harmless. A file the listing shows at 0 bytes is copied again, and the log counts files that were already there separately
from files copied now.

## What you need to do (once)

1. In Vercel, open Storage and create a NEW Blob store, separate from the live one. Name it something like
   `loopin-photos-backup`. Make it **private**, like the live one. Put it in a different region from the live store if
   Vercel offers the choice.
2. Open that new store, go to its settings and copy its read-write token. (Paste it straight into GitHub in the next
   step; never into a chat.)
3. **Use the PRIVATE ops repo, never the public one.** The live photo store's token (`LIVE_BLOB_READ_WRITE_TOKEN`) can
   also change and delete files (Vercel has no read-only Blob token). It must go ONLY in the private ops repo's secrets
   (see `ops/private-repo/README.md`), never in the public repository. For that reason the workflow is a template in this
   folder (`photo-backup.yml`), not an active workflow in `.github/workflows` of the public repo: there it would do
   nothing, and a token that is not there cannot leak.
If you added `LIVE_BLOB_READ_WRITE_TOKEN` to the public repository before, delete it there.

4. In the private ops repo, copy `ops/photo-backup/photo-backup.yml` to `.github/workflows/photo-backup.yml`, replace
   `REPLACE_WITH_40_CHARACTER_COMMIT_ID` with the public repo's trusted commit id (as for the other ops jobs), and add these
   secrets (Settings > Secrets and variables > Actions):
   - `BACKUP_BLOB_READ_WRITE_TOKEN` - the token from step 2 (the second store, written to).
   - `LIVE_BLOB_READ_WRITE_TOKEN` - the token of the LIVE photo store (Vercel > the live Blob store > settings). Read from only.
   - `LIVE_DB_URL` and `LIVE_DB_READONLY_TOKEN` - the live database address and its read-only key. Already there if the
     private nightly backup is set up.
5. Run it once by hand: Actions > Photo backup > Run workflow. Watch it go green. The log says how many files are
   referenced, how many were copied, and how many of the sample opened. File names are shortened in the log.

## If it turns red

- "the database points to ... but the live store does not have it": a photo is already missing from the live store.
  Tell Claude; the copy cannot help for a file that was never there, but an older copy of it may exist in the second store.
- "could not copy ...": a one-off problem with the store or the network. Run it again; copied files are not repeated.
- "the copy of ... does not open": the copy is damaged or missing. Run it again (it will not recopy a file that is
  present, so tell Claude to check that file).

## Getting the photos back (a lost live store)

1. Create a new live Blob store and point the app's `BLOB_READ_WRITE_TOKEN` (in Vercel) at it.
2. Ask Claude to copy the files from the second store into the new live store under the same names. The database rows
   need no change, because they only hold the file names.

## Good to know

- Cost: the second store holds a full copy of every photo, so it costs the same as the live one. Reading each file
  once a week for the copy counts towards Vercel's data transfer.
- The weekly job's only output is counts and the first 6 characters of file names. Never photo contents, tokens or addresses.

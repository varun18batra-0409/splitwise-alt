# Private ops repo: what to copy where

These four files are templates. They do nothing in this (public) repo. They are the jobs that need the
live database's key, moved to a private repo so the backup file, the usage figures and the live counts are
not on a public page.

## What to do

1. Create a private GitHub repo, for example `loopin-ops`.
2. In it, add these secrets (Settings > Secrets and variables > Actions). Paste them straight into GitHub, never into a chat:
   - `LIVE_DB_URL` - the live database address
   - `LIVE_DB_READONLY_TOKEN` - a read-only token for the live database (Turso: `turso db tokens create <live-db> --read-only`)
   - `BACKUP_PASSPHRASE` - a NEW passphrase (6 or more random words), also saved in your password manager
   - `DRILL_DB_URL` and `DRILL_DB_TOKEN` - the spare empty database `loopin-restore-drill` and a token for that database only
   - `TURSO_PLATFORM_TOKEN` and `TURSO_ORG` - for the usage check
   - optional `HEALTHCHECK_URL` - a healthchecks.io address, which emails you if a night is missed
3. Copy each file here into the private repo under `.github/workflows/`:
   - `backup.yml` -> `.github/workflows/backup.yml`
   - `usage.yml` -> `.github/workflows/usage.yml`
   - `live-stats.yml` -> `.github/workflows/live-stats.yml`
   - `live-counts.yml` -> `.github/workflows/live-counts.yml` (run by hand; read-only counts on the live database for the clean-up items)
4. In each copied file, replace `REPLACE_WITH_40_CHARACTER_COMMIT_ID` with the full commit id of the public repo's
   `main` that you trust. (On the public repo's page, open the latest commit and copy the long id.) The private
   jobs run the public repo's scripts at exactly that commit, so a later change to `main` cannot reach the key
   until you update this line. Update it again whenever the backup scripts change.
5. The GitHub actions in these files are already pinned to full commit ids (checkout `11d5960a` is
   actions/checkout v4.4.0). Leave them as they are.
6. Run "Backup" once by hand (Actions > Backup > Run workflow, tick "real drill"). Check it goes green, and note the
   backup size in the run's notice: 14 copies must fit in the private repo's 500 MB.
7. After two green nightly runs, in the public repo: delete the secrets `BACKUP_PASSPHRASE`, `TURSO_PLATFORM_TOKEN` and
   `TURSO_ORG`, delete the old `db-backup` files from old runs, and then the public Backup, Live stats and Usage
   workflows can be removed.
8. Final step, the live key. **Before anyone runs "Schema apply"**, create the `live-database` environment (public repo:
   Settings > Environments) with a required reviewer (you), deployment limited to the `main` branch, and its own
   `TURSO_AUTH_TOKEN` (the live full-access key). If it does not exist when Schema apply first runs, GitHub creates it
   automatically with no protection. Then **delete the repository-level `TURSO_AUTH_TOKEN`**. Until you do, the key is
   still readable by every workflow in the public repo, whatever the environment says. Keep only the live database
   address (`TURSO_DATABASE_URL`), which e2e.yml and staging-uat.yml use for the "this is not the live database" check.

## Good to know

- If the first drill reports old rows (a payment of 0, a payment to yourself, a negative share), that is a finding
  about old data to look at, not a broken backup. The restore still writes everything; the checks only point at it.
- `--drill` only accepts a database whose address contains the word "drill", and the schema sync refuses any database
  that carries the drill marker. So a drill copy can never become the live database by mistake. For a real recovery,
  run the restore without `--drill`.
- The backup uses a read-only key, so it cannot change live data. If Turso refuses to open a read-only
  transaction, the first manual run will say so; tell Claude and it will adjust.
- The weekly real drill writes the whole database into the spare database. That counts towards Turso's monthly
  row-write allowance. If the database gets large, make it monthly.
- To recover for real, see the comment at the top of the public repo's old `backup.yml`, or ask Claude.

## Restoring for real (what the old public backup.yml explained)

1. Download the `db-backup` file from the latest green run in the private repo.
2. Decrypt it (type the passphrase when asked):
   `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in backup.json.enc -out backup.json`
3. Create a NEW empty Turso database and a token for it, then:
   `TURSO_AUTH_TOKEN=<its token> node scripts/restore.mjs backup.json libsql://<new-db-url>`
4. Point the app's `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (in Vercel) at it and redeploy.
   Photos kept in Blob storage are not in the backup (the restore says how many rows point at one).

# Private ops repo: what to copy where

These three files are templates. They do nothing in this (public) repo. They are the jobs that need the
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
4. In each copied file, replace `REPLACE_WITH_40_CHARACTER_COMMIT_ID` with the full commit id of the public repo's
   `main` that you trust. (On the public repo's page, open the latest commit and copy the long id.) The private
   jobs run the public repo's scripts at exactly that commit, so a later change to `main` cannot reach the key
   until you update this line. Update it again whenever the backup scripts change.
5. The files still say `@v4` for GitHub's own actions. Replace each with the full commit id for that tag, the same
   ones used in the public repo's workflows once those are pinned.
6. Run "Backup" once by hand (Actions > Backup > Run workflow, tick "real drill"). Check it goes green, and note the
   backup size in the run's notice: 14 copies must fit in the private repo's 500 MB.
7. After two green nightly runs, in the public repo: delete the secrets `BACKUP_PASSPHRASE`, `TURSO_PLATFORM_TOKEN` and
   `TURSO_ORG`, delete the old `db-backup` files from old runs, and then the public Backup, Live stats and Usage
   workflows can be removed.

## Good to know

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

import { defineConfig } from "prisma/config";

// Prisma 7 reads the database address for its command-line tool (db push, migrate diff) from here, not from schema.prisma.
// Default: the local file prisma/dev.db (the one the tests and Codespaces use). DATABASE_URL can point the tool at another
// file (turso-sync uses that for its copy of the online layout). The running app does not use this: see src/lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL || `file:${process.cwd()}/prisma/dev.db` },
});

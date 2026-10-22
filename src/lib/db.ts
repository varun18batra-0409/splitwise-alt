import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

// On the hosted app the data lives in Turso (online SQLite), set by the
// TURSO_DATABASE_URL and TURSO_AUTH_TOKEN settings. Without them (in
// Codespaces and tests) it's the local file prisma/dev.db.
function create() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return new PrismaClient();
  const client = new PrismaClient({ adapter: new PrismaLibSQL({ url, authToken: process.env.TURSO_AUTH_TOKEN }) });
  // A local database file (the automated browser tests): the app and the test
  // checker share it, so wait for each other's writes instead of timing out,
  // and let reads carry on during a write. Never used for the live database.
  if (url.startsWith("file:")) {
    void client.$queryRawUnsafe("PRAGMA busy_timeout = 20000").catch(() => undefined);
    void client.$queryRawUnsafe("PRAGMA journal_mode = WAL").catch(() => undefined);
  }
  return client;
}

// Reuse one database connection while the dev server reloads.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

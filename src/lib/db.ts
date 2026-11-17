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
  if (url.startsWith("file:")) void client.$queryRawUnsafe("PRAGMA journal_mode = WAL").catch(() => undefined);
  return client;
}

// A local database file only (never the live one). The wait for another write has to be set again and again: the local-file
// client hands its connection to every transaction (a write with nested rows, or db.$transaction) and opens a fresh one for the
// next call, and a fresh connection doesn't wait at all. A write that met another write then failed at once with "busy"
// (P2010 / SocketTimeout), which stopped the iPhone screenshot run of 17 Nov. So the wait is set on the connection before and after
// every call, and before and after every db.$transaction, so the connection the next call or transaction picks up always waits.
// Never from inside an open db.$transaction: the adapter runs one thing at a time while a transaction is open, so a call from
// inside it would wait for the transaction to end, for ever.
function waitingLocally(base: PrismaClient, client: PrismaClient): PrismaClient {
  let open = 0;
  const wait = () => base.$queryRawUnsafe("PRAGMA busy_timeout = 20000").then(() => undefined, () => undefined);
  void wait();
  const waiting = client.$extends({
    query: {
      async $allOperations({ args, query }) {
        if (open) return query(args);
        await wait();
        try {
          return await query(args);
        } finally {
          if (!open) await wait();
        }
      },
    },
  }) as unknown as PrismaClient;
  const transaction = waiting.$transaction.bind(waiting) as (...a: unknown[]) => Promise<unknown>;
  return new Proxy(waiting, {
    get(target, key, recv) {
      if (key !== "$transaction") return Reflect.get(target, key, recv);
      return async (...a: unknown[]) => {
        if (!open) await wait();
        open++;
        try {
          return await transaction(...a);
        } finally {
          open--;
          if (!open) await wait();
        }
      };
    },
  });
}

// Speed measurement, only when LOOPIN_PERF=1 (the load-test server in CI; never set on the live app):
// one line per database call with when it started, how long it took, which table and how many rows
// came back. scripts/load.ts reads these lines from the server log. It changes no result.
function withPerf(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const t = Date.now();
        const start = performance.now();
        let rows = 0;
        try {
          const result: unknown = await query(args);
          rows = Array.isArray(result) ? result.length : result == null ? 0 : 1;
          return result;
        } finally {
          console.log(`LOOPIN_PERF_Q ${JSON.stringify({ t, ms: Math.round((performance.now() - start) * 10) / 10, m: model ?? "raw", op: operation, rows })}`);
        }
      },
    },
  }) as unknown as PrismaClient;
}

// Reuse one database connection while the dev server reloads.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function build(): PrismaClient {
  const base = create();
  const client = process.env.LOOPIN_PERF === "1" ? withPerf(base) : base;
  return process.env.TURSO_DATABASE_URL?.startsWith("file:") ? waitingLocally(base, client) : client;
}

export const db = globalForPrisma.prisma ?? build();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

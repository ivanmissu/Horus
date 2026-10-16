import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";

function createMysqlPool(connectionString: string) {
  const parsedUrl = new URL(connectionString);
  if (parsedUrl.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must use the mysql:// scheme");
  }
  return createPool({
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 3306,
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: decodeURIComponent(parsedUrl.pathname.replace(/^\//, "")),
    charset: "utf8mb4",
    timezone: "Z",
    waitForConnections: true,
    connectionLimit: Number(process.env.HORUS_DB_CONNECTION_LIMIT || 10),
    enableKeepAlive: true,
  });
}

function createUnconfiguredPool(): Pool {
  const missingUrl = () => { throw new Error("DATABASE_URL is required (expected a MySQL connection URL)"); };
  return {
    query: missingUrl,
    execute: missingUrl,
    getConnection: missingUrl,
    end: async () => undefined,
  } as unknown as Pool;
}

const globalForDb = globalThis as typeof globalThis & {
  __horusMysqlPool?: Pool;
};

// Next.js must be able to compile without production secrets. Any attempted DB
// access still fails with a clear configuration error when DATABASE_URL is absent.
export const pool = globalForDb.__horusMysqlPool ?? (process.env.DATABASE_URL
  ? createMysqlPool(process.env.DATABASE_URL)
  : createUnconfiguredPool());

if (process.env.NODE_ENV !== "production") {
  globalForDb.__horusMysqlPool = pool;
}

export const db = drizzle(pool);

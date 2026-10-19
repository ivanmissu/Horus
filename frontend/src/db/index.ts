import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { createPool as createMysqlPool, type Pool as MysqlPool } from "mysql2/promise";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import { Pool as PostgresPool } from "pg";
import { databaseDialect, normalizePostgresConnectionString } from "./dialect.ts";
import * as mysqlSchema from "./schema.mysql.ts";
import * as postgresSchema from "./schema.postgres.ts";

function createMysqlConnectionPool(connectionString: string) {
  const parsedUrl = new URL(connectionString);
  return createMysqlPool({
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

function createPostgresConnectionPool(connectionString: string) {
  const parsedUrl = new URL(connectionString);
  const sslMode = parsedUrl.searchParams.get("sslmode")?.toLowerCase();
  const connectionLimit = Number(process.env.HORUS_DB_CONNECTION_LIMIT || (process.env.VERCEL ? 3 : 10));
  return new PostgresPool({
    connectionString,
    max: Number.isInteger(connectionLimit) && connectionLimit > 0 ? connectionLimit : 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    // Supabase's pooler requires TLS. The URL normalizer changes `require` to
    // `no-verify` for node-postgres while keeping the transport encrypted.
    ...(sslMode && sslMode !== "disable" ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

function createUnconfiguredPool() {
  const missingUrl = () => { throw new Error("DATABASE_URL is required (expected a MySQL or PostgreSQL connection URL)"); };
  return {
    query: missingUrl,
    execute: missingUrl,
    getConnection: missingUrl,
    connect: missingUrl,
    end: async () => undefined,
  } as unknown as MysqlPool & PostgresPool;
}

const globalForDb = globalThis as typeof globalThis & {
  __horusDatabasePool?: MysqlPool | PostgresPool;
};

const databaseUrl = process.env.DATABASE_URL;
const pool = globalForDb.__horusDatabasePool ?? (databaseUrl
  ? databaseDialect === "postgres"
    ? createPostgresConnectionPool(databaseUrl)
    : createMysqlConnectionPool(databaseUrl)
  : createUnconfiguredPool());

if (process.env.NODE_ENV !== "production") {
  globalForDb.__horusDatabasePool = pool;
}

export { databaseDialect, pool };
export const db: MySql2Database<typeof mysqlSchema> = (databaseDialect === "postgres"
  ? drizzlePostgres(pool as PostgresPool, { schema: postgresSchema })
  : drizzleMysql(pool as MysqlPool, { mode: "default", schema: mysqlSchema })) as unknown as MySql2Database<typeof mysqlSchema>;

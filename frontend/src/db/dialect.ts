export type DatabaseDialect = "mysql" | "postgres";

export function getDatabaseDialect(connectionString = process.env.DATABASE_URL): DatabaseDialect {
  if (!connectionString) return "mysql";
  const protocol = new URL(connectionString).protocol.toLowerCase();
  if (protocol === "postgres:" || protocol === "postgresql:") return "postgres";
  if (protocol === "mysql:") return "mysql";
  throw new Error("DATABASE_URL must use mysql://, postgres://, or postgresql://");
}

export const databaseDialect = getDatabaseDialect();

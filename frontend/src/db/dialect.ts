export type DatabaseDialect = "mysql" | "postgres";

export function getDatabaseDialect(connectionString = process.env.DATABASE_URL): DatabaseDialect {
  if (!connectionString) return "mysql";
  const protocol = new URL(connectionString).protocol.toLowerCase();
  if (protocol === "postgres:" || protocol === "postgresql:") return "postgres";
  if (protocol === "mysql:") return "mysql";
  throw new Error("DATABASE_URL must use mysql://, postgres://, or postgresql://");
}

export function normalizePostgresConnectionString(connectionString: string): string {
  const parsedUrl = new URL(connectionString);
  // pg-connection-string 2.11+ treats sslmode=require as strict certificate
  // verification. Supabase's pooler certificate chain can fail Node's CA check;
  // no-verify still encrypts the connection but skips certificate verification.
  if (parsedUrl.searchParams.get("sslmode")?.toLowerCase() === "require") {
    parsedUrl.searchParams.set("sslmode", "no-verify");
  }
  return parsedUrl.toString();
}

export const databaseDialect = getDatabaseDialect();

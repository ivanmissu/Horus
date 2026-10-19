import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { getDatabaseDialect } from "./src/db/dialect.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run Drizzle Kit");
}

const dialect = getDatabaseDialect(databaseUrl);
export default defineConfig({
  dialect: dialect === "postgres" ? "postgresql" : "mysql",
  schema: dialect === "postgres" ? "./src/db/schema.postgres.ts" : "./src/db/schema.mysql.ts",
  dbCredentials: { url: databaseUrl },
});

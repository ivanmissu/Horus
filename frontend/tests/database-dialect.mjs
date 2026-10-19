import assert from "node:assert/strict";
import { parse } from "pg-connection-string";
import { getDatabaseDialect, normalizePostgresConnectionString } from "../src/db/dialect.ts";

assert.equal(getDatabaseDialect("mysql://horus:secret@localhost:3306/horus"), "mysql");
assert.equal(getDatabaseDialect("postgres://user:secret@localhost:5432/horus"), "postgres");
assert.equal(getDatabaseDialect("postgresql://user:secret@localhost:5432/horus?sslmode=require"), "postgres");
const normalizedPoolerUrl = new URL(normalizePostgresConnectionString("postgresql://user:secret@localhost:6543/horus?sslmode=require"));
assert.equal(normalizedPoolerUrl.searchParams.get("sslmode"), "no-verify");
assert.equal(normalizedPoolerUrl.hostname, "localhost");
assert.equal(parse(normalizedPoolerUrl.toString()).ssl.rejectUnauthorized, false);
assert.equal(normalizePostgresConnectionString("postgresql://user:secret@localhost:5432/horus?sslmode=verify-full"), "postgresql://user:secret@localhost:5432/horus?sslmode=verify-full");
assert.throws(() => getDatabaseDialect("sqlite://localhost/horus"), /DATABASE_URL must use/);
console.log("DATABASE_URL MySQL/PostgreSQL provider selection checks passed");

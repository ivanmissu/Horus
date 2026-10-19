import assert from "node:assert/strict";
import { getDatabaseDialect } from "../src/db/dialect.ts";

assert.equal(getDatabaseDialect("mysql://horus:secret@localhost:3306/horus"), "mysql");
assert.equal(getDatabaseDialect("postgres://user:secret@localhost:5432/horus"), "postgres");
assert.equal(getDatabaseDialect("postgresql://user:secret@localhost:5432/horus?sslmode=require"), "postgres");
assert.throws(() => getDatabaseDialect("sqlite://localhost/horus"), /DATABASE_URL must use/);
console.log("DATABASE_URL MySQL/PostgreSQL provider selection checks passed");

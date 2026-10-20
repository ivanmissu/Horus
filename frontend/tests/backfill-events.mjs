import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/mysql2";
import { backfillRequirementEvents } from "../src/db/backfill-events.ts";
import * as mysqlSchema from "../src/db/schema.mysql.ts";

// Contract check against the installed drizzle-orm: MySQL `INSERT IGNORE` is
// selected on the insert builder (`.ignore()` before `.values()`). The built
// statement has no `.ignore()` method — calling it there threw
// "TypeError: n.ignore is not a function" and broke every statistics request.
const sampleRow = {
  requirementId: 1,
  teamId: "team-1",
  type: "created",
  detail: {},
  estimated: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const realDb = drizzle({ query() {}, execute() {} }, { mode: "default", schema: mysqlSchema });
assert.equal(typeof realDb.insert(mysqlSchema.requirementEvents).ignore, "function", "drizzle MySQL builder must expose ignore()");
const builtStatement = realDb.insert(mysqlSchema.requirementEvents).values([sampleRow]);
assert.equal(typeof builtStatement.ignore, "undefined", "built statement must not expose ignore() — chain it before .values()");
assert.match(
  realDb.insert(mysqlSchema.requirementEvents).ignore().values([sampleRow]).toSQL().sql,
  /^insert ignore into /i,
  "builder-level ignore() must generate INSERT IGNORE",
);

// Stub whose shape mirrors the drizzle API above: `ignore()` lives on the
// builder, `onConflictDoNothing()` lives on the built statement, and the built
// statement deliberately has no `ignore()`. Reintroducing the old
// `statement.ignore()` call fails here exactly like it did in production.
function createStubDatabase(log, { requirementRows, auditRows }) {
  const nameOf = (table) => table[Symbol.for("drizzle:Name")];
  return {
    select: () => ({
      from: (table) => {
        const name = nameOf(table);
        if (name === "horus_requirements") return Promise.resolve(requirementRows);
        if (name === "horus_audit_logs") return Promise.resolve(auditRows);
        throw new Error(`unexpected select from ${String(name)}`);
      },
    }),
    insert: () => ({
      ignore: () => ({
        values: (chunk) => {
          log.push({ dialect: "mysql", size: chunk.length });
          return Promise.resolve();
        },
      }),
      values: (chunk) => ({
        onConflictDoNothing() {
          log.push({ dialect: "postgres", size: chunk.length });
          return Promise.resolve();
        },
      }),
    }),
  };
}

// 250 untouched requirements produce one `created` event each, forcing the
// 200-row chunk loop to issue two inserts (200 + 50).
const requirementRows = Array.from({ length: 250 }, (_, index) => ({
  id: index + 1,
  teamId: "team-1",
  status: "developing",
  createdAt: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
  blocked: false,
}));

const mysqlLog = [];
const mysqlResult = await backfillRequirementEvents(
  createStubDatabase(mysqlLog, { requirementRows, auditRows: [] }),
  "mysql",
);
assert.deepEqual(mysqlLog, [
  { dialect: "mysql", size: 200 },
  { dialect: "mysql", size: 50 },
]);
assert.deepEqual(mysqlResult, { requirements: 250, events: 250 });

const postgresLog = [];
const postgresResult = await backfillRequirementEvents(
  createStubDatabase(postgresLog, { requirementRows, auditRows: [] }),
  "postgres",
);
assert.deepEqual(postgresLog, [
  { dialect: "postgres", size: 200 },
  { dialect: "postgres", size: 50 },
]);
assert.deepEqual(postgresResult, { requirements: 250, events: 250 });

console.log("Backfill event inserts use the correct dialect-specific upsert APIs");

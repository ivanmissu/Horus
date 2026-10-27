import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema.postgres.ts";

const root = new URL("../../", import.meta.url);
const sql = readFileSync(new URL("deploy/postgres/01-schema.sql", root), "utf8");
const tableNames = [
  "teams",
  "members",
  "requirements",
  "sessions",
  "auditLogs",
  "requirementEvents",
  "requirementPool",
  "notificationSettings",
  "notificationLogs",
];
const configs = tableNames.map(key => getTableConfig(schema[key]));
assert.equal(configs.length, 9);

const ddl = new Map();
for (const [, table, body] of sql.matchAll(/^CREATE TABLE "([a-z0-9_]+)" \(([\s\S]*?)^\);/gm)) {
  const columns = new Set();
  for (const [, column] of body.matchAll(/^\s+"([a-z0-9_]+)"\s+/gm)) columns.add(column);
  ddl.set(table, columns);
}
assert.deepEqual(
  [...ddl.keys()].sort(),
  configs.map(config => config.name).sort(),
  "table names in deploy/postgres/01-schema.sql differ from the PostgreSQL Drizzle schema",
);
for (const config of configs) {
  const schemaColumns = config.columns.map(column => column.name).sort();
  assert.deepEqual(
    [...ddl.get(config.name)].sort(),
    schemaColumns,
    `column list of ${config.name} drifted between PostgreSQL SQL and Drizzle schema`,
  );
}
for (const constraint of [
  'CONSTRAINT "horus_teams_name_unique" UNIQUE ("name")',
  'CONSTRAINT "horus_members_username_unique" UNIQUE ("username")',
  'CREATE INDEX "horus_sessions_member_id_idx" ON "horus_sessions" ("member_id")',
  'CREATE INDEX "horus_audit_logs_requirement_id_idx" ON "horus_audit_logs" ("requirement_id")',
  'CONSTRAINT "horus_requirement_events_unique" UNIQUE ("requirement_id", "type", "created_at")',
  'CREATE INDEX "horus_requirement_events_requirement_id_idx" ON "horus_requirement_events" ("requirement_id")',
  'CREATE INDEX "horus_requirement_events_created_at_idx" ON "horus_requirement_events" ("created_at")',
  'CREATE INDEX "horus_requirement_events_team_id_idx" ON "horus_requirement_events" ("team_id")',
  'CREATE INDEX "horus_requirement_pool_team_id_idx" ON "horus_requirement_pool" ("team_id")',
  'ALTER TABLE "horus_teams" ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE "horus_members" ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE "horus_requirement_events" ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE "horus_requirements" ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE "horus_requirement_pool" ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE "horus_sessions" ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE "horus_audit_logs" ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE "horus_notification_settings" ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE "horus_notification_logs" ENABLE ROW LEVEL SECURITY',
]) {
  assert.ok(sql.includes(constraint), `PostgreSQL schema is missing ${constraint}`);
}
console.log(`PostgreSQL SQL / Drizzle schema are in sync (${configs.length} tables)`);

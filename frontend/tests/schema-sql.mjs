import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guards the "initialize MySQL with SQL, skip drizzle-kit at startup" path:
// deploy/mysql/01-schema.sql is authoritative there, so it must not drift away from
// the MySQL Drizzle schema, and the generic container entrypoint must verify its tables.
const root = new URL("../../", import.meta.url); // repository root

const schemaSource = readFileSync(new URL("frontend/src/db/schema.mysql.ts", root), "utf8");
const sqlSource = readFileSync(new URL("deploy/mysql/01-schema.sql", root), "utf8");
const entrySource = readFileSync(new URL("frontend/docker-entrypoint.sh", root), "utf8");

const tables = new Map();
const starts = [...schemaSource.matchAll(/export const \w+ = mysqlTable\(\s*"([a-z0-9_]+)"/g)];
assert.ok(starts.length >= 8, `expected at least 8 tables in schema.ts, found ${starts.length}`);
starts.forEach((match, i) => {
  const end = starts[i + 1] ? starts[i + 1].index : schemaSource.length;
  const body = schemaSource.slice(match.index, end);
  const columns = new Set();
  for (const [, column] of body.matchAll(/^\s{2}\w+:\s*\w+\("([a-z0-9_]+)"/gm)) {
    columns.add(column);
  }
  assert.ok(columns.size, `no columns parsed for ${match[1]} - the parser needs updating`);
  tables.set(match[1], columns);
});

const ddl = new Map();
for (const [, name, body] of sqlSource.matchAll(/CREATE TABLE `([a-z0-9_]+)` \(([\s\S]*?)\n\);/g)) {
  const columns = new Set();
  for (const [, column] of body.matchAll(/^CREATE TABLE|^\t`([a-z0-9_]+)`/gm)) {
    if (column) columns.add(column);
  }
  ddl.set(name, columns);
}
assert.deepEqual(
  [...ddl.keys()].sort(),
  [...tables.keys()].sort(),
  "table names in 01-schema.sql differ from schema.ts",
);
for (const [name, columns] of tables) {
  assert.deepEqual(
    [...ddl.get(name)].sort(),
    [...columns].sort(),
    `column list of ${name} drifted between 01-schema.sql and schema.ts`,
  );
}

// Constraints the application relies on (idempotent inserts / unique usernames).
for (const constraint of [
  "CONSTRAINT `horus_teams_name_unique` UNIQUE(`name`)",
  "CONSTRAINT `horus_members_username_unique` UNIQUE(`username`)",
  "CREATE INDEX `horus_sessions_member_id_idx` ON `horus_sessions` (`member_id`)",
  "CREATE INDEX `horus_audit_logs_requirement_id_idx` ON `horus_audit_logs` (`requirement_id`)",
  "CONSTRAINT `horus_requirement_events_unique` UNIQUE(`requirement_id`,`type`,`created_at`)",
  "CREATE INDEX `horus_requirement_events_requirement_id_idx` ON `horus_requirement_events` (`requirement_id`)",
  "CREATE INDEX `horus_requirement_events_created_at_idx` ON `horus_requirement_events` (`created_at`)",
  "CREATE INDEX `horus_requirement_events_team_id_idx` ON `horus_requirement_events` (`team_id`)",
]) {
  assert.ok(sqlSource.includes(constraint), `01-schema.sql is missing: ${constraint}`);
}

const verified = entrySource.match(/const required = \[([\s\S]*?)\];/);
assert.ok(verified, "docker-entrypoint.sh no longer lists the required tables");
assert.deepEqual(
  [...verified[1].matchAll(/"(horus_[a-z0-9_]+)"/g)].map(m => m[1]).sort(),
  [...tables.keys()].sort(),
  "the entrypoint table check covers a different set of tables than schema.ts",
);

console.log(`Schema SQL / Drizzle schema / entrypoint check are in sync (${tables.size} tables)`);

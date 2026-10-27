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
assert.ok(starts.length >= 9, `expected at least 9 tables in schema.ts, found ${starts.length}`);
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

// The container runs `db:backfill` from the migrator stage, so every runtime
// module the CLI imports (relative imports only) must be copied there. A
// missing file only shows up as ERR_MODULE_NOT_FOUND on a live upgrade, which
// is exactly the case this backfill exists for.
const dockerfile = readFileSync(new URL("frontend/Dockerfile", root), "utf8");
const migrator = dockerfile.split(/^FROM .* AS migrator$/m)[1]?.split(/^FROM /m)[0] ?? "";
assert.ok(migrator, "Dockerfile no longer has a migrator stage");
const copies = [...migrator.matchAll(/^COPY (?:--\S+ )?(.+?) (\S+)$/gm)]
  .flatMap(([, sources, target]) => sources.trim().split(/\s+/).map(source => ({ source, target })));
const shipped = new Set();
for (const { source, target } of copies) {
  if (target.endsWith("/") || !/\.[a-z]+$/.test(source)) continue; // directory copy: covered by prefix check below
  shipped.add(target.replace(/^\.\//, ""));
}
function isShipped(file) {
  if (shipped.has(file)) return true;
  return copies.some(({ source, target }) => !/\.[a-z]+$/.test(source) && file.startsWith(`${target.replace(/^\.\//, "")}/`));
}
function runtimeImports(file) {
  const source = readFileSync(new URL(`frontend/${file}`, root), "utf8");
  return source.split("\n")
    .filter(line => !line.trimStart().startsWith("import type"))
    .flatMap(line => [...line.matchAll(/from\s+"(\.[^"]+)"/g)].map(match => match[1]));
}
const frontendRoot = new URL("frontend/", root);
const toRelative = url => url.pathname.slice(frontendRoot.pathname.length);
const pending = ["src/db/backfill-events-cli.ts"];
const seen = new Set();
const missing = [];
while (pending.length) {
  const file = pending.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!isShipped(file)) missing.push(file);
  for (const spec of runtimeImports(file)) {
    pending.push(toRelative(new URL(spec, new URL(file, frontendRoot))));
  }
}
assert.deepEqual(missing, [], `Dockerfile migrator stage is missing files needed by db:backfill: ${missing.join(", ")}`);

console.log(`Schema SQL / Drizzle schema / entrypoint check are in sync (${tables.size} tables)`);
console.log(`db:backfill runtime modules are shipped in the image (${seen.size} files checked)`);

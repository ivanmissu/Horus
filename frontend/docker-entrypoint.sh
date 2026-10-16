#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

echo "Waiting for MySQL..."
cd /opt/horus-migrate
node --input-type=module <<'EOF'
import mysql from "mysql2/promise";

const url = new URL(process.env.DATABASE_URL);
const deadline = Date.now() + 90_000;
let lastMessage = "unknown error";
while (Date.now() < deadline) {
  try {
    const connection = await mysql.createConnection({
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    });
    await connection.query("SELECT 1");
    await connection.end();
    console.log("MySQL is ready");
    process.exit(0);
  } catch (error) {
    lastMessage = error instanceof Error ? error.message : String(error);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
console.error(`MySQL did not become ready within 90s: ${lastMessage}`);
process.exit(1);
EOF

echo "Synchronizing MySQL schema..."
# drizzle-kit push logs failures and still exits 0. Verify the seven tables afterwards.
CI=1 ./node_modules/.bin/drizzle-kit push --force --verbose --config ./drizzle.config.ts
node --input-type=module <<'EOF'
import mysql from "mysql2/promise";

const required = [
  "horus_teams",
  "horus_members",
  "horus_requirements",
  "horus_sessions",
  "horus_audit_logs",
  "horus_notification_settings",
  "horus_notification_logs",
];
const url = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: decodeURIComponent(url.pathname.replace(/^\//, "")),
});
const [rows] = await connection.query(
  "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
);
await connection.end();
const present = new Set(rows.map(row => String(row.name ?? row.NAME ?? row.table_name ?? "")));
const missing = required.filter(name => !present.has(name));
if (missing.length) {
  console.error(`Schema sync did not create: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`MySQL schema ready (${required.length} tables)`);
EOF

echo "Initializing production owner and notification settings..."
node --experimental-strip-types src/db/init-prod.ts

echo "Starting Horus..."
cd /app
# Docker sets HOSTNAME to the container id, which would make Next bind the wrong address.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"
exec "$@"

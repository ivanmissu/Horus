#!/bin/sh
# Horus container bootstrap. Load the mounted environment first, wait for the
# configured database, prepare the schema, initialize the owner, then start Next.js.
#
# HORUS_DB_PUSH=false skips drizzle-kit push but still verifies all eight tables.
# HORUS_DB_INIT=false skips the idempotent owner/notification bootstrap.
# HORUS_DB_WAIT_TIMEOUT=90 limits connection retries; HORUS_DB_STEP_TIMEOUT=180
# limits each database step (0 disables the step timeout).
# HORUS_MIGRATE_DIR=/opt/horus-migrate points to the bundled schema toolchain.

set -eu

MIGRATE_DIR=${HORUS_MIGRATE_DIR:-/opt/horus-migrate}
HORUS_DB_PUSH=${HORUS_DB_PUSH:-true}
HORUS_DB_INIT=${HORUS_DB_INIT:-true}
HORUS_DB_WAIT_TIMEOUT=${HORUS_DB_WAIT_TIMEOUT:-90}
HORUS_DB_STEP_TIMEOUT=${HORUS_DB_STEP_TIMEOUT:-180}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

flag_is_true() {
  case $(printf '%s' "$1" | tr '[:upper:]' '[:lower:]') in
    true | 1 | yes | on) return 0 ;;
    false | 0 | no | off) return 1 ;;
    *) fail "$2 must be true or false (got '$1')" ;;
  esac
}

seconds_only() {
  case "$1" in
    '' | *[!0-9]*) fail "$2 must be a whole number of seconds (got '$1')" ;;
  esac
}

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is required"
[ -d "$MIGRATE_DIR" ] || fail "schema toolchain not found at $MIGRATE_DIR (set HORUS_MIGRATE_DIR)"
seconds_only "$HORUS_DB_WAIT_TIMEOUT" HORUS_DB_WAIT_TIMEOUT
seconds_only "$HORUS_DB_STEP_TIMEOUT" HORUS_DB_STEP_TIMEOUT

DO_PUSH=1
flag_is_true "$HORUS_DB_PUSH" HORUS_DB_PUSH || DO_PUSH=0
DO_INIT=1
flag_is_true "$HORUS_DB_INIT" HORUS_DB_INIT || DO_INIT=0

run_step() {
  label=$1
  shift
  status=0
  if [ "$HORUS_DB_STEP_TIMEOUT" -gt 0 ] && command -v timeout >/dev/null 2>&1; then
    timeout -k 5 "$HORUS_DB_STEP_TIMEOUT" "$@" || status=$?
  else
    "$@" || status=$?
  fi
  case "$status" in
    0) return 0 ;;
    124 | 137)
      fail "$label did not finish within ${HORUS_DB_STEP_TIMEOUT}s and was killed. Check database DNS, firewall, credentials, and that DATABASE_URL does not use localhost/127.0.0.1 from inside the container."
      ;;
    *) fail "$label failed (exit $status). See the log lines above." ;;
  esac
}

printf 'Database bootstrap: push=%s init=%s wait_timeout=%ss step_timeout=%ss\n' \
  "$([ "$DO_PUSH" -eq 1 ] && printf true || printf false)" \
  "$([ "$DO_INIT" -eq 1 ] && printf true || printf false)" \
  "$HORUS_DB_WAIT_TIMEOUT" "$HORUS_DB_STEP_TIMEOUT"

cd "$MIGRATE_DIR"
printf 'Waiting for database...\n'
run_step "Waiting for database" node --input-type=module <<'EOF'
const url = new URL(process.env.DATABASE_URL);
const isPostgres = url.protocol === "postgres:" || url.protocol === "postgresql:";
const deadline = Date.now() + Number(process.env.HORUS_DB_WAIT_TIMEOUT || 90) * 1000;
let lastMessage = "unknown error";
while (Date.now() < deadline) {
  try {
    if (isPostgres) {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        ...(url.searchParams.get("sslmode") && url.searchParams.get("sslmode") !== "disable"
          ? { ssl: { rejectUnauthorized: false } }
          : {}),
        connectionTimeoutMillis: 5000,
      });
      try { await pool.query("SELECT 1"); } finally { await pool.end(); }
      console.log("PostgreSQL is ready");
    } else if (url.protocol === "mysql:") {
      const { default: mysql } = await import("mysql2/promise");
      const connection = await mysql.createConnection({
        host: url.hostname,
        port: url.port ? Number(url.port) : 3306,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)),
        connectTimeout: 5000,
      });
      await connection.query("SELECT 1");
      await connection.end();
      console.log("MySQL is ready");
    } else {
      throw new Error("DATABASE_URL must use mysql://, postgres://, or postgresql://");
    }
    process.exit(0);
  } catch (error) {
    lastMessage = error instanceof Error ? error.message : String(error);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
console.error(`Database did not become ready within ${process.env.HORUS_DB_WAIT_TIMEOUT || 90}s: ${lastMessage}`);
process.exit(1);
EOF

if [ "$DO_PUSH" -eq 1 ]; then
  printf 'Synchronizing database schema...\n'
  # Verify below too: drizzle-kit can log schema errors without a failing exit code.
  run_step "drizzle-kit push" env CI=1 ./node_modules/.bin/drizzle-kit push --force --verbose --config ./drizzle.config.ts
else
  printf 'Skipping schema synchronization (HORUS_DB_PUSH=false); verifying tables only...\n'
fi

run_step "Schema verification" node --input-type=module <<'EOF'
const required = [
  "horus_teams",
  "horus_members",
  "horus_requirements",
  "horus_sessions",
  "horus_audit_logs",
  "horus_requirement_events",
  "horus_notification_settings",
  "horus_notification_logs",
];
const url = new URL(process.env.DATABASE_URL);
const isPostgres = url.protocol === "postgres:" || url.protocol === "postgresql:";
let rows;
if (isPostgres) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ...(url.searchParams.get("sslmode") && url.searchParams.get("sslmode") !== "disable"
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  });
  try {
    rows = (await pool.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'",
    )).rows;
  } finally {
    await pool.end();
  }
} else {
  const { default: mysql } = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectTimeout: 5000,
  });
  try {
    [rows] = await connection.query(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
  } finally {
    await connection.end();
  }
}
const present = new Set(rows.map(row => String(row.name ?? row.NAME ?? row.table_name ?? "")));
const missing = required.filter(name => !present.has(name));
if (missing.length) {
  const schemaPath = isPostgres ? "deploy/postgres/01-schema.sql" : "deploy/mysql/01-schema.sql";
  const hint = process.env.HORUS_DB_PUSH && /^(false|0|no|off)$/i.test(process.env.HORUS_DB_PUSH)
    ? `Apply ${schemaPath} on this database, or set HORUS_DB_PUSH=true to let the container create the tables.`
    : "Check the drizzle-kit output above; the database account needs CREATE/ALTER rights.";
  console.error(`Schema sync did not create: ${missing.join(", ")}. ${hint}`);
  process.exit(1);
}
console.log(`${isPostgres ? "PostgreSQL" : "MySQL"} schema ready (${required.length} tables)`);
EOF

if [ "$DO_INIT" -eq 1 ]; then
  printf 'Initializing production owner and notification settings...\n'
  run_step "Owner initialization" node --experimental-strip-types src/db/init-prod.ts
else
  printf 'Skipping owner initialization (HORUS_DB_INIT=false).\n'
fi

printf 'Starting Horus...\n'
cd /app
# Docker sets HOSTNAME to the container id, which would make Next bind the wrong address.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"
exec "$@"

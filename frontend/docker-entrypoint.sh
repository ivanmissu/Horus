#!/bin/sh
# Horus container bootstrap.
#
# Startup order: docker-entrypoint.cjs loads the mounted .env, then this script
# waits for MySQL, prepares the schema, bootstraps the owner account and
# finally execs Next.js.
#
# Database switches (all optional, read from the process environment):
#   HORUS_DB_PUSH=false       Never run `drizzle-kit push`. Use when the DDL is applied
#                             outside the container (deploy/mysql/01-schema.sql), or when
#                             the app account has no DDL rights. The seven tables are still
#                             verified before the app starts, so a missing table fails here
#                             instead of on the first business request.
#   HORUS_DB_INIT=false       Skip the idempotent owner + notification-settings bootstrap.
#                             Use when deploy/mysql/02-init-owner.sql has already run.
#   HORUS_DB_WAIT_TIMEOUT=90  Seconds to keep trying MySQL before giving up.
#   HORUS_DB_STEP_TIMEOUT=180 Wall-clock cap per database step, 0 disables it. Without it a
#                             Pod that cannot reach MySQL hangs forever inside drizzle-kit
#                             ("Pulling schema from database...").
#   HORUS_MIGRATE_DIR=/opt/horus-migrate  Schema toolchain + src/db baked into the image.

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

# Accepts true/false (also 1/0, yes/no, on/off); anything else is a typo worth failing on.
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

# Wraps a command so a blocked network can stall the rollout forever, and turns an
# unexplained timeout into an actionable message.
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
      fail "$label did not finish within ${HORUS_DB_STEP_TIMEOUT}s and was killed. This Pod most likely cannot reach MySQL (DNS, firewall, security group, or a host of localhost/127.0.0.1 in DATABASE_URL). Fix connectivity, raise HORUS_DB_STEP_TIMEOUT, or pre-apply deploy/mysql/01-schema.sql and set HORUS_DB_PUSH=false + HORUS_DB_INIT=false."
      ;;
    *) fail "$label failed (exit $status). See the log lines above." ;;
  esac
}

printf 'Database bootstrap: push=%s init=%s wait_timeout=%ss step_timeout=%ss\n' \
  "$([ "$DO_PUSH" -eq 1 ] && printf true || printf false)" \
  "$([ "$DO_INIT" -eq 1 ] && printf true || printf false)" \
  "$HORUS_DB_WAIT_TIMEOUT" "$HORUS_DB_STEP_TIMEOUT"

cd "$MIGRATE_DIR"

printf 'Waiting for MySQL...\n'
run_step "Waiting for MySQL" node --input-type=module <<'EOF'
import mysql from "mysql2/promise";

const url = new URL(process.env.DATABASE_URL);
const deadline = Date.now() + Number(process.env.HORUS_DB_WAIT_TIMEOUT || 90) * 1000;
let lastMessage = "unknown error";
while (Date.now() < deadline) {
  try {
    const connection = await mysql.createConnection({
      host: url.hostname,
      port: url.port ? Number(url.port) : 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
      // Fail each probe attempt fast instead of relying on the OS TCP timeout.
      connectTimeout: 5000,
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
console.error(`MySQL did not become ready within ${process.env.HORUS_DB_WAIT_TIMEOUT || 90}s: ${lastMessage}`);
process.exit(1);
EOF

if [ "$DO_PUSH" -eq 1 ]; then
  printf 'Synchronizing MySQL schema...\n'
  # drizzle-kit push logs failures and still exits 0, which is why the table
  # check below runs in both modes.
  run_step "drizzle-kit push" env CI=1 ./node_modules/.bin/drizzle-kit push --force --verbose --config ./drizzle.config.ts
else
  printf 'Skipping schema synchronization (HORUS_DB_PUSH=false); verifying tables only...\n'
fi

run_step "Schema verification" node --input-type=module <<'EOF'
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
  connectTimeout: 5000,
});
let rows;
try {
  [rows] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
  );
} finally {
  await connection.end();
}
const present = new Set(rows.map(row => String(row.name ?? row.NAME ?? row.table_name ?? "")));
const missing = required.filter(name => !present.has(name));
if (missing.length) {
  const hint =
    process.env.HORUS_DB_PUSH && /^(false|0|no|off)$/i.test(process.env.HORUS_DB_PUSH)
      ? "Apply deploy/mysql/01-schema.sql on this database (./scripts/init-sql.sh), or set HORUS_DB_PUSH=true to let the container create them."
      : "Check the drizzle-kit output above; the account also needs CREATE/ALTER rights on this database.";
  console.error(`Schema sync did not create: ${missing.join(", ")}. ${hint}`);
  process.exit(1);
}
console.log(`MySQL schema ready (${required.length} tables)`);
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

#!/bin/sh
# Horus · 在外部 MySQL 上一次性初始化数据库（建表 + 初始负责人），之后容器内不再跑 Drizzle。
#
# 用法（在本仓库根目录执行，机器上要有能连到目标 MySQL 的 mysql 客户端）：
#   DATABASE_URL='mysql://horus:<密码>@mysql.internal:3306/horus' ./scripts/init-sql.sh
#   ./scripts/init-sql.sh --host mysql.internal --user horus --database horus   # 密码交互输入
#
# 选项：
#   --host/--port/--user/--database/--password  覆盖 DATABASE_URL 里的对应部分
#   --force        库里已存在 horus_* 表时仍然执行建表脚本（默认拒绝，避免重复建表报错）
#   --only-schema  只执行 01-schema.sql
#   --only-owner   只执行 02-init-owner.sql（幂等，可重复跑）
#   --sql-dir DIR  SQL 文件目录，默认 deploy/mysql
#   --help         显示本说明
#
# 说明：
#   - 本脚本只负责「人工执行仓库里的官方 SQL」，不碰应用容器。
#     建库、建账号、授权（CREATE DATABASE / CREATE USER / GRANT）需要 root 或 DBA 账号，不在本脚本范围内。
#   - 密码通过子进程环境变量传给 mysql 客户端，不会出现在命令行里；不在 URL 中给出时会交互提示。
#   - 初始化完成后，在应用环境里设 HORUS_DB_PUSH=false 即可跳过容器内的 drizzle-kit push；
#     若也执行了 02-init-owner.sql，可再设 HORUS_DB_INIT=false 连负责人初始化一起跳过。
#   - DATABASE_URL 中被百分号编码的字符（如 %40）会先还原再使用，与应用侧行为一致。

set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
SQL_DIR="$ROOT_DIR/deploy/mysql"
MYSQL_BIN=${MYSQL_BIN:-mysql}
URL=${DATABASE_URL:-}
FORCE=0
RUN_SCHEMA=1
RUN_OWNER=1
DB_USER=""
DB_PASS=""
DB_HOST=""
DB_PORT=""
DB_NAME=""

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  # 打印文件头部的注释说明（跳过 shebang）
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
}

# 百分号解码（%40 -> @），与应用的 decodeURIComponent 保持一致
urldecode() {
  printf '%s' "$1" | awk '{
    s = $0; out = ""; digits = "0123456789abcdef";
    for (i = 1; i <= length(s); i++) {
      c = substr(s, i, 1)
      if (c == "%" && i + 2 <= length(s)) {
        h = substr(s, i + 1, 2)
        v1 = index(digits, tolower(substr(h, 1, 1))) - 1
        v2 = index(digits, tolower(substr(h, 2, 1))) - 1
        if (v1 >= 0 && v2 >= 0) { out = out sprintf("%c", v1 * 16 + v2); i += 2; continue }
      }
      out = out c
    }
    printf "%s", out
  }'
}

if [ -n "$URL" ]; then
  case "$URL" in
    mysql://*) : ;;
    *) fail "DATABASE_URL 必须以 mysql:// 开头" ;;
  esac
  rest=${URL#mysql://}
  creds=${rest%@*}        # 最后一个 @ 之前：user:password
  authority=${rest##*@}   # 最后一个 @ 之后：host:port/database
  if [ "$creds" = "$rest" ]; then
    authority=$rest        # URL 里没有凭证
    creds=""
  fi
  DB_USER=$(urldecode "${creds%%:*}")
  DB_PASS_RAW=${creds#*:}
  [ "$DB_PASS_RAW" = "$creds" ] && DB_PASS_RAW=""
  DB_PASS=$(urldecode "$DB_PASS_RAW")
  hostpart=${authority%%/*}
  DB_NAME=${authority#*/}
  DB_NAME=${DB_NAME%%\?*}
  DB_HOST=${hostpart%%:*}
  DB_PORT=${hostpart##*:}
  [ "$DB_PORT" = "$hostpart" ] && DB_PORT=""
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) DB_HOST=${2:-}; shift 2 ;;
    --port) DB_PORT=${2:-}; shift 2 ;;
    --user) DB_USER=${2:-}; shift 2 ;;
    --database) DB_NAME=${2:-}; shift 2 ;;
    --password) DB_PASS=${2:-}; shift 2 ;;
    --sql-dir) SQL_DIR=${2:-}; shift 2 ;;
    --force) FORCE=1; shift ;;
    --only-schema) RUN_OWNER=0; shift ;;
    --only-owner) RUN_SCHEMA=0; shift ;;
    --help | help) usage; exit 0 ;;
    *) fail "未知参数：$1（--help 查看用法）" ;;
  esac
done

SCHEMA_SQL="$SQL_DIR/01-schema.sql"
OWNER_SQL="$SQL_DIR/02-init-owner.sql"
DB_PORT=${DB_PORT:-3306}

[ -n "$DB_HOST" ] || fail "缺少主机名：设置 DATABASE_URL 或使用 --host"
[ -n "$DB_NAME" ] || fail "缺少数据库名：设置 DATABASE_URL 或使用 --database"
[ -n "$DB_USER" ] || fail "缺少用户名：设置 DATABASE_URL 或使用 --user"
command -v "$MYSQL_BIN" >/dev/null 2>&1 || fail "找不到 mysql 客户端（可用 MYSQL_BIN=/path/to/mysql 指定）"
[ "$RUN_SCHEMA" -eq 0 ] || [ -f "$SCHEMA_SQL" ] || fail "找不到 $SCHEMA_SQL"
[ "$RUN_OWNER" -eq 0 ] || [ -f "$OWNER_SQL" ] || fail "找不到 $OWNER_SQL"

if [ -z "$DB_PASS" ]; then
  printf 'MySQL password for %s@%s:%s/%s: ' "$DB_USER" "$DB_HOST" "$DB_PORT" "$DB_NAME"
  if stty -echo 2>/dev/null; then
    read -r DB_PASS || fail "读取密码失败（非交互终端请改用 --password 或 DATABASE_URL）"
    stty echo 2>/dev/null || true
    printf '\n'
  else
    read -r DB_PASS || fail "读取密码失败（非交互终端请改用 --password 或 DATABASE_URL）"
  fi
  [ -n "$DB_PASS" ] || fail "密码不能为空"
fi

# 只给子进程用，避免把密码写进命令行
mysql_cli() {
  MYSQL_PWD=$DB_PASS "$MYSQL_BIN" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -D "$DB_NAME" \
    --default-character-set=utf8mb4 "$@"
}

query() {
  mysql_cli -N -B -e "$1" | tr -d '\r'
}

printf '==> 连接 %s@%s:%s/%s ...\n' "$DB_USER" "$DB_HOST" "$DB_PORT" "$DB_NAME"
VERSION=$(query "SELECT VERSION()") || true
[ -n "$VERSION" ] || fail "连接失败或账号无权限：请检查网络可达性、账号密码，以及该账号对 $DB_NAME 库的权限"
printf '    连接成功：MySQL %s\n' "$VERSION"

EXISTING=$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'horus\\_%'")
printf '==> 当前库中已有 horus_* 表：%s 张\n' "${EXISTING:-0}"

if [ "$RUN_SCHEMA" -eq 1 ]; then
  if [ "${EXISTING:-0}" != "0" ] && [ "$FORCE" -ne 1 ]; then
    fail "库里已存在 ${EXISTING} 张 horus_* 表。01-schema.sql 是一次性建表脚本，重复执行会因表/索引已存在而报错。
     - 只想补初始负责人/通知设置：加 --only-owner
     - 确认缺表需要补建：加 --force（遇到已存在的表仍会中断，请先自行比对结构）
     - 常规部署：不必跑本脚本，容器启动会自己同步（HORUS_DB_PUSH=true，默认值）"
  fi
  printf '==> 执行 %s ...\n' "$SCHEMA_SQL"
  mysql_cli < "$SCHEMA_SQL"
fi

if [ "$RUN_OWNER" -eq 1 ]; then
  printf '==> 执行 %s（幂等，可重复执行）...\n' "$OWNER_SQL"
  mysql_cli < "$OWNER_SQL"
fi

printf '==> 校验结果：\n'
TABLES=$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'horus\\_%'")
printf '    horus_* 表数量 = %s（期望 8）\n' "$TABLES"
[ "$TABLES" = "8" ] || fail "表数量不是 8，请确认 01-schema.sql 是否完整执行（含外键与索引语句）"

if [ "$RUN_OWNER" -eq 1 ]; then
  OWNER=$(query "SELECT COUNT(*) FROM horus_members WHERE id = 'owner'")
  SETTINGS=$(query "SELECT COUNT(*) FROM horus_notification_settings WHERE id = 'default'")
  printf '    初始负责人行数 = %s（期望 1；密码由本人首次登录时设置）\n' "$OWNER"
  printf '    通知设置默认行 = %s（期望 1）\n' "$SETTINGS"
  [ "$OWNER" = "1" ] || fail "未找到 id=owner 的负责人行，请检查 02-init-owner.sql 是否执行成功"
  [ "$SETTINGS" = "1" ] || fail "未找到 id=default 的通知设置行，请检查 02-init-owner.sql 是否执行成功"
fi

printf '\n==> 数据库初始化完成。\n'
printf '    接着在应用环境（K8s Secret 里的 .env / docker run -e）加：\n'
printf '      HORUS_DB_PUSH=false      # 容器启动不再执行 drizzle-kit push\n'
if [ "$RUN_OWNER" -eq 1 ]; then
  printf '      HORUS_DB_INIT=false      # 容器启动不再执行负责人初始化\n'
fi
printf '    之后表结构变更需由 DBA 跟进（对比 frontend/src/db/schema.ts 与库内结构），应用侧不会自动改表。\n'
exit 0

#!/bin/sh
# Horus 数据库初始化（幂等，可重复执行）：
#   1) 同步 8 张表结构（drizzle-kit push，与 horus 容器启动时执行的逻辑一致）
#   2) 创建初始负责人 + 通知设置默认行（db:init，已存在则保留、不重置密码）
#   3) 校验 8 张表齐全，并打印负责人账号状态
# 说明：horus 容器每次启动已自动完成 1)+2)，本脚本用于人工重跑/验收核查，
#       或自动同步失败后修复重试。前置：docker compose 服务已启动（先执行 ./scripts/deploy.sh）。
#       若已按部署手册第 5 节「路径 D」设了 HORUS_DB_PUSH=false（表由外部 SQL 维护），
#       本脚本就不再适用——它会强制跑 drizzle-kit push。那种场景用 ./scripts/init-sql.sh。
# 用法： ./scripts/init-db.sh
set -eu

cd "$(dirname "$0")/.."

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || fail "未找到 docker"
docker compose version >/dev/null 2>&1 || fail "未找到 Docker Compose v2"
# horus 容器必须在运行（初始化工具链 /opt/horus-migrate 只存在于该容器内）
STATE=$(docker compose ps --format '{{.State}}' horus 2>/dev/null || true)
[ "$STATE" = "running" ] || fail "horus 容器未运行（当前状态：${STATE:-无}），请先执行 ./scripts/deploy.sh"

echo "==> 同步表结构并初始化负责人（容器内执行，与启动流程一致）..."
docker compose exec -T horus sh -c '
  set -eu
  cd /opt/horus-migrate
  CI=1 ./node_modules/.bin/drizzle-kit push --force --config ./drizzle.config.ts
  node --experimental-strip-types src/db/init-prod.ts
'

echo "==> 校验表与初始数据..."
docker compose exec -T mysql sh -c '
  mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -N -e "
    SELECT CONCAT(\"tables=\", COUNT(*)) FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name LIKE \"horus\_%\";
    SELECT CONCAT(\"owner=\", username, \" password_set=\", (password_hash IS NOT NULL))
      FROM horus_members WHERE id = \"owner\";
    SELECT CONCAT(\"notification_settings=\", COUNT(*)) FROM horus_notification_settings WHERE id = \"default\";
  " "$MYSQL_DATABASE"
' | tee /tmp/horus-init-check.txt

grep -q '^tables=8$' /tmp/horus-init-check.txt || fail "表数量不是 8，请查看上方 drizzle-kit 输出排查"
grep -q '^owner=' /tmp/horus-init-check.txt || fail "未找到初始负责人（id=owner），请查看 db:init 输出排查"
grep -q '^notification_settings=1$' /tmp/horus-init-check.txt || fail "通知设置默认行缺失，请查看 db:init 输出排查"
echo "==> 数据库初始化校验通过：8 张表齐全，负责人与通知设置就绪。首次登录即可设置负责人密码。"

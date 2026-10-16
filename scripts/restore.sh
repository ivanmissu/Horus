#!/bin/sh
# Horus 数据库恢复（危险操作，会覆盖当前业务库）：
#   停应用 -> 用备份文件覆盖恢复 -> 启应用 -> 健康检查
# 用法： ./scripts/restore.sh <备份文件.sql|.sql.gz> --yes
# 恢复前脚本会先对当前库自动做一份 pre-restore 备份，可用于反悔。
# 恢复演练请只在隔离/测试库执行，不要拿生产库练手。
set -eu

cd "$(dirname "$0")/.."

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
FILE=${1:-}
[ -n "$FILE" ] || fail "用法：$0 <备份文件.sql|.sql.gz> --yes"
[ -f "$FILE" ] || fail "备份文件不存在：$FILE"
[ "${2:-}" = "--yes" ] || fail "恢复会覆盖当前数据库。确认无误后加 --yes 重新执行：$0 $FILE --yes"
command -v docker >/dev/null 2>&1 || fail "未找到 docker"
STATE=$(docker compose ps --format '{{.State}}' mysql 2>/dev/null || true)
[ "$STATE" = "running" ] || fail "mysql 容器未运行，请先执行 ./scripts/deploy.sh"

echo "==> 先备份当前库（留作回退）..."
./scripts/backup.sh "backups/pre-restore-$(date +%Y%m%d-%H%M%S).sql.gz"

echo "==> 停止应用并恢复 $FILE ..."
docker compose stop horus
case "$FILE" in
  *.gz) gzip -dc "$FILE" ;;
  *) cat "$FILE" ;;
esac | docker compose exec -T mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'

echo "==> 启动应用并检查..."
docker compose start horus
PORT=$(grep -E '^HORUS_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true); [ -n "${PORT:-}" ] || PORT=3000
i=0
while [ $i -lt 24 ]; do
  curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break
  i=$((i + 1)); sleep 5
done
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || fail "恢复后健康检查未通过，请查看日志：docker compose logs --tail 80 horus"
echo "==> 恢复成功，健康检查通过。请登录页面抽查团队/需求数据是否符合预期。"

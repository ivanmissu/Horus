#!/bin/sh
# Horus 数据库备份：通过 mysql 容器 mysqldump 导出业务库（不暴露 3306 到宿主机）
# 用法： ./scripts/backup.sh [输出文件]   默认 backups/horus-YYYYmmdd-HHMMSS.sql.gz
# 备份完成后请把文件复制到公司规定的备份位置，不要只留在应用宿主机磁盘上。
set -eu

cd "$(dirname "$0")/.."

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || fail "未找到 docker"
STATE=$(docker compose ps --format '{{.State}}' mysql 2>/dev/null || true)
[ "$STATE" = "running" ] || fail "mysql 容器未运行，请先执行 ./scripts/deploy.sh"

OUT=${1:-"backups/horus-$(date +%Y%m%d-%H%M%S).sql.gz"}
mkdir -p "$(dirname "$OUT")"

echo "==> 备份到 $OUT ..."
# 密码只从容器环境变量读取，不出现在宿主机命令行参数中
docker compose exec -T mysql sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --databases "$MYSQL_DATABASE"' | gzip > "$OUT"

[ -s "$OUT" ] || fail "备份文件为空，备份失败（请查看 mysql 容器日志：docker compose logs --tail 50 mysql）"
# 快速完整性检查：gzip 可解压且含建表语句
gzip -dc "$OUT" | grep -q 'CREATE TABLE' || fail "备份内容异常（未找到 CREATE TABLE），请勿使用该文件"
echo "==> 备份成功：$OUT ($(du -h "$OUT" | cut -f1))。请复制到备份位置留存。"

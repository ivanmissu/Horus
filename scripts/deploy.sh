#!/bin/sh
# Horus 一键部署：环境检查 -> docker compose up -d --build -> 健康检查
# 用法（在任意目录执行均可，脚本自动定位仓库根目录）：
#   ./scripts/deploy.sh              首次部署或升级（重新构建镜像）
#   ./scripts/deploy.sh --no-build   不重新构建，仅启动/更新容器
# 前置：已按部署手册准备好仓库根目录的 .env（不存在时本脚本会从模板生成并退出提示修改）
set -eu

cd "$(dirname "$0")/.."
ROOT=$(pwd)
BUILD=1
[ "${1:-}" = "--no-build" ] && BUILD=0

say() { printf '%s\n' "==> $*"; }
fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }

# ---------- 1. 运行时检查 ----------
command -v curl >/dev/null 2>&1 || fail "未找到 curl（健康检查需要），请先安装：apt-get install -y curl 或 dnf install -y curl"
command -v docker >/dev/null 2>&1 || fail "未找到 docker，请先按部署手册第 1 节安装 Docker Engine 24+"
docker compose version >/dev/null 2>&1 || fail "未找到 Docker Compose v2（docker compose 子命令不可用）"
docker info >/dev/null 2>&1 || fail "Docker 守护进程未运行，或当前用户无权访问（可尝试 sudo 或将用户加入 docker 组后重新登录）"

# ---------- 2. .env 检查 ----------
if [ ! -f .env ]; then
  cp .env.example .env
  echo "已从 .env.example 生成 .env，请先编辑它再重新执行本脚本，至少修改："
  echo "  1) MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD（生成命令见下方）"
  echo "  2) APP_URL（改为内网同事能访问的地址，如 http://192.168.x.x:3000 或正式域名）"
  echo "  3) HORUS_INIT_OWNER_USERNAME / HORUS_INIT_OWNER_NAME（如需改默认负责人账号）"
  echo "生成随机密码示例： openssl rand -hex 18"
  exit 2
fi

# 读取 .env 中的关键项（不 source 执行，避免密码含特殊字符时被 shell 解释）
env_val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }
ROOT_PW=$(env_val MYSQL_ROOT_PASSWORD || true)
APP_PW=$(env_val MYSQL_PASSWORD || true)
DEMO=$(env_val HORUS_DEMO_MODE || true)
PORT=$(env_val HORUS_PORT || true); [ -n "$PORT" ] || PORT=3000
APP_URL=$(env_val APP_URL || true)

case "$ROOT_PW" in *change_me*|"") fail "MYSQL_ROOT_PASSWORD 仍为模板默认值或为空，请在 .env 中修改后再部署" ;; esac
case "$APP_PW" in *change_me*|"") fail "MYSQL_PASSWORD 仍为模板默认值或为空，请在 .env 中修改后再部署" ;; esac
# 密码会拼进 DATABASE_URL 与健康检查，只允许字母数字下划线，避免 URL 被截断
case "$ROOT_PW$APP_PW" in *[!A-Za-z0-9_]*) fail "数据库密码只能使用字母、数字、下划线（避免 @ : / # ? 等字符导致连接串解析错误）" ;; esac
if [ "$DEMO" = "true" ] && [ "${ALLOW_DEMO:-}" != "1" ]; then
  fail "HORUS_DEMO_MODE=true 会灌入演示数据并允许免登录，生产禁止。如确为受控演示：ALLOW_DEMO=1 $0"
fi
say ".env 检查通过（APP_URL=${APP_URL:-未设置}，宿主机端口=${PORT}）"

# ---------- 3. 配置校验与启动 ----------
docker compose config -q || fail "docker-compose.yml 配置校验失败，请查看上方报错"
if [ "$BUILD" = "1" ]; then
  say "构建并启动（首次构建需拉取 node/mysql 镜像与 npm 依赖，请耐心等待）..."
  docker compose up -d --build
else
  say "启动容器（不重新构建）..."
  docker compose up -d
fi

# ---------- 4. 健康检查 ----------
say "等待应用健康检查（最长 180 秒，容器启动时会自动建表并初始化负责人）..."
HEALTHY=0
i=0
while [ $i -lt 36 ]; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then HEALTHY=1; break; fi
  i=$((i + 1)); sleep 5
done
docker compose ps
if [ "$HEALTHY" != "1" ]; then
  echo "健康检查未通过，最近日志如下：" >&2
  docker compose logs --tail 80 horus >&2 || true
  fail "部署未成功，请按部署手册第 11 节排查，不要初始化业务数据"
fi

say "部署成功：$(curl -fsS "http://127.0.0.1:${PORT}/api/health")"
echo ""
echo "下一步："
echo "  1) 浏览器打开 ${APP_URL:-http://服务器IP:${PORT}} ，用负责人账号（默认 admin）首次登录并设置 8-72 位密码"
echo "  2) 按手册第 7 节创建真实团队/PM，第 8 节联调钉钉机器人"
echo "  3) 查看日志：docker compose logs -f horus    备份：./scripts/backup.sh"
echo "仓库目录：$ROOT"

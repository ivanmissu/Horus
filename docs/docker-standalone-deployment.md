# Horus · 纯 Docker 部署（不用 Docker Compose）

- 关联文档：[环境变量参考](./environment-variables.md) · [Compose 部署手册](./deployment-guide.md) · [Kubernetes 部署](./kubernetes-deployment.md)
- 已有 MySQL 实例、服务器没装 Compose v2，或希望手工掌控容器时，可以完全不用 `docker-compose.yml`，只用 `docker` 原生命令部署。镜像构建、启动初始化（等库 → 同步 8 张表 → 创建初始负责人）与 Compose 方式完全一致，差别只在编排、健康检查和运维命令要手写。

> 若由 DBA 提前用 SQL 建好表，可在下面第 4 步的 `docker run` 里加 `-e HORUS_DB_PUSH=false`（已跑 `02-init-owner.sql` 时再加 `-e HORUS_DB_INIT=false`），容器启动就不再跑 Drizzle。详见 [Kubernetes 部署说明](kubernetes-deployment.md) 第 4 节与 [`scripts/init-sql.sh`](../scripts/init-sql.sh)。

> **注意**：`scripts/deploy.sh`、`init-db.sh`、`backup.sh`、`restore.sh` 都基于 `docker compose`，本方式不适用，请直接使用下面给出的 `docker` 命令。以下命令均在仓库根目录执行。

## 目录

- [1. 构建镜像](#1-构建镜像)
- [2. 创建网络与数据卷](#2-创建网络与数据卷)
- [3. 启动 MySQL 容器](#3-启动-mysql-容器)
- [4. 启动 Horus 容器](#4-启动-horus-容器)
- [5. 验证与首次登录](#5-验证与首次登录)
- [6. 日常运维（纯 Docker 命令）](#6-日常运维纯-docker-命令)
- [7. 注意事项](#7-注意事项)

## 1. 构建镜像

```bash
docker build -t horus:local ./frontend
```

「本周新建」使用自然周（周一 00:00 Asia/Shanghai），无需构建参数或窗口天数配置。

## 2. 创建网络与数据卷

```bash
docker network create horus-net 2>/dev/null || true
docker volume create horus-mysql
```

应用与数据库通过自建网络 `horus-net` 互通，数据库端口**不要**映射到宿主机。`horus-mysql` 数据卷持久化 MySQL 数据，日常停服不要删除它。

## 3. 启动 MySQL 容器

密码只用字母、数字、下划线，避免拼进 `DATABASE_URL` 时被截断；下面的密码占位符请全部替换为同一套真实值。

```bash
docker run -d \
  --name horus-mysql \
  --network horus-net \
  --network-alias mysql \
  --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD='<root密码>' \
  -e MYSQL_DATABASE=horus \
  -e MYSQL_USER=horus \
  -e MYSQL_PASSWORD='<应用密码>' \
  -e TZ=Asia/Shanghai \
  -v horus-mysql:/var/lib/mysql \
  --log-opt max-size=10m --log-opt max-file=3 \
  --health-cmd='mysqladmin ping -h 127.0.0.1 -u$MYSQL_USER -p$MYSQL_PASSWORD --silent' \
  --health-interval=5s --health-timeout=5s --health-retries=30 --health-start-period=20s \
  mysql:8.0 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_0900_ai_ci \
  --default-time-zone=+08:00
```

`--network-alias mysql` 让容器在 `horus-net` 内的主机名固定为 `mysql`，与 Compose 及文档中的连接串保持一致。若使用**已有 MySQL**，跳过本步，改为在目标库上建好库与账号（字符集 `utf8mb4`，账号对业务库有全权），第 4 步的 `DATABASE_URL` 指向该实例即可，应用启动时会自动建表。

## 4. 启动 Horus 容器

```bash
docker run -d \
  --name horus-app \
  --network horus-net \
  --restart unless-stopped \
  -p 3000:3000 \
  -e DATABASE_URL='mysql://horus:<应用密码>@mysql:3306/horus' \
  -e HORUS_DEMO_MODE=false \
  -e HORUS_INIT_OWNER_USERNAME=admin \
  -e HORUS_INIT_OWNER_NAME='空间管理员' \
  -e APP_URL='http://<服务器IP>:3000' \
  -e HORUS_DB_CONNECTION_LIMIT=10 \
  -e TZ=Asia/Shanghai \
  --log-opt max-size=10m --log-opt max-file=3 \
  --health-cmd="node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"" \
  --health-interval=10s --health-timeout=5s --health-retries=18 --health-start-period=60s \
  horus:local
```

- `-p <宿主机端口>:3000`：宿主机端口被占用时改冒号前一侧，容器内端口固定 `3000`。
- `DATABASE_URL` 的主机名必须是 `mysql`（或外部 MySQL 的实际可达地址），不能写 `127.0.0.1`——容器里的 `127.0.0.1` 指应用容器自身。
- `HORUS_DEMO_MODE` 生产必须为 `false`；`APP_URL` 填同事实际打开的地址，不能写 `localhost`。
- `--restart unless-stopped` 会在容器异常退出或宿主机重启后自动拉起；启动脚本会等 MySQL 就绪（最长 90 秒）后同步表结构并幂等创建初始负责人。

**本路线环境变量一览**（完整说明与跨路线矩阵见[环境变量参考](./environment-variables.md)；MySQL 容器的 `MYSQL_*` 变量见第 3 步命令，属于 MySQL 镜像而非 Horus 应用）：

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | `mysql://horus:<密码>@mysql:3306/horus`；密码特殊字符需百分号编码 |
| `HORUS_DEMO_MODE` | ✅ 生产固定 | `false` | 生产红线，禁止 `true` |
| `HORUS_INIT_OWNER_USERNAME` / `HORUS_INIT_OWNER_NAME` | 可选 | `admin` / `空间管理员` | 仅首次建负责人有效 |
| `APP_URL` | ✅ | — | 同事实际打开的地址，钉钉链接兜底 |
| `HORUS_DB_CONNECTION_LIMIT` | 可选 | `10` | 连接池上限 |
| `HORUS_DB_PUSH` / `HORUS_DB_INIT` | 可选 | `true` | 表已由外部 SQL 建好时设 `false`（缺表仍拒绝启动）；仅容器入口读取 |
| `HORUS_DB_WAIT_TIMEOUT` / `HORUS_DB_STEP_TIMEOUT` | 可选 | `90` / `180` | 等库秒数上限 / 单步墙钟上限 |
| `TZ` | 可选 | `Asia/Shanghai` | 容器日志时区 |

## 4.1 已有 MySQL 升级到「需求统计」

```bash
docker exec -i horus-mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < deploy/mysql/04-stats-upgrade.sql
docker exec horus-app node --experimental-strip-types /opt/horus-migrate/src/db/backfill-events-cli.ts
```

回填在 `horus-app` 容器内执行，直接使用容器已有的 `DATABASE_URL`；首次打开「需求统计」也会自动回填，重复执行不会产生重复事件。

新库直接执行 `01-schema.sql` 即可，不要执行升级脚本。升级后容器日志应出现 `MySQL schema ready (8 tables)`；历史上线/取消与卡点数据为近似回填，统计页会标注估算。

## 5. 验证与首次登录

```bash
docker ps --filter name=horus
docker inspect --format '{{.Name}} {{.State.Health.Status}}' horus-mysql horus-app
curl -fsS http://127.0.0.1:3000/api/health   # {"ok":true}
docker logs -f horus-app                     # 看启动过程，Ctrl+C 退出不影响容器
```

两个容器都应显示 `healthy`（应用首次启动需要建表，可能等待 1 分钟左右）。浏览器打开 `APP_URL`，用负责人账号（默认 `admin`）首次登录并设置 8–72 位密码。对外提供 HTTPS 时，在现有 Nginx/网关上终结 TLS 并补齐 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 转发头，同时把 `APP_URL` 改为正式域名。

## 6. 日常运维（纯 Docker 命令）

```bash
docker logs -f horus-app                       # 应用日志
docker logs --tail 100 horus-mysql             # 数据库日志
docker restart horus-app                       # 重启应用（重跑建表同步 + db:init，幂等）
docker stop horus-app horus-mysql              # 停服（保留容器与数据卷）
docker start horus-mysql horus-app             # 启服（先库后应用）
```

备份与恢复（脚本不适用，手工执行）：

```bash
mkdir -p backups

# 备份：密码从容器环境读取，不出现在宿主机命令行里
BACKUP="backups/horus-$(date +%Y%m%d-%H%M%S).sql.gz"
docker exec horus-mysql sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --databases "$MYSQL_DATABASE"' \
  | gzip > "$BACKUP"
gzip -dc "$BACKUP" | grep -q 'CREATE TABLE'   # 快速校验备份可用

# 恢复（危险，会覆盖当前库；先自行留底。下面换成实际的备份文件路径）
BACKUP=backups/horus-20261019-090000.sql.gz
docker stop horus-app
gzip -dc "$BACKUP" \
  | docker exec -i horus-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
docker start horus-app
curl -fsS http://127.0.0.1:3000/api/health
```

备份文件必须再拷贝到公司规定的备份位置，只留在应用宿主机不算完成备份。

升级与回滚：

```bash
# 1) 先备份（同上）
# 2) 拉取新代码或解压新版本包，重建镜像
docker build -t horus:local ./frontend
# 3) 用新镜像重建应用容器（MySQL 容器与数据卷不动）
docker rm -f horus-app
# 4) 重新执行第 4 步的 docker run 命令（环境变量保持不变）
```

回滚时切回上一版代码重建镜像并重新 `docker run`；若本次升级伴随表结构变更，需连同升级前备份一起恢复，不要只回滚应用镜像。

完全离线时，在有网且架构一致的机器上 `docker save horus:local mysql:8.0 | gzip > horus-images.tar.gz`，拷到内网服务器后 `docker load < horus-images.tar.gz` 再按上述步骤启动。

## 7. 注意事项

- **不要扩容** `horus-app`：定时摘要调度假设单实例 + 数据库抢占，多副本会导致行为异常。
- **不要删数据卷**：`docker rm -f horus-app` 是安全的，但 `docker volume rm horus-mysql` 会清空全部业务数据。
- 不要给 `horus-mysql` 加 `-p 3306:3306`，数据库只在 `horus-net` 内可达。
- 修改任何 `-e` 环境变量后，必须 `docker rm -f horus-app` 再按第 4 步重新 `docker run`，`docker restart` 不会更新容器配置。
- 同一台机器上不要与 Compose 方式混用：两种方式的容器名都是 `horus-app` / `horus-mysql`，会互相冲突，选一种方式即可。


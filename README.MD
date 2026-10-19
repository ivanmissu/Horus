# Horus · 研发进程，尽在掌握

Horus 是面向**小型研发团队**的轻量化需求看盘与里程碑跟踪工具。它不追求大而全的项目管理，而是把注意力集中在三件事上：

- **本周新建**：近 7 天（可配置 1–90 天）内新建的需求
- **卡点**：被阻塞、等待外部响应的需求
- **高优逾期**：高优先级且已过期未完成的需求

三者取并集后按团队分组折叠展示，让负责人和 PM 一眼看清「现在最该盯什么」。支持需求全生命周期推进、阶段模板自定义、成员与团队管理、钉钉每日异常摘要推送，以及移动端只读查看。

> 技术栈：Next.js App Router · React 19 · Drizzle ORM · MySQL 8.0 · Docker 单实例。生产默认强制登录，不灌演示数据。

## 功能概览

- **聚焦工作台**：统计卡片 + 多维筛选 + 按团队分组的焦点需求列表
- **团队详情**：阶段分布图（点击可筛选）、在途列表排序、归档历史查询
- **需求生命周期**：新建 / 编辑 / 向前跳阶段（禁止回退）/ 卡点标记与解除 / 末阶段自动归档 / 取消归档 / 操作留痕
- **阶段模板**：团队独立配置阶段；删除仍有需求的阶段时必须指定迁移目标
- **成员与团队**：负责人预建账号、角色分配、PM 多团队绑定、停用成员、重置 PM 密码、编辑团队信息
- **通知设置**：钉钉 Webhook + 可选加签、北京时间每日定时发送、实时预览与发送日志
- **移动端**：首页与团队详情只读，390px 视口无横向滚动

## 界面截图

### 工作台（聚焦视图）

![Horus 工作台](docs/screenshots/dashboard.png)

### 团队详情（阶段分布 + 在途需求）

![Horus 团队详情](docs/screenshots/team-detail.png)

## Quick Start（本地开发）

要求：Node.js 22+、MySQL 8.0+。

```bash
# 1. 安装依赖
cd frontend
npm install

# 2. 准备数据库（MySQL 8.0）
#    创建数据库 horus 与用户 horus，然后设置连接地址
export DATABASE_URL='mysql://horus:change-me@127.0.0.1:3306/horus'

# 3. 同步表结构 + 初始化负责人（默认账号 admin，首次登录设密）
npm run db:push
npm run db:init

# 4. 启动开发服务器
npm run dev
# 访问 http://localhost:3000
```

可选环境变量（详见 `frontend/README.md`）：

- `HORUS_DEMO_MODE=true`：仅用于本地/受控演示，自动灌入演示团队与需求并允许免登录；**生产禁止开启**
- `HORUS_INIT_OWNER_USERNAME` / `HORUS_INIT_OWNER_NAME`：初始负责人账号 / 姓名（默认 `admin` / `团队负责人`）
- `HORUS_NEW_WINDOW_DAYS` 与 `NEXT_PUBLIC_NEW_WINDOW_DAYS`：「本周新建」窗口天数（默认 7，范围 1–90，两者保持一致）
- `HORUS_DB_CONNECTION_LIMIT`：MySQL 连接池大小（默认 10）
- `APP_URL`：钉钉摘要链接兜底地址

无数据库时仅预览界面布局：

```bash
HORUS_PREVIEW_MODE=true npm run dev -- --hostname 0.0.0.0 --port 3000
```

> 这是只读预览，使用内存示例数据，不连接 MySQL，写接口返回 503，不代表生产数据库健康。

验证命令：

```bash
npm run test:domain   # 领域纯函数
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm run build         # 生产构建
```

## 生产环境部署（Kubernetes）

参见 [K8s 部署说明](docs/kubernetes-deployment.md) 与 [`deploy/k8s/horus.yaml`](deploy/k8s/horus.yaml)：单副本、外部 MySQL、Secret 只读挂载 `.env`，以及不访问数据库的 `/api/health` 探针。心跳仅表示进程存活，不代表数据库健康。

## 生产环境部署（Docker Compose · 内网单机）

完整步骤见 [`docs/deployment-guide.md`](docs/deployment-guide.md)。下面是速览。
若服务器的 MySQL 由 DBA 统一提供、或装不了 Compose v2，可改用下面的「纯 Docker 部署」，不需要 `docker-compose.yml`。

### 1. 服务器准备

- Linux x86_64，Docker Engine 24+ 与 Compose v2
- 2 vCPU / 2 GB 内存 / 5 GB 磁盘，宿主机端口 `3000` 空闲且内网可达
- 出站能访问 `https://oapi.dingtalk.com`（钉钉摘要推送）
- **不要**对外暴露 3306

### 2. 获取代码并配置

```bash
git clone <仓库地址> horus && cd horus
cp .env.example .env
# 编辑 .env：改掉 MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD（仅字母数字下划线）、
# APP_URL（同事实际打开的地址）、HORUS_PORT、HORUS_INIT_OWNER_USERNAME / NAME
# 保持 HORUS_DEMO_MODE=false
chmod 600 .env
```

### 3. 一键部署

```bash
chmod +x scripts/*.sh
./scripts/deploy.sh
```

脚本会依次：检查 Docker/Compose → 校验密码与演示模式 → 构建启动 → 轮询健康检查（最长 180 秒）。等价手工命令：

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health   # {"ok":true}
```

容器启动时自动完成：等待 MySQL → `drizzle-kit push` 同步 7 张表并校验齐全 → `db:init` 幂等创建初始负责人与通知设置默认行 → standalone 监听 `0.0.0.0:3000`。

### 4. 负责人首次登录

浏览器打开 `APP_URL`，输入负责人账号（默认 `admin`），系统识别为首次登录，设置 8–72 位密码。密码以 bcrypt 存库，会话仅存 SHA-256 摘要。忘密由负责人在页面「重置密码」，无自助找回。

### 5. 日常运维

```bash
docker compose ps / logs -f horus / restart horus
./scripts/backup.sh                 # 备份到 backups/*.sql.gz
./scripts/restore.sh <file> --yes   # 恢复（危险，先自动留底）
```

正式投产建议在现有网关 / Nginx 上挂 HTTPS 反向代理，并补齐 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 转发头（详见部署手册 9.3）。

### 数据与安全边界

- 单实例部署，**不要扩容** app 副本（调度器假设单进程 + 数据库抢占）
- `HORUS_DEMO_MODE=true` 仅用于演示，生产必须 `false`
- 不要使用 `docker compose down -v` 做日常停服（会删数据卷）
- 备份文件必须再拷贝到公司规定的备份位置，只留在应用宿主机不算完成备份

## 生产环境部署（纯 Docker · 不用 Docker Compose）

已有 MySQL 实例、服务器没装 Compose v2，或希望手工掌控容器时，可以完全不用 `docker-compose.yml`，只用 `docker` 原生命令部署。镜像构建、启动初始化（等库 → 同步 7 张表 → 创建初始负责人）与 Compose 方式完全一致，差别只在编排、健康检查和运维命令要手写。

> **注意**：`scripts/deploy.sh`、`init-db.sh`、`backup.sh`、`restore.sh` 都基于 `docker compose`，本方式不适用，请直接使用下面给出的 `docker` 命令。以下命令均在仓库根目录执行。

### 1. 构建镜像

```bash
docker build \
  --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 \
  -t horus:local ./frontend
```

`NEXT_PUBLIC_NEW_WINDOW_DAYS` 是构建期值，运行时若调整「本周新建」窗口（1–90），需同时改运行时变量与这个构建参数并重建镜像。

### 2. 创建网络与数据卷

```bash
docker network create horus-net 2>/dev/null || true
docker volume create horus-mysql
```

应用与数据库通过自建网络 `horus-net` 互通，数据库端口**不要**映射到宿主机。`horus-mysql` 数据卷持久化 MySQL 数据，日常停服不要删除它。

### 3. 启动 MySQL 容器

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

### 4. 启动 Horus 容器

```bash
docker run -d \
  --name horus-app \
  --network horus-net \
  --restart unless-stopped \
  -p 3000:3000 \
  -e DATABASE_URL='mysql://horus:<应用密码>@mysql:3306/horus' \
  -e HORUS_DEMO_MODE=false \
  -e HORUS_INIT_OWNER_USERNAME=admin \
  -e HORUS_INIT_OWNER_NAME='团队负责人' \
  -e APP_URL='http://<服务器IP>:3000' \
  -e HORUS_NEW_WINDOW_DAYS=7 \
  -e NEXT_PUBLIC_NEW_WINDOW_DAYS=7 \
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

### 5. 验证与首次登录

```bash
docker ps --filter name=horus
docker inspect --format '{{.Name}} {{.State.Health.Status}}' horus-mysql horus-app
curl -fsS http://127.0.0.1:3000/api/health   # {"ok":true}
docker logs -f horus-app                     # 看启动过程，Ctrl+C 退出不影响容器
```

两个容器都应显示 `healthy`（应用首次启动需要建表，可能等待 1 分钟左右）。浏览器打开 `APP_URL`，用负责人账号（默认 `admin`）首次登录并设置 8–72 位密码。对外提供 HTTPS 时，在现有 Nginx/网关上终结 TLS 并补齐 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 转发头，同时把 `APP_URL` 改为正式域名。

### 6. 日常运维（纯 Docker 命令）

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
docker build --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 -t horus:local ./frontend
# 3) 用新镜像重建应用容器（MySQL 容器与数据卷不动）
docker rm -f horus-app
# 4) 重新执行第 4 步的 docker run 命令（环境变量保持不变）
```

回滚时切回上一版代码重建镜像并重新 `docker run`；若本次升级伴随表结构变更，需连同升级前备份一起恢复，不要只回滚应用镜像。

完全离线时，在有网且架构一致的机器上 `docker save horus:local mysql:8.0 | gzip > horus-images.tar.gz`，拷到内网服务器后 `docker load < horus-images.tar.gz` 再按上述步骤启动。

### 7. 注意事项

- **不要扩容** `horus-app`：定时摘要调度假设单实例 + 数据库抢占，多副本会导致行为异常。
- **不要删数据卷**：`docker rm -f horus-app` 是安全的，但 `docker volume rm horus-mysql` 会清空全部业务数据。
- 不要给 `horus-mysql` 加 `-p 3306:3306`，数据库只在 `horus-net` 内可达。
- 修改任何 `-e` 环境变量后，必须 `docker rm -f horus-app` 再按第 4 步重新 `docker run`，`docker restart` 不会更新容器配置。
- 同一台机器上不要与 Compose 方式混用：两种方式的容器名都是 `horus-app` / `horus-mysql`，会互相冲突，选一种方式即可。

## 相关文档

- 需求文档：[`docs/specs/horus-design.md`](docs/specs/horus-design.md)
- 项目计划：[`docs/specs/horus-project-plan.md`](docs/specs/horus-project-plan.md)
- 生产部署手册：[`docs/deployment-guide.md`](docs/deployment-guide.md)
- M5 上线签收清单：[`docs/m5-uat-checklist.md`](docs/m5-uat-checklist.md)
- 前端说明：[`frontend/README.md`](frontend/README.md)

## License

本项目基于仓库根目录 [`LICENSE`](LICENSE) 发布。

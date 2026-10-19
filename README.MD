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

本节按「已有 Kubernetes 集群 + 外部 MySQL 8.0」说明从构建镜像到首次访问的完整流程。示例清单为 [`deploy/k8s/horus.yaml`](deploy/k8s/horus.yaml)：只创建 Horus Deployment 和集群内的 ClusterIP Service，**不会**创建 MySQL、Ingress/TLS 或数据库备份。

### 部署前准备

- 可用的 Kubernetes 集群及 `kubectl`，当前 context 有权限创建 namespace、Secret、Deployment 和 Service。
- 可供集群节点拉取的容器镜像仓库（私有仓库需额外配置拉取凭证）。
- 集群 Pod 网络可以访问 MySQL 8.0 的地址和端口（通常为 TCP 3306）。
- **应用必须保持 1 个副本**：清单使用 `Recreate` 更新策略；不要扩容或配置 HPA。定时摘要调度和启动时的数据库结构同步都假设单实例，升级时会有短暂服务中断。

先确认命令操作的是目标集群：

```bash
kubectl config current-context
kubectl get nodes
```

### 1. 准备外部 MySQL

由 DBA 提前创建 Horus 专用数据库和账号，使用 `utf8mb4`，并授予该库所需的建表、改表及业务读写权限。MySQL 防火墙/白名单需允许集群 Pod 的实际出口地址访问；不要把数据库端口公开到互联网。以下 SQL 仅为示例，来源地址和密码应按所在环境替换，并遵循 DBA 的账号策略：

```sql
CREATE DATABASE horus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'horus'@'<允许访问的来源>' IDENTIFIED BY '<强密码>';
GRANT ALL PRIVILEGES ON horus.* TO 'horus'@'<允许访问的来源>';
```

Horus 容器启动时会等待 MySQL 可用（最多 90 秒），随后自动同步 7 张业务表并幂等创建初始负责人和通知设置；常规部署不需要手工执行 `deploy/mysql/` 下的 SQL。`DATABASE_URL` 中的主机名必须是 **Pod 可达的 MySQL 地址**，不能填写 `localhost` 或 `127.0.0.1`。如果用户名或密码包含 URL 特殊字符，先做百分号编码（例如 `@` 写成 `%40`）。

### 2. 构建并推送 Horus 镜像

在仓库根目录执行。把示例仓库地址、组织名和 tag 替换成实际值；每个版本使用不同的 tag，避免复用 `latest`：

```bash
export REGISTRY=registry.example.com
export IMAGE="$REGISTRY/your-team/horus:20261019-1"

docker login "$REGISTRY"
docker build \
  --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 \
  -t "$IMAGE" \
  ./frontend
docker push "$IMAGE"
```

构建上下文是 `./frontend`。Kubernetes 节点必须能够拉取推送后的镜像；若本机与集群节点 CPU 架构不同，可用 Buildx 指定节点架构（以下以 amd64 为例），以此命令替代上面的 `docker build` 和 `docker push`：

```bash
docker buildx build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 \
  -t "$IMAGE" --push ./frontend
```

私有仓库还需在 `horus` namespace 配置 image pull Secret，并在清单的 Pod spec 中添加 `imagePullSecrets`。

`NEXT_PUBLIC_NEW_WINDOW_DAYS` 是写入前端 bundle 的**构建期**值。调整它时需重新构建镜像；请与 `.env` 中的 `HORUS_NEW_WINDOW_DAYS` 保持一致（默认均为 `7`，允许范围 `1–90`）。

### 3. 准备运行时 `.env` 并创建 Kubernetes Secret

在安全位置建立配置文件，权限只授予部署人员：

```bash
umask 077
mkdir -p /secure/horus
vi /secure/horus/.env
chmod 600 /secure/horus/.env
```

文件内容示例（将数据库主机、密码和正式访问域名替换为实际值）：

```dotenv
DATABASE_URL=mysql://horus:URL_ENCODED_PASSWORD@mysql.example.internal:3306/horus
HORUS_DEMO_MODE=false
HORUS_INIT_OWNER_USERNAME=admin
HORUS_INIT_OWNER_NAME="团队负责人"
APP_URL=https://horus.example.com
HORUS_NEW_WINDOW_DAYS=7
HORUS_DB_CONNECTION_LIMIT=10
```

`APP_URL` 应是用户实际访问的正式地址，用于钉钉摘要链接。生产环境必须保持 `HORUS_DEMO_MODE=false`；不要配置 `HORUS_PREVIEW_MODE=true`。这里不需要 Compose 专用的 `MYSQL_*`、`HORUS_PORT`，也不要把 `NEXT_PUBLIC_NEW_WINDOW_DAYS` 当作运行时配置。不要将真实 `.env` 或 Secret 内容提交到 Git。

创建 namespace 和 Secret（Secret 的键名必须是 `.env`）：

```bash
kubectl create namespace horus --dry-run=client -o yaml | kubectl apply -f -
kubectl -n horus create secret generic horus-env \
  --from-file=.env=/secure/horus/.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 4. 配置清单并部署

编辑 [`deploy/k8s/horus.yaml`](deploy/k8s/horus.yaml)，把容器的 `image: horus:local` 改成第 2 步推送的完整镜像地址，例如：

```yaml
image: registry.example.com/your-team/horus:20261019-1
```

然后应用清单并等待 rollout 完成：

```bash
kubectl -n horus apply -f deploy/k8s/horus.yaml
kubectl -n horus rollout status deployment/horus --timeout=360s
kubectl -n horus get deployment,pod,service -o wide
kubectl -n horus logs deployment/horus --tail=200
```

清单中的配置挂载关系如下，部署前请保持 Secret 名称、键名和挂载路径一致：

- `horus-env` Secret 的 `.env` 键挂载为 `/etc/horus/.env`，卷只读，权限为 `0440`。
- Pod 设置 `HORUS_ENV_FILE=/etc/horus/.env`。容器入口用 dotenv 读取文件，然后依次等待 MySQL、同步表结构、初始化负责人，最后启动 Next.js。
- 应用以非 root 用户运行；清单通过 `fsGroup` 使进程可以读取 Secret。显式写在 Pod 环境变量中的值优先于 `.env` 文件。
- 业务数据存放在外部 MySQL，不存于 Pod；Secret 挂载也不是数据持久化卷。

Secret 默认只是 Base64 编码，并不等于加密。生产集群应启用 Secret 静态加密并限制 namespace/RBAC 读取权限；不要把包含真实密码的 YAML 文件保存到仓库。

### 5. 验证、首次登录和对外访问

查看启动日志中是否出现 MySQL 就绪、7 张表同步完成和应用启动信息。也可以临时端口转发验证：

```bash
# 此命令保持运行；另开一个终端执行 curl
kubectl -n horus port-forward service/horus 3000:3000
```

```bash
curl -fsS http://127.0.0.1:3000/api/health   # 预期：{"ok":true}
```

`/api/health` 是不访问数据库的进程心跳。startup、liveness、readiness 探针都使用它；HTTP 200 **不代表 MySQL 或业务功能正常**，还应使用浏览器打开正式地址并实际登录、检查业务页面。首次登录使用初始负责人账号（默认 `admin`），首次登录时设置 8–72 位密码。

清单里的 Service 默认是集群内可访问的 ClusterIP，不会自动提供公网入口。需要外部访问时，由现有 Ingress、网关或反向代理转发到 `horus:3000` 并配置 HTTPS；确保转发 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`，且 `.env` 的 `APP_URL` 与正式域名一致。

### 6. 更新配置、升级和日常检查

修改服务端配置时，先编辑安全位置的 `.env`，再更新 Secret 并重启 Deployment。进程只在启动时读取配置，不支持热更新：

```bash
kubectl -n horus create secret generic horus-env \
  --from-file=.env=/secure/horus/.env \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n horus rollout restart deployment/horus
kubectl -n horus rollout status deployment/horus --timeout=360s
```

更新镜像时，按第 2 步构建并推送一个新 tag，把清单中的 `image` 改成新地址，再执行 `kubectl apply` 和 `rollout status`；镜像变化会触发替换 Pod，不需要再单独 `rollout restart`。升级前先备份外部 MySQL，尤其是包含表结构变更的版本；应用启动会再次同步表结构。**不要扩容** Horus，也不要把数据库备份留在 Pod 临时文件系统中。

常用排查命令：

```bash
kubectl -n horus get pods -o wide
kubectl -n horus describe pod <horus-pod-name>
kubectl -n horus logs deployment/horus --tail=200
kubectl -n horus get events --sort-by=.metadata.creationTimestamp
```

- `ImagePullBackOff`：核对镜像 tag、仓库权限和 `imagePullSecrets`，并确认镜像架构与节点一致。
- `CrashLoopBackOff` 或卡在启动：检查日志、Secret 名称/`.env` 键名/数据库 URL，以及 Pod 到 MySQL 的 DNS、网络、防火墙和账号权限；应用等待 MySQL 的时间上限为 90 秒。
- Secret 已更新但配置没变：确认 Secret 已应用，并执行 `rollout restart`；单纯更新挂载文件不会让运行中的进程重新读取配置。
- 探针通过但业务访问失败：探针只测 HTTP 进程，继续查看应用日志并核验数据库连接，不能只以 `/api/health` 判断服务可用。

更多配置优先级、探针与更新细节见 [Kubernetes 部署说明](docs/kubernetes-deployment.md)；数据库升级与回滚注意事项见[生产部署手册](docs/deployment-guide.md)。

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

# Horus · Kubernetes 部署（外部 MySQL，最短路径）

目标：一个 namespace、一个 Secret（装 `.env`）、一个 Deployment + Service。**表结构先用仓库里的 SQL 在外部 MySQL 建好**，容器启动不再跑 Drizzle，也就不会卡在 `Pulling schema from database...`。

前提：可用的集群（`kubectl` 有建 namespace/Secret/Deployment/Service 的权限）、集群外一台能连上该 MySQL 的机器（带 `mysql` 客户端，用来跑初始化脚本）、一个集群能拉到的镜像仓库。

> 只有 1 个副本：清单写死 `replicas: 1` + `Recreate`，**不要扩容、不要挂 HPA**（定时摘要调度假设单进程）。升级时会秒级到一分钟的中断，这是预期。
> 想改配置而不重建镜像：清单把 Secret 里的 `.env` 挂到 `/etc/horus/.env`，容器入口先读它再启动；进程只在启动时读配置，改完必须重启 Pod。

## 1. 初始化外部 MySQL（一次性）

先由 DBA/root 建库和账号（`utf8mb4`，白名单放行集群 Pod 出口地址，不要公开 3306）：

```sql
CREATE DATABASE horus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'horus'@'<允许访问的来源>' IDENTIFIED BY '<强密码>';
-- 表结构手工维护时，应用账号只给读写权限即可（不给 DDL）
GRANT SELECT, INSERT, UPDATE, DELETE ON horus.* TO 'horus'@'<允许访问的来源>';
```

再在能连库的那台机器上、仓库根目录执行（它依次跑 `deploy/mysql/01-schema.sql` 建 7 张表、`02-init-owner.sql` 建初始负责人与通知设置默认行，最后校验）：

```bash
DATABASE_URL='mysql://horus:<URL编码后的密码>@mysql.internal:3306/horus' ./scripts/init-sql.sh
```

密码含 `@ : / #` 等字符时先做百分号编码（`@` → `%40`）。脚本对已有 `horus_*` 表的库会直接拒绝，避免重复建表；确认无误可加 `--force`。

首次登录用 `admin` 账号设密码（账号/姓名可用 `02-init-owner.sql` 头部的 `@owner_username` / `@owner_name` 改，也可以继续让容器建，见第 3 节）。

## 2. 构建并推送镜像

```bash
export IMAGE=registry.example.com/your-team/horus:$(date +%Y%m%d)-1
docker buildx build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 \
  -t "$IMAGE" --push ./frontend
```

构建上下文是 `./frontend`；`NEXT_PUBLIC_NEW_WINDOW_DAYS` 是写进前端 bundle 的**构建期**值（默认 7，范围 1–90），改它必须重建镜像；每个版本用不同 tag，别复用 `latest`。私有仓库在 `horus` namespace 配 imagePullSecrets 并在清单里加 `imagePullSecrets`。

## 3. 写 `.env` 并建 Secret

```bash
umask 077 && mkdir -p /secure/horus
cat > /secure/horus/.env <<'EOF'
DATABASE_URL=mysql://horus:URL_ENCODED_PASSWORD@mysql.example.internal:3306/horus
HORUS_DB_PUSH=false
HORUS_DB_INIT=false
HORUS_DEMO_MODE=false
APP_URL=https://horus.example.com
HORUS_NEW_WINDOW_DAYS=7
HORUS_DB_CONNECTION_LIMIT=10
EOF
```

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 必填。主机必须是 **Pod 可达地址**，不能写 `localhost`/`127.0.0.1`（那是容器自己） |
| `HORUS_DB_PUSH=false` | 跳过容器内的 `drizzle-kit push`，只校验 7 张表是否齐全。**前提是第 1 步已建表** |
| `HORUS_DB_INIT=false` | 跳过容器内的负责人/通知设置初始化。**前提是第 1 步已跑 `02-init-owner.sql`**；想少一步手工就删掉这行，容器会幂等补上 |
| `HORUS_DEMO_MODE` | 生产必须 `false`；不要设 `HORUS_PREVIEW_MODE` |
| `APP_URL` | 用户实际访问的地址，用于钉钉摘要链接，需与正式域名一致 |
| `HORUS_NEW_WINDOW_DAYS` | 「本周新建」窗口，运行时读，改后重启即生效 |
| `HORUS_DB_CONNECTION_LIMIT` | 连接池大小，默认 10 |

不需要 Compose 专用的 `MYSQL_*` / `HORUS_PORT`。真实 `.env` 不要提交 Git；Secret 只是 Base64 编码，生产集群请开静态加密并收紧 RBAC。

```bash
kubectl create namespace horus --dry-run=client -o yaml | kubectl apply -f -
kubectl -n horus create secret generic horus-env \
  --from-file=.env=/secure/horus/.env --dry-run=client -o yaml | kubectl apply -f -
```

## 4. 部署

把 [`deploy/k8s/horus.yaml`](../deploy/k8s/horus.yaml) 里的 `image: horus:local` 改成第 2 步的地址，然后：

```bash
kubectl -n horus apply -f deploy/k8s/horus.yaml
kubectl -n horus rollout status deployment/horus --timeout=180s
kubectl -n horus logs deployment/horus --tail=100
```

跳过了 Drizzle，启动应该只有几秒，日志形如：

```text
Database bootstrap: push=false init=false wait_timeout=90s step_timeout=180s
Waiting for MySQL...
MySQL is ready
Skipping schema synchronization (HORUS_DB_PUSH=false); verifying tables only...
MySQL schema ready (7 tables)
Skipping owner initialization (HORUS_DB_INIT=false).
Starting Horus...
```

## 5. 验证与对外访问

```bash
kubectl -n horus port-forward service/horus 3000:3000   # 保持运行，另开终端
curl -fsS http://127.0.0.1:3000/api/health               # {"ok":true}
```

`/api/health` 是不碰数据库的进程心跳，200 **不代表 MySQL 和业务正常**：还要用浏览器打开正式地址、登录、看业务页面。清单里的 Service 是 ClusterIP，对外访问由现有 Ingress/网关转发到 `horus:3000` 并配 HTTPS，转发 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`。

## 6. 卡住时对照这张表

| 现象 | 先查什么 |
| --- | --- |
| 停在 `Waiting for MySQL...` 后报 `did not become ready within 90s` | Pod 到 MySQL 的 DNS/网络/白名单、账号密码。用一次性客户端验证：`kubectl -n horus run mysqlcli --rm -it --restart=Never --image=mysql:8.0 -- mysql -h <mysql-host> -u horus -p horus -e 'SELECT 1'` |
| 停在 `Pulling schema from database...` 不动 | 这是 `drizzle-kit push` 在连库做内省，本身没有超时：网络半通（SYN 被丢包）、目标实例 `information_schema` 极慢、或表上有元数据锁。按第 1+3 节改成 `HORUS_DB_PUSH=false` 绕过；想保留自动同步就调 `HORUS_DB_STEP_TIMEOUT`，超时会主动失败而不是吊死 |
| `Schema sync did not create: <表名>` | 表没建全：回第 1 步重跑 `./scripts/init-sql.sh`（必要时 `--force`），或临时 `HORUS_DB_PUSH=true` 让容器建 |
| 日志第 1 行 `push=true` 而你写了 `false` | Secret 没更新成功，或变量名/键名写错（键必须是 `.env`），或 Deployment 的 `env` 覆盖了文件值 |
| `ImagePullBackOff` | 镜像 tag、仓库凭证、`imagePullSecrets`、镜像架构与节点是否一致 |
| `CrashLoopBackOff` + `DATABASE_URL is required` | `HORUS_ENV_FILE` 与挂载路径不一致，或 Secret 里没有 `.env` 键 |
| 探针通过但页面报错 | 探针只测 HTTP 进程：看应用日志、确认数据库连接与建表结果 |

## 7. 改配置与升级

```bash
# 改配置：编辑 /secure/horus/.env 后重写 Secret 并重启
kubectl -n horus create secret generic horus-env \
  --from-file=.env=/secure/horus/.env --dry-run=client -o yaml | kubectl apply -f -
kubectl -n horus rollout restart deployment/horus
kubectl -n horus rollout status deployment/horus --timeout=180s
```

换版本：构建推送新 tag → 改清单 `image` → `kubectl apply`（镜像变化自带替换，不必再 `rollout restart`）。

**表结构变更从此是人工环节**：`HORUS_DB_PUSH=false` 之后应用不会再自动改表。发新版前确认该版本 `frontend/src/db/schema.ts` 有无变化；有变化就先备份、由 DBA 执行对应 DDL。想偷懒就在能连上该 MySQL 的机器上跑一次 `cd frontend && DATABASE_URL=... npm run db:push`（幂等，无变更时是空操作，`--verbose` 可见将执行的语句），或临时把 `HORUS_DB_PUSH` 设回 `true` 启动一次再改回来。

## 8. 数据库启动开关速查

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `HORUS_DB_PUSH` | `true` | `false` = 容器启动不跑 `drizzle-kit push`，仅校验 7 张表存在（缺表仍拒绝启动，不会带病上线） |
| `HORUS_DB_INIT` | `true` | `false` = 不跑负责人/通知设置的幂等初始化（已用 `02-init-owner.sql` 建好时可关） |
| `HORUS_DB_WAIT_TIMEOUT` | `90` | 等 MySQL 可查询的秒数上限 |
| `HORUS_DB_STEP_TIMEOUT` | `180` | 每个数据库步骤的秒级墙钟上限（`0` 关闭）。让「连不上 MySQL」变成明确失败，而不是无限卡住 |

三种常见组合：

| 场景 | 组合 |
| --- | --- |
| 全交给容器（默认） | 两个开关都不写；应用账号需要建表/改表权限 |
| 手工建表，账号只给 DML（本文） | `HORUS_DB_PUSH=false` `HORUS_DB_INIT=false` |
| 手工建表，负责人仍由容器建 | `HORUS_DB_PUSH=false`（`02-init-owner.sql` 不要跑） |

纯环境变量版（不挂 `.env`，Secret + ConfigMap + `envFrom`）见 [`kubernetes-env-deployment.md`](kubernetes-env-deployment.md)；Compose / 单机与备份回滚见 [`deployment-guide.md`](deployment-guide.md)。

## 登录成功后提示「会话未生效」，日志出现 `null (reading 'length')`

该提示不一定是 Cookie 问题：旧版登录页在 `/api/workspace` 返回任意错误时都会这样提示。
如果密码接口 `/api/auth` 成功、工作台接口 `/api/workspace` 返回 500，优先检查通知设置：

```sql
SELECT id, pending_items, JSON_TYPE(pending_items) AS pending_items_type
FROM horus_notification_settings WHERE id = 'default';
```

旧版手工初始化脚本没有显式写入 `pending_items`。ORM 的 `$defaultFn` 不是 MySQL
表默认值；依数据库版本、SQL 模式或历史数据，可能插入失败或留下空值。
SQL NULL / JSON null 会使旧版工作台的 `pendingItems.length` 抛错，钉钉摘要也可能受影响。

在 **Horus 实际连接的数据库** 中执行 `deploy/mysql/03-repair-notification-settings.sql`。
该脚本可重复执行，补齐缺失的默认设置行，把 SQL NULL / JSON null 改成 `[]`，
不覆盖密码、Webhook、其他通知配置或已有的非空待重试摘要。执行后直接重新登录即可，
无需删除 PVC、重建数据库或重置密码。如果查询结果本来就是数组，请继续检查完整服务端堆栈，
不要把所有 `null.length` 都视为此问题。

升级到包含此修复的镜像后，工作台和摘要读取会兼容空值；初始化 SQL 也会显式写入空数组。
新版登录页仅在工作台返回 401 时提示会话失效，其他错误提示工作台加载失败。

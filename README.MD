# Horus · 研发进程，尽在掌握

Horus 是面向**小型研发团队**的轻量化需求看盘与里程碑跟踪工具。它不追求大而全的项目管理，而是把注意力集中在三件事上：

- **本周新建**：近 7 天（可配置 1–90 天）内新建、仍在推进中的需求
- **卡点**：被阻塞、等待外部响应的需求
- **高优逾期**：高优先级且已过期未完成的需求

工作台默认按团队分组展示全部未归档需求（含已上线待归档），三类风险以标签高亮并可一键筛选，让负责人和 PM 一眼看清「现在最该盯什么」。支持需求全生命周期推进、阶段模板自定义、成员与团队管理、钉钉每日异常摘要推送，以及移动端只读查看。

> 技术栈：Next.js App Router · React 19 · Drizzle ORM · MySQL 8.0 · 单实例容器（Docker Compose 或 Kubernetes）。生产默认强制登录，不灌演示数据。

## 功能概览

- **工作台**：统计卡片 + 多维筛选 + 按团队分组的全部在途需求列表（三类风险高亮）
- **团队详情**：阶段分布图（点击可筛选）、在途列表排序、归档历史查询
- **需求生命周期**：新建 / 编辑 / 向前跳阶段（禁止回退）/ 卡点标记与解除 / 末阶段标记上线 / 手动归档 / 取消归档 / 操作留痕
- **阶段模板**：团队独立配置阶段；删除仍有需求的阶段时必须指定迁移目标
- **成员与团队**：负责人预建账号、角色分配、PM 多团队绑定、停用成员、重置 PM 密码、编辑团队信息
- **通知设置**：钉钉 Webhook + 可选加签、北京时间每日定时发送、实时预览与发送日志
- **移动端**：首页与团队详情只读，390px 视口无横向滚动

## 界面截图

### 工作台（全部在途）

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
#    不想用 Drizzle 建表时，改为在空库上跑仓库自带的 SQL：
#    ./scripts/init-sql.sh

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
- `HORUS_DB_PUSH` / `HORUS_DB_INIT`：容器启动时是否自动同步表结构 / 初始化负责人（仅影响镜像入口脚本，`npm run dev` 不读；详见[部署说明](docs/kubernetes-deployment.md)）

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

## 生产部署（Kubernetes · 外部 MySQL）

完整说明：[`docs/kubernetes-deployment.md`](docs/kubernetes-deployment.md)。只有四步，**表结构提前用仓库自带的 SQL 建好，容器启动不跑 Drizzle**。

**1) 外部 MySQL 建库 + 建表（一次性）**

```sql
CREATE DATABASE horus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'horus'@'<允许访问的来源>' IDENTIFIED BY '<强密码>';
GRANT SELECT, INSERT, UPDATE, DELETE ON horus.* TO 'horus'@'<允许访问的来源>';   -- 手工管表就不给 DDL
```

```bash
# 在能连上这台 MySQL 的机器上、仓库根目录执行（建 7 张表 + 初始负责人，并校验）
DATABASE_URL='mysql://horus:<URL编码后的密码>@mysql.internal:3306/horus' ./scripts/init-sql.sh
```

**2) 构建并推送镜像**（构建上下文是 `./frontend`，版本用独立 tag）

```bash
export IMAGE=registry.example.com/your-team/horus:$(date +%Y%m%d)-1
docker buildx build --platform linux/amd64 --build-arg NEXT_PUBLIC_NEW_WINDOW_DAYS=7 -t "$IMAGE" --push ./frontend
```

镜像架构要和集群节点一致；私有仓库需在 `horus` namespace 配 imagePullSecrets。

**3) 写 `.env`，塞进 Secret**

```bash
umask 077 && mkdir -p /secure/horus
cat > /secure/horus/.env <<'EOF'
DATABASE_URL=mysql://horus:URL_ENCODED_PASSWORD@mysql.example.internal:3306/horus
HORUS_DB_PUSH=false
HORUS_DB_INIT=false
HORUS_DEMO_MODE=false
APP_URL=https://horus.example.com
HORUS_NEW_WINDOW_DAYS=7
EOF
kubectl create namespace horus --dry-run=client -o yaml | kubectl apply -f -
kubectl -n horus create secret generic horus-env --from-file=.env=/secure/horus/.env --dry-run=client -o yaml | kubectl apply -f -
```

真实 `.env` 放在仓库外，别提交 Git（Secret 只是 Base64，不是加密）。

主机名必须是 **Pod 可达地址**（不能是 `localhost`）；`HORUS_DB_PUSH=false` = 跳过 `drizzle-kit push`，`HORUS_DB_INIT=false` = 跳过负责人初始化，两个都以第 1 步已执行为前提。

**4) 部署并验证**（先把 [`deploy/k8s/horus.yaml`](deploy/k8s/horus.yaml) 里的 `image:` 改成第 2 步地址）

```bash
kubectl -n horus apply -f deploy/k8s/horus.yaml
kubectl -n horus rollout status deployment/horus --timeout=180s
kubectl -n horus logs deployment/horus --tail=100     # 期望 MySQL schema ready (7 tables) → Starting Horus...
kubectl -n horus port-forward service/horus 3000:3000 # 另开终端：curl -fsS http://127.0.0.1:3000/api/health
```

浏览器打开正式地址，用 `admin` 首次登录并设置 8–72 位密码。清单只建 Deployment + ClusterIP Service：不含 MySQL、Ingress/TLS、备份；对外访问由现有 Ingress/网关转发到 `horus:3000`。改配置＝改 `.env` → 重写 Secret → `kubectl -n horus rollout restart deployment/horus`。**只跑 1 个副本，不要扩容、不要 HPA**（定时摘要调度假设单实例）。

### 表结构由谁建？

| 场景 | 配置 | 说明 |
| --- | --- | --- |
| **外部提前建好（推荐，K8s 用这个）** | `HORUS_DB_PUSH=false`（可加 `HORUS_DB_INIT=false`） | 跑 `./scripts/init-sql.sh` 即可；应用账号不需要 DDL 权限；日后升级要自己跟进表结构变更 |
| 交给容器自动同步（默认） | 两个开关都不写 | 启动时 `drizzle-kit push` + 幂等建负责人，需要建表/改表权限；MySQL 半通时这一步可能长时间无输出 |
| 只手工建表，负责人仍由容器建 | `HORUS_DB_PUSH=false` | 不跑 `02-init-owner.sql`，其余同上 |

> `drizzle-kit push` 卡在 `Pulling schema from database...` 基本都是 Pod 到 MySQL 连不通（DNS/白名单/安全组）或目标库 `information_schema` 极慢。上表第一行的组合可以彻底绕开；卡住时的排查顺序见 [K8s 说明第 6 节](docs/kubernetes-deployment.md)。

## 生产部署（Docker Compose · 内网单机）

```bash
git clone <仓库地址> horus && cd horus
cp .env.example .env      # 改掉 MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD（仅字母数字下划线）、APP_URL、HORUS_PORT；保持 HORUS_DEMO_MODE=false
chmod 600 .env && chmod +x scripts/*.sh
./scripts/deploy.sh       # 构建 → 启动 → 轮询健康检查（最长 180 秒）
```

容器启动自动完成：等 MySQL → 同步 7 张表并校验 → 幂等创建初始负责人。数据在 `horus-mysql` 卷里，**日常停服不要 `docker compose down -v`**（会删卷）。备份 `./scripts/backup.sh`、恢复 `./scripts/restore.sh <file> --yes`、手工重跑初始化 `./scripts/init-db.sh`。步骤、密码规则、HTTPS 反代、升级回滚、故障排查见 [`docs/deployment-guide.md`](docs/deployment-guide.md)。

已有 MySQL、装不了 Compose v2，或想手工掌控容器：用纯 `docker` 命令，见 [`docs/docker-standalone-deployment.md`](docs/docker-standalone-deployment.md)。习惯 Secret + ConfigMap 纯环境变量的 K8s 写法：见 [`docs/kubernetes-env-deployment.md`](docs/kubernetes-env-deployment.md)。

## 相关文档

- 需求文档：[`docs/specs/horus-design.md`](docs/specs/horus-design.md)
- 项目计划：[`docs/specs/horus-project-plan.md`](docs/specs/horus-project-plan.md)
- 生产部署手册：[`docs/deployment-guide.md`](docs/deployment-guide.md)
- Kubernetes 部署（外部 MySQL，主推）：[`docs/kubernetes-deployment.md`](docs/kubernetes-deployment.md)
- 纯 Docker 部署（不用 Compose）：[`docs/docker-standalone-deployment.md`](docs/docker-standalone-deployment.md)
- 外部 MySQL 初始化脚本：[`scripts/init-sql.sh`](scripts/init-sql.sh)（SQL 本体在 [`deploy/mysql/`](deploy/mysql/)）
- Kubernetes 部署（纯环境变量版）：[`docs/kubernetes-env-deployment.md`](docs/kubernetes-env-deployment.md)
- M5 上线签收清单：[`docs/m5-uat-checklist.md`](docs/m5-uat-checklist.md)
- 前端说明：[`frontend/README.md`](frontend/README.md)

## License

本项目基于仓库根目录 [`LICENSE`](LICENSE) 发布。

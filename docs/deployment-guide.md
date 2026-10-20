# Horus 生产部署手册（Docker Compose · 内网单机版）

- 适用版本：V1（Next.js 全栈单体 + MySQL 8.0，单实例容器，**不要扩容 app 副本**）
- 关联文档：[环境变量参考](./environment-variables.md) · [Kubernetes 部署](./kubernetes-deployment.md) · [需求文档](./specs/horus-design.md) · [项目计划](./specs/horus-project-plan.md) · [M5 上线签收清单](./m5-uat-checklist.md)
- 时区：应用与数据库均按 `Asia/Shanghai` 运行；业务时间以 ISO-8601 UTC 字符串存 `VARCHAR`，不依赖数据库时区转换。

> **给运维同学的一句话**：把仓库拷到服务器 → 改一份 `.env` → 跑 `./scripts/deploy.sh` → 浏览器里给负责人设个密码，就能用了。下面是完整步骤和原理，出问题时按第 11 节排查。

## 目录

- [0. 速览：部署长什么样](#0-速览部署长什么样)
- [1. 服务器准备（部署前检查）](#1-服务器准备部署前检查)
- [2. 获取代码](#2-获取代码)
- [3. 配置 .env（唯一需要改的文件）](#3-配置-env唯一需要改的文件)
- [4. 一键启动](#4-一键启动)
- [5. 数据库初始化（四条路径，按需选一）](#5-数据库初始化四条路径按需选一)
- [6. 负责人首次登录](#6-负责人首次登录)
- [7. 业务初始化](#7-业务初始化负责人在页面完成不用碰数据库)
- [8. 钉钉每日异常摘要联调](#8-钉钉每日异常摘要联调)
- [9. 日常运维](#9-日常运维)
- [10. 离线交付](#10-离线交付服务器不能访问外网时)
- [11. 故障排查](#11-故障排查)
- [附录：环境变量](#附录环境变量)

---

## 0. 速览：部署长什么样

```
内网同事浏览器 ──► http://<服务器IP>:3000 ──► horus-app 容器（Next.js，:3000）
                                                  │
                                                  └──► mysql 容器（MySQL 8.0，:3306，仅容器网络内可达）
                                                         数据卷 horus-mysql（持久化，勿删）
horus-app ──出站──► https://oapi.dingtalk.com（每日异常摘要推送，需防火墙放行出站 443）
```

| 组件 | 说明 |
|---|---|
| `horus` 服务 | 镜像 `horus:local`，由 `frontend/Dockerfile` 多阶段构建（standalone 运行，启动时自动建表+初始化负责人） |
| `mysql` 服务 | 官方 `mysql:8.0`，`utf8mb4 / utf8mb4_0900_ai_ci`，时区 `+08:00`，**3306 不映射到宿主机** |
| 数据卷 | `horus-mysql`（MySQL 数据目录）。`docker compose down` 不删卷，`down -v` 会删——生产勿用 |
| 配置 | 仓库根目录 `.env`（不进 Git，见 `.env.example`）；两个服务均配日志轮转（10 MB × 3）防磁盘打满 |

交付文件清单（仓库内现成可用，无需另行开发）：

| 文件 | 用途 |
|---|---|
| `docker-compose.yml` | 编排 app + MySQL，含健康检查、依赖顺序、数据卷 |
| `.env.example` | 环境变量模板，复制为 `.env` 后改密码与地址 |
| `scripts/deploy.sh` | **一键部署**：环境检查 → 构建启动 → 健康检查（支持 `--no-build`） |
| `scripts/init-db.sh` | 数据库初始化/重跑校验：建表 + 初始负责人 + 8 表齐全性校验（幂等） |
| `scripts/init-sql.sh` | 在**外部/已有 MySQL** 上一次性建表 + 建负责人（跑 `deploy/mysql/*.sql` 并校验），之后可关掉容器内的 Drizzle 同步 |
| `scripts/backup.sh` / `scripts/restore.sh` | 数据库备份（.sql.gz）/ 恢复（恢复前自动留底，需 `--yes` 确认） |
| `deploy/mysql/01-schema.sql` | 8 张表建表 DDL（由 Drizzle Schema 生成），供 DBA 人工建库/评审 |
| `deploy/mysql/04-stats-upgrade.sql` | 旧库升级到「需求统计」的一次性脚本（新库不要执行） |
| `deploy/mysql/02-init-owner.sql` | 初始负责人 + 通知设置 SQL 版（与应用 `db:init` 等价，幂等） |
| `frontend/docker-entrypoint.sh` | 容器启动脚本：等 MySQL → 同步表结构 → 初始化负责人 → 启动应用（可用 `HORUS_DB_PUSH` / `HORUS_DB_INIT` 关掉前两步） |

---

## 1. 服务器准备（部署前检查）

| 项 | 要求 | 检查命令 |
|---|---|---|
| 操作系统 | 主流 Linux（Ubuntu/Debian/RHEL 系均可），x86_64 | `uname -m` |
| Docker | Docker Engine 24+ 与 Compose v2 | `docker --version && docker compose version` |
| 资源 | 2 vCPU / 2 GB 内存 / 预留 5 GB 磁盘足够（百级需求规模） | `free -h && df -h` |
| 端口 | 宿主机 `3000`（可改）空闲且内网可达；**3306 不要对外开放** | `ss -tlnp \| grep 3000` |
| 出站网络 | 构建时能拉镜像/下 npm 包；运行时能访问 `https://oapi.dingtalk.com` | `curl -I https://oapi.dingtalk.com` |
| 时间 | 系统时间与时区正确（影响容器日志时间；业务时钟代码内固定上海时区） | `date` |

未装 Docker 时（以 Ubuntu/Debian 为例，发行版仓库版本过低则按 [Docker 官方文档](https://docs.docker.com/engine/install/)装官方源版本）：

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2   # 或官方源的 docker-ce + docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # 重新登录后生效；或全程用 sudo 跑 docker 命令
docker --version && docker compose version
```

防火墙只放行应用端口（示例为 ufw，其他防火墙同理）：

```bash
sudo ufw allow 3000/tcp    # 若前面挂了 HTTPS 反向代理，改为只放行 80/443
# 不要放行 3306
```

完全离线内网（构建机也上不了网）时走第 10 节的离线镜像交付。

---

## 2. 获取代码

```bash
git clone <仓库地址> horus && cd horus
# 或将仓库压缩包拷到服务器后解压，进入根目录（能看到 docker-compose.yml 的那一层）
ls   # 应能看到 docker-compose.yml、.env.example、frontend/、scripts/、deploy/
```

下文所有命令都在**仓库根目录**执行。

---

## 3. 配置 .env（唯一需要改的文件）

```bash
cp .env.example .env
openssl rand -hex 18   # 执行两次，分别用作下面两个密码（只含十六进制字符，天然满足字符集要求）
vi .env
```

**完整 `.env` 模板**（与仓库根目录 `.env.example` 等价，可直接对照逐项检查；每个变量的完整说明见[环境变量参考](./environment-variables.md)）：

```dotenv
# ── MySQL 容器变量（首次启动自动建库建账号；密码只用字母、数字、下划线）──
MYSQL_ROOT_PASSWORD=<openssl 生成的随机串>     # root，仅容器内部运维用
MYSQL_DATABASE=horus
MYSQL_USER=horus
MYSQL_PASSWORD=<另一个随机串>                  # 应用连库账号；含特殊字符会拼坏 DATABASE_URL

# ── 应用核心 ─────────────────────────────────────────────
# Compose 会自动拼成 mysql://horus:<MYSQL_PASSWORD>@mysql:3306/horus（mysql 是服务名），无需手改；
# 下面这行只在本机 npm run dev 时才用得到
DATABASE_URL=mysql://horus:change_me_horus@127.0.0.1:3306/horus

# ── 运行模式与初始化 ─────────────────────────────────────
HORUS_DEMO_MODE=false                          # 生产红线：true 会灌演示数据并允许免登录
HORUS_INIT_OWNER_USERNAME=admin                # 仅首次建负责人有效，之后改这里不改已有账号
HORUS_INIT_OWNER_NAME=团队负责人

# ── 对外地址与业务行为 ───────────────────────────────────
APP_URL=http://192.168.1.50:3000               # 同事实际打开的地址；钉钉摘要链接兜底（页面通知设置优先）

# ── 端口与时区 ───────────────────────────────────────────
HORUS_PORT=3000                                # 宿主机映射端口，被占用改这里
HORUS_DB_CONNECTION_LIMIT=10                   # 连接池上限
TZ=Asia/Shanghai

# ── 可选：容器入口数据库开关（见第 5 节路径 D）──────────
#HORUS_DB_PUSH=false                           # 表已由外部 SQL 建好时打开，应用账号不再需要 DDL
#HORUS_DB_INIT=false                           # 已执行 02-init-owner.sql 时打开
#HORUS_DB_WAIT_TIMEOUT=90                      # 等 MySQL 秒数上限
#HORUS_DB_STEP_TIMEOUT=180                     # 单步墙钟上限（0 不限）
```

必须改的项：

| 变量 | 填什么 |
|---|---|
| `MYSQL_ROOT_PASSWORD` | 上一步生成的随机串。仅 MySQL 容器内部使用 |
| `MYSQL_PASSWORD` | 另一个随机串。应用连库用。**只能用字母、数字、下划线**，否则拼 `DATABASE_URL` 时会被截断 |
| `APP_URL` | 同事实际打开的地址，如 `http://192.168.1.50:3000` 或正式域名 `https://horus.example.internal`。钉钉摘要里的跳转链接以此为准（页面「通知设置」里另填的链接优先） |
| `HORUS_PORT` | 宿主机映射端口，默认 `3000`；被占用就改这里，不要改容器内端口 |
| `HORUS_INIT_OWNER_USERNAME` / `HORUS_INIT_OWNER_NAME` | 初始负责人账号/姓名，默认 `admin` / `团队负责人`。**仅首次初始化时有效**，之后改这里不会改已有账号 |

保持不动的项：`HORUS_DEMO_MODE=false`（生产红线：开启会灌演示数据并允许免登录）、`TZ=Asia/Shanghai`。「本周新建」已改为自然周（周一 00:00），无需再配置窗口天数。

改完自查（不应再出现 `change_me`）：

```bash
grep -n 'change_me' .env && echo '!! 还有默认密码没改' || echo '密码已改'
grep -n 'HORUS_DEMO_MODE' .env
chmod 600 .env   # 含明文密码，收紧权限；.env 已被 .gitignore 排除，不要提交、不要外发
```

> `.env` 里的 `DATABASE_URL` 是给本机 `npm run dev` 用的；容器内 compose 会自动拼成 `mysql://…@mysql:3306/…`（主机名 `mysql` 是 compose 服务名），无需手改。

---

## 4. 一键启动

```bash
chmod +x scripts/*.sh   # 若脚本没有执行权限
./scripts/deploy.sh
```

脚本依次做四件事，任一步失败都会停下并给出原因，**不会带病继续**：

1. 检查 Docker/Compose 在运行、`.env` 存在；
2. 校验密码已改、字符集合法、生产未开演示模式（演示需显式 `ALLOW_DEMO=1`，生产不要用）；
3. `docker compose config` 校验后 `docker compose up -d --build`（首次需拉取 `node:22`、`mysql:8.0` 镜像并构建，视网速约数分钟）；
4. 轮询 `http://127.0.0.1:${HORUS_PORT}/api/health` 最长 180 秒，通过后打印下一步指引。

等价的手工命令（不用脚本时）：

```bash
docker compose up -d --build
docker compose ps                    # mysql 与 horus 都应为 healthy
curl -fsS http://127.0.0.1:3000/api/health   # {"ok":true}（端口改过则换成对应端口）
docker compose logs -f horus         # 看启动过程，Ctrl+C 退出不影响容器
```

**容器启动时自动完成的初始化**（`docker-entrypoint.sh`，无需人工干预）：

1. 等待 MySQL 可查询（最长 90 秒，靠 compose 健康检查 + 脚本双重等待）；
2. `drizzle-kit push` 同步 8 张表结构，并逐表校验齐全，缺表直接启动失败（不会假装成功）；
3. `db:init` 幂等创建初始负责人与通知设置默认行——每次启动都跑，但**不覆盖**已有负责人密码和已保存的钉钉配置；

第 2、3 步各有一个开关（`HORUS_DB_PUSH=false` / `HORUS_DB_INIT=false`，见第 5 节路径 D）。关掉第 2 步后**仍会校验 8 张表**，缺表照样拒绝启动，不会带着空库上线。
4. 以 standalone 模式监听 `0.0.0.0:3000`，进程内每分钟调度检查钉钉摘要与过期会话清理（单实例假设，勿扩容）。

---

## 5. 数据库初始化（四条路径，按需选一）

正常情况**路径 A 就够了**，B 用于重跑校验，C/D 面向 DBA 人工管库、或容器连不上/不适合跑 Drizzle 的场景。

### 路径 A：全自动（默认，推荐）

即第 4 节的启动流程：建库建表、建负责人全自动完成，什么都不用做。

### 路径 B：手工重跑/验收校验

容器已启动后，想重跑初始化或核查数据库状态时：

```bash
./scripts/init-db.sh
# 依次：容器内 drizzle-kit push 同步表结构 -> db:init 创建/保留负责人 -> 校验输出
# 期望结尾：tables=8 / owner=admin password_set=0|1 / notification_settings=1
```

幂等性说明：表已存在则结构同步为空操作；负责人已存在则保留原样（姓名、密码都不动）；通知行用 `INSERT IGNORE` 语义。**它不会重置任何人的密码**——PM 忘密码走页面上负责人「重置密码」，不要指望重跑脚本。

只想看数据、不想跑脚本时，直接查库（密码从容器环境读取，不落命令行）：

```bash
docker compose exec mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SHOW TABLES; SELECT id,username,name,role,active FROM horus_members;"'
```

### 路径 C：DBA 人工 SQL 初始化（不用容器自动建表时）

适合数据库由 DBA 统一管理、不允许应用自动改表结构的场景：

```sql
-- 1) DBA 用 root 先建库与应用账号（密码替换为 .env 中的 MYSQL_PASSWORD）
CREATE DATABASE horus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'horus'@'%' IDENTIFIED BY '<MYSQL_PASSWORD>';
GRANT ALL PRIVILEGES ON horus.* TO 'horus'@'%';
```

```bash
# 2) 在空库依次执行建表与初始数据（用 Compose 自带的 MySQL 时，先只起库：docker compose up -d mysql）
docker compose exec -T mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < deploy/mysql/01-schema.sql
docker compose exec -T mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < deploy/mysql/02-init-owner.sql
#    外部 MySQL 用仓库脚本更省事（带结果校验，见路径 D）
# 3) 之后照常 ./scripts/deploy.sh 启动应用；启动时的结构同步与 db:init 是幂等的，不会与手工结果冲突
#    （想让应用完全不碰 Drizzle，见路径 D）
```

注意事项：

- `01-schema.sql` 是一次性建表脚本（8 张表：`horus_teams`、`horus_members`、`horus_requirements`、`horus_requirement_events`、`horus_sessions`、`horus_audit_logs`、`horus_notification_settings`、`horus_notification_logs`），对已有数据的库重复执行会因表/外键已存在报错，不要拿它当升级脚本；结构变更仍走应用启动时的 Drizzle 同步或 DBA 评审后的变更单。
- `02-init-owner.sql` 执行前可改文件头的 `@owner_username` / `@owner_name`；与 `db:init` 二选一即可，重复执行无副作用。若走 compose 部署，`.env` 里的 `HORUS_INIT_OWNER_*` 应与 SQL 中一致，避免两处口径不同。
- 首选仍是路径 A：手工 SQL 一旦与 `frontend/src/db/schema.ts` 漂移，启动校验会以缺表/结构同步失败的形式暴露，但排查成本高于自动路径。漂移可由 `npm run test:schema-sql` 提前查出（比对 `01-schema.sql` 与 `schema.ts` 的表名、列名和关键约束）。

### 路径 D：提前建好表，容器内完全不跑 Drizzle（K8s / RDS / MySQL 5.7 常见）

适合这些情况：MySQL 只能由 DBA 建表（不给应用账号 DDL）、应用账号只给 DML、Pod 到 MySQL 半通导致 `drizzle-kit push` 卡在 `Pulling schema from database...`、或实例是 MySQL 5.7（`push` 拉取 Schema 会失败）。

```bash
# 1) 建库建账号后，用 SQL 初始化一次（表 + 负责人 + 通知设置默认行，脚本会校验结果）
#    外部 MySQL：
DATABASE_URL='mysql://horus:<密码>@<mysql-host>:3306/horus' ./scripts/init-sql.sh
#    Compose 自带的 MySQL（3306 不对外发布，走容器内客户端）：
docker compose up -d mysql
docker compose exec -T mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < deploy/mysql/01-schema.sql
docker compose exec -T mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < deploy/mysql/02-init-owner.sql
# 2) 关掉容器内的两步初始化（写在 .env 即可，compose 已把这几个变量透传给容器）
printf 'HORUS_DB_PUSH=false\nHORUS_DB_INIT=false\n' >> .env
# 3) 启动应用
./scripts/deploy.sh --no-build
```

| 变量 | 默认 | 关掉后的效果 |
|---|---|---|
| `HORUS_DB_PUSH` | `true` | `false`：不执行 `drizzle-kit push`；启动时只查 `information_schema` 确认 8 张表存在 |
| `HORUS_DB_INIT` | `true` | `false`：不执行 `db:init`。仅在已跑 `02-init-owner.sql` 时设置，否则没有负责人账号、无法首次登录 |
| `HORUS_DB_WAIT_TIMEOUT` | `90` | 等 MySQL 可查询的秒数 |
| `HORUS_DB_STEP_TIMEOUT` | `180` | 每个数据库步骤的墙钟上限（`0` 关闭）。让「连不上」变成明确失败，而不是无限期吊着 rollout |

代价与纪律：

- 表结构从此由**你**维护。每次升级前确认该版本 `frontend/src/db/schema.ts` 有无变化；有变化就先备份、由 DBA 执行对应 DDL（或临时把 `HORUS_DB_PUSH` 设回 `true` 启动一次同步后再关掉）。
- 应用账号可以收紧到 `SELECT/INSERT/UPDATE/DELETE`，这通常是走本路径的原因。
- 新库上线后请核对日志出现 `MySQL schema ready (8 tables)`；缺表会以 `Schema sync did not create: …` 直接启动失败。
- 手工 SQL 与 Drizzle schema 的同步由 `npm run test:schema-sql` 兜底，改表时两侧都要动。

### 路径 E：从旧版本升级到「需求统计」（已有数据）

「需求统计」新增 `horus_requirements.released_at` / `cancelled_at` 两列和 `horus_requirement_events` 事件表。已有数据库升级步骤：

```bash
# 1) 先备份数据库
# 2) MySQL 旧库执行一次性升级脚本（PostgreSQL 用 deploy/postgres/03-stats-upgrade.sql）
docker compose exec -T mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < deploy/mysql/04-stats-upgrade.sql
# 3) 启动应用；日志应出现 MySQL schema ready (8 tables)
./scripts/deploy.sh --no-build
# 4) 回填历史生命周期事件（首次打开统计页也会自动回填）
docker compose exec horus node --experimental-strip-types /opt/horus-migrate/src/db/backfill-events-cli.ts
```

说明：

- 第 4 步在容器内执行，直接复用容器里已配置的 `DATABASE_URL`；也可在能连到数据库的机器上，于仓库 `frontend/` 目录执行 `DATABASE_URL=... npm run db:backfill`。
- 回填可重复执行：事件表对 `(requirement_id, type, created_at)` 有唯一约束，重复插入会被忽略。
- 新库直接执行 `01-schema.sql`，**不要**再执行 04 升级脚本。
- 历史数据的上线时间取 `enteredAt`、取消时间取 `archivedAt`，属于近似值；卡点历史优先用审计日志，覆盖不到的部分在统计页标注为估算。
- 若使用 `HORUS_DB_PUSH=true`，Drizzle 也会自动补列和建表；`HORUS_DB_PUSH=false` 时必须先执行升级脚本，否则启动校验会因缺 `horus_requirement_events` 失败。

### 初始化做了/没做什么（避免误会）

| 做了 | 没做 |
|---|---|
| 建 8 张表、建负责人（密码为空）、建通知设置默认行 | 不灌任何演示团队/需求（演示数据只在 `HORUS_DEMO_MODE=true` 时出现） |
| 每次启动重复执行且幂等 | 不给负责人预设密码——密码由本人在首次登录时设置（见第 6 节） |

账号建错且**尚未投产**时，宁可推倒重来也不要改库凑合：备份后 `docker compose down -v` 清卷，按第 4 节重新部署（**会清空全部数据，仅限未投产时**）。已投产后账号问题一律走页面功能（改名、停用、重置密码）。

---

## 6. 负责人首次登录

1. 浏览器打开 `APP_URL`，未登录自动跳 `/login`，页面**不应**出现演示账号入口（出现了说明演示模式被打开，立即按第 11 节处理）。
2. 输入负责人账号（默认 `admin`），系统识别为首次登录，设置 8–72 位密码。密码以 bcrypt（成本因子 12）存库，会话只在服务端存 SHA-256 摘要。
3. 再执行 `./scripts/init-db.sh` 或重启容器都不会重置这个密码。PM 忘密码时由负责人在页面点「重置密码」，其旧会话立即失效，下次登录重新设密——没有自助找回，这是产品定版行为。
4. 验收锚点：换一台内网电脑和一部手机打开 `APP_URL`，确认都能到登录页、手机无横向滚动。协议说明：内网纯 HTTP 时密码走明文传输，仅适合受控内网验收；正式投产建议按第 9.3 节挂 HTTPS 反向代理。

---

## 7. 业务初始化（负责人在页面完成，不用碰数据库）

1. 「成员与团队」→ 创建 3–5 个真实团队，改好名称、简介、颜色。
2. 「阶段模板」→ 按团队增删、改名、调序阶段。删除仍有需求的阶段时必须指定迁移目标，这是防丢数据的强制校验，前后端都会拦。
3. 预建 ≤3 个 PM 账号并绑定团队，把账号告知本人首次登录设密；顺手用测试账号验证停用/重置密码后旧会话立即 401。
4. PM 录入首批在途需求。抽查推进（只能向前跳、不能回退）、卡点标记、推到末阶段标记上线、再由详情手动归档三条规则。
5. 负责人在桌面与手机核对首页全部未归档需求按团队分组展示，本周新建、卡点、高优逾期高亮并可筛选；打开「需求统计」核对周/月切换与团队筛选。

逐项签收表在 [M5 清单](./m5-uat-checklist.md) 的 T5.3/T5.4，本节全部做完才算业务初始化完成。

---

## 8. 钉钉每日异常摘要联调

1. 内部群添加自定义机器人，安全设置二选一：加签（把 `SEC` 密钥填进 Horus）或自定义关键词 `Horus`。
2. 在 Horus「通知设置」填 Webhook（必须是 `https://oapi.dingtalk.com/robot/send?access_token=…`）、可选加签密钥、工作台链接（填同事打得开的内网地址）。Webhook 与密钥保存后不会回显给浏览器，日志也不记录明文。
3. 点「立即发送测试」，到群里确认**实际收到**、排版与链接可点。测试发送不占用当日定时名额。
4. 开启「每日异常摘要」（默认 09:30，北京时间，页面可改）。**次日**到点确认只发一条且内容准确——定时到达这项必须隔日验收，不要用测试发送代替。
5. 发送失败会写失败日志并暂存摘要，次日定时去重合并重发，页面不弹打扰式报错。到点没消息按第 11 节查。

前提：运行中的容器能出站访问钉钉（第 1 节已用 `curl -I https://oapi.dingtalk.com` 在宿主机验过；若宿主机走代理而容器不走代理，需给容器配代理或让运维放行容器网段出站）。

---

## 9. 日常运维

### 9.1 常用命令速查

```bash
docker compose ps                          # 状态与健康
docker compose logs -f horus               # 应用日志（跟随，Ctrl+C 退出不影响服务）
docker compose logs --tail 100 mysql       # 数据库日志
docker compose restart horus               # 只重启应用（会重跑建表同步+db:init，幂等安全）
docker compose stop                        # 停服（保留容器与数据）
docker compose start                       # 启服
curl -fsS http://127.0.0.1:${HORUS_PORT:-3000}/api/health   # 健康自检
./scripts/init-db.sh                       # 核查 8 表与负责人状态
docker compose exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'   # root 应急进库（密码读容器环境变量）
```

不要用 `docker compose down -v` 做日常停服——`-v` 会删数据卷。只停服务用 `stop`，删容器留数据用 `down`（不带 `-v`）。

### 9.2 备份与恢复

```bash
./scripts/backup.sh                        # 默认输出 backups/horus-年月日-时分秒.sql.gz，并做非空与完整性检查
./scripts/backup.sh /mnt/backup/horus.sql.gz   # 也可以直接指定输出路径
```

- 备份经容器内 `mysqldump --single-transaction` 导出，不需要把 3306 暴露到宿主机。
- **备份文件必须再拷一份到公司规定的备份位置**（另一台机器/备份盘），只留在应用宿主机不算备份完成。恢复目标是「能把库找回」，建议每日一次、保留近 7–14 天。
- 恢复（危险，会覆盖当前库）：

```bash
./scripts/restore.sh backups/horus-20261019-090000.sql.gz --yes
# 脚本会先自动备份当前库为 backups/pre-restore-*.sql.gz，再停应用、恢复、启应用、跑健康检查
```

恢复演练只在隔离/测试库做，不要拿生产库练手。恢复后登录页面抽查团队与需求再宣布完成。

### 9.3 HTTPS 反向代理（正式投产建议）

应用本体只监听 HTTP，把 TLS 终结放在现有网关/Nginx 上。关键是转发头要全，否则同源校验与安全 Cookie 会出问题：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

同时把 `.env` 的 `APP_URL` 改为 `https://正式域名` 后 `./scripts/deploy.sh --no-build`（或 `docker compose up -d`）让钉钉链接与新地址一致。应用在 HTTPS 下自动给会话 Cookie 加 Secure，HTTP 下不加（加了浏览器不保存会话），二者自动适配，无需改代码。

### 9.4 升级与回滚

```bash
./scripts/backup.sh                        # 1) 先备份（铁律）
git pull                                   # 2) 拉新代码（或解压新版本包）
./scripts/deploy.sh                        # 3) 重新构建并滚动启动，健康检查通过才算完
```

- 启动时的结构同步对无变更是空操作；`drizzle-kit push --force` 会自动接受 Drizzle 认为可能丢数据的变更（如删列），**发版前先看 schema diff**，不能接受自动删列时停在旧版，走 DBA 变更单手工迁移后再升级。
- 走路径 D（`HORUS_DB_PUSH=false`）时**没有任何自动同步**：升级前必须自己确认表结构是否需要变更（对比 `frontend/src/db/schema.ts` 与库内结构，或跑一次 `npm run test:schema-sql` 看 SQL 文件有没有漂移），需要变更就由 DBA 执行 DDL 后再换镜像/重启。
- 升级到含「需求统计」的版本时，旧库先执行 `deploy/mysql/04-stats-upgrade.sql`（PostgreSQL 用 `deploy/postgres/03-stats-upgrade.sql`），再运行 `cd frontend && npm run db:backfill`；新库直接执行 01-schema.sql 即可。
- 回滚：切回上一版代码重新 `./scripts/deploy.sh`，并用升级前备份 `./scripts/restore.sh <备份> --yes` 连库一起回退。不要只回滚应用而留下不兼容的新表结构。

---

## 10. 离线交付（服务器不能访问外网时）

在有网机器上（架构须与内网服务器一致，均为 x86_64）：

```bash
docker compose build
docker save horus:local mysql:8.0 | gzip > horus-images.tar.gz
# 把 仓库目录 + horus-images.tar.gz 一起拷到内网服务器
```

内网服务器上：

```bash
docker load < horus-images.tar.gz
cp .env.example .env && vi .env        # 按第 3 节改密码与 APP_URL
./scripts/deploy.sh --no-build         # 镜像已就位，跳过构建直接启动+健康检查
```

注意：`--no-build` 不会校验镜像是否为最新代码版本，离线包打出后不要再改代码才拷过去；字体已打进 npm 依赖，运行时不请求 Google Fonts，无外网不影响页面。

---

## 11. 故障排查

先收集现场：`docker compose ps`、`docker compose logs --tail 100 horus mysql`、`.env` 相关行（打码密码后）、报错时间点。不要一上来删卷重装。

| 现象 | 多半原因 | 处理 |
|---|---|---|
| `deploy.sh` 报密码仍为默认值/字符非法 | `.env` 没改或密码带特殊字符 | 按第 3 节用 `openssl rand -hex 18` 重新生成，只用字母数字下划线 |
| `horus` 一直重启，日志 `DATABASE_URL is required` | `.env` 不在仓库根目录，或 compose 没读到 | 确认在根目录执行、`MYSQL_PASSWORD` 非空；`docker compose config` 看注入值 |
| 日志卡在 `Waiting for MySQL` 超 90 秒 | MySQL 没起来：密码含特殊字符、或数据卷是用另一套密码初始化的旧卷 | 先看 `docker compose logs mysql`；确认是旧卷且数据可弃才 `down -v` 重建（**未投产限定**），已投产改为对齐密码 |
| 日志停在 `Pulling schema from database...` 不动 | `drizzle-kit push` 正在连库做结构内省且自身没有超时：Pod 到 MySQL 半通（SYN 被丢包）、目标实例 `information_schema` 查询极慢、或表上有元数据锁 | 先确认网络与账号（`mysql -h <host> -u horus -p -e 'SELECT 1'` 用同一地址）；急上线路径 D：`./scripts/init-sql.sh` 提前建表 + `HORUS_DB_PUSH=false`；也可调低 `HORUS_DB_STEP_TIMEOUT` 让它主动失败 |
| `Schema sync did not create: …` | `drizzle-kit push` 在 MySQL 8.0 上失败（版本/权限） | 看同段日志的 drizzle 报错；确认库账号对 `horus` 库有全权；把 `deploy/mysql/01-schema.sql` 交 DBA 先行建表再重启（路径 C） |
| `/api/health` 200 但业务失败 | 心跳仅检测 HTTP 进程，不检查数据库 | 确认 `DATABASE_URL` 地址可达，检查 MySQL 状态与业务日志 |
| 登录页出现演示账号入口 | `HORUS_DEMO_MODE=true` 被打开 | 立即改回 `false` 并 `docker compose up -d`；检查演示数据是否已灌入（空库才灌），已灌入且未投产可清卷重来 |
| 端口被占用，容器起不来 | 宿主机 3000 已有进程 | 改 `.env` 的 `HORUS_PORT` 后重新 `up -d`，同步更新 `APP_URL` 端口 |
| 09:30 没有群消息 | 容器当时不在线/未开启摘要/Webhook 未保存/容器出站不通 | 查页面「推送记录」与当天日志；确认第 8 节开关与出站；失败项次日会自动合并重发，不要手工改 `last_run_date` |
| 同一天收到两条定时摘要 | 不应发生（发信前有数据库抢占） | 区分是否为一条「立即发送测试」+一条定时（这是正常）；两条都是定时则保留日志报障 |
| 「本周新建」与预期不符 | 浏览器/服务器时区不是 Asia/Shanghai，或数据创建时间不在本周一之后 | 业务判断固定使用 Asia/Shanghai；页面显示「本周新建窗口」的起止日期，可据此核对数据 |
| 手机/异地电脑打不开 | 防火墙未放行、或 `APP_URL` 写了 `localhost` | 放行应用端口（第 1 节）；`APP_URL` 必须是客户端可达地址，不能写 `localhost` 给别人用 |
| 经反向代理写操作被拦/登录态丢失 | 转发头不全 | 按 9.3 补齐 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto`，且 `APP_URL` 与实际访问协议域名一致 |

任何健康检查、登录、钉钉实收、数据核对或备份环节失败，**暂停上线**，保留日志与数据卷，按 9.4 回滚路径处理，不要删卷赌一把。现场逐项签收走 [M5 清单](./m5-uat-checklist.md)：T5.1～T5.4 全过且负责人确认后，才把状态改为「正式上线」。

---

## 附录：环境变量

上表之外 Compose 路线不涉及其他变量。**所有变量的完整说明、默认值、跨路线适用矩阵**（含 K8s、纯 Docker、Vercel 的差异，以及 `HORUS_DB_*` 容器开关、`HORUS_ENV_FILE`、预览模式变量等）统一见 [环境变量参考](./environment-variables.md)；Compose 路线的变量模板见第 3 节，模板文件为仓库根目录 `.env.example`。

三条与变量直接相关的红线，再强调一遍：

- `HORUS_DEMO_MODE` 生产必须 `false`（`deploy.sh` 会拦截；确为受控演示需显式 `ALLOW_DEMO=1`，生产不要用）。
- `MYSQL_PASSWORD` 只用字母、数字、下划线。
- MySQL 容器只在数据卷为空时按 `MYSQL_*` 初始化账号，之后改 `.env` 里的密码**不会**同步库内账号，两边必须一致（不一致时第 11 节「Waiting for MySQL」一行）。

> `/api/health` 是无数据库访问的进程心跳，不代表业务或 MySQL 健康。Kubernetes 部署（两条配置路线）见 [K8s 部署说明](kubernetes-deployment.md)。

# Horus 环境变量参考（全路线统一）

本文是所有部署路线共享的环境变量权威参考。各部署文档只放**本路线**的模板与要点，变量的完整含义、默认值和适用范围统一查本文。变量定义与 `.env.example` 保持同步；发现不一致以仓库根目录 `.env.example` 与 `frontend/Dockerfile` 为准并提 issue。

- 配置加载优先级（容器入口 `frontend/load-env.cjs`）：**容器显式环境变量 > `.env` 文件**。文件默认读 `/app/.env`，可用 `HORUS_ENV_FILE` 改路径；文件不存在且未设置 `HORUS_ENV_FILE` 时直接沿用环境变量（Compose / `docker -e` 场景）；**显式指定了 `HORUS_ENV_FILE` 而文件缺失会直接启动失败**。
- 运行时变量只在**进程启动时读一次**，改完必须重启容器/Pod 才生效，没有热更新。
- 标注「构建期」的变量写进前端 bundle，改动必须重新构建镜像；其余全部是运行时变量。

## 速查矩阵：哪个变量在哪条路线用

✅ = 需要设置或可能调整；➖ = 不适用；🚫 = 不要设置（设了也没用或有害）

| 变量 | 本地 dev | Compose | 纯 Docker | K8s | Vercel | 说明速记 |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | ✅ 手填 | ➖ 自动拼 | ✅ | ✅ | ✅ | 唯一核心必填项 |
| `MYSQL_ROOT_PASSWORD` | ➖ | ✅ | ✅（MySQL 容器） | ➖* | ➖ | MySQL 容器自己的变量，*K8s 集群内 MySQL（方式 B）才需要 |
| `MYSQL_DATABASE` / `MYSQL_USER` | ➖ | ✅ | ✅（MySQL 容器） | ➖* | ➖ | 同上 |
| `MYSQL_PASSWORD` | ➖ | ✅ | ✅（MySQL 容器） | ➖* | ➖ | 同上；仅字母数字下划线 |
| `HORUS_DEMO_MODE` | ✅ | ✅ | ✅ | ✅ | ✅ | 生产必须 `false` |
| `HORUS_INIT_OWNER_USERNAME` / `HORUS_INIT_OWNER_NAME` | 可选 | 可选 | 可选 | 可选 | 可选 | 仅首次建负责人有效 |
| `APP_URL` | 可选 | ✅ | ✅ | ✅ | ✅ | 对外地址，钉钉链接兜底 |
| `HORUS_PORT` | ➖ | 可选 | ➖ | ➖ | ➖ | 仅 Compose 宿主机端口映射 |
| `HORUS_DB_CONNECTION_LIMIT` | 可选 | 可选 | 可选 | 可选 | ✅（默认 3） | 连接池大小 |
| `HORUS_DB_PUSH` / `HORUS_DB_INIT` | ➖ | 可选 | 可选 | 可选 | 🚫 | 仅容器入口脚本读取，`npm run dev` 与 Vercel 不读 |
| `HORUS_DB_WAIT_TIMEOUT` / `HORUS_DB_STEP_TIMEOUT` | ➖ | 可选 | 可选 | 可选 | 🚫 | 同上，超时保护 |
| `TZ` | ➖ | ✅ | ✅ | 可选（镜像已内置） | ➖ | 容器日志时区 |
| `HORUS_ENV_FILE` | ➖ | 🚫 | 🚫 | 仅「挂 .env 文件版」 | 🚫 | 自定义 .env 路径；纯 env 版设了会启动失败 |
| `HORUS_PREVIEW_MODE` / `HORUS_EMBEDDED_PREVIEW` | 仅本地预览 | 🚫 | 🚫 | 🚫 | 🚫 | 只读预览专用，生产设置了没有正收益 |

## 分类详表

### 1. 数据库连接（核心必填）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | 无（必填） | 应用连接数据库的唯一入口，驱动由协议自动选择：`mysql://` → MySQL 8.0+，`postgresql://` / `postgres://` → PostgreSQL 15+（含 Supabase）。主机名必须是**应用容器可达的地址**（Compose 内写服务名 `mysql`；K8s 写外部地址或 `horus-mysql`；绝不能写 `localhost`/`127.0.0.1`）。缺省时容器报 `DATABASE_URL is required` 退出。密码含特殊字符需百分号编码，见[下文](#database_url-密码编码)。Compose 部署无需手填——由 `MYSQL_*` 变量自动拼装 |

### 2. MySQL 容器变量（不是 Horus 应用的）

只属于 `mysql:8.0` 容器（Compose / 纯 Docker / K8s 集群内 StatefulSet），不要塞进 Horus 应用的环境里：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` | 必填 | root 密码，仅容器内部运维用 |
| `MYSQL_DATABASE` | `horus` | 首次初始化自动创建的库 |
| `MYSQL_USER` | `horus` | 首次初始化自动创建的应用账号 |
| `MYSQL_PASSWORD` | 必填 | 应用账号密码。**只能用字母、数字、下划线**，否则拼 `DATABASE_URL` 和健康检查时会被截断。注意镜像只在数据目录为空时初始化账号，之后改这里**不会**同步库内密码 |

### 3. 运行模式与初始化

| 变量 | 默认 | 说明 |
|---|---|---|
| `HORUS_DEMO_MODE` | `false` | **生产红线**。只有显式 `true` 才灌演示团队/需求并允许免登录，仅限本地/受控演示；Compose 的 `deploy.sh` 会拦截（需 `ALLOW_DEMO=1` 才放行）。登录页出现演示账号入口即说明被误开 |
| `HORUS_INIT_OWNER_USERNAME` | `admin` | 初始负责人**登录账号**，3–32 位字母/数字/`.`/`_`/`-`。仅在库中无负责人时用于首次创建，之后改它**不会**改已有账号 |
| `HORUS_INIT_OWNER_NAME` | `空间管理员` | 初始负责人姓名，1–40 字符。同上，仅首次有效 |

负责人密码为空创建，本人在首次登录时设置 8–72 位密码；重跑初始化**不会重置**任何人的密码。PM 忘密码走负责人页面的「重置密码」。

### 4. 业务行为

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | 用户实际访问的对外地址。钉钉摘要跳转链接的兜底（页面「通知设置」里另填的链接优先）。必须与实际访问协议/域名一致，不能写 `localhost` 给别人用；挂 HTTPS 后同步改成 `https://` |

> 「本周新建」已改为自然周：每周一 00:00（Asia/Shanghai）重置，不再提供滚动窗口天数配置。需求统计页的生命周期与卡点事件写入 `horus_requirement_events`，旧库升级见各部署文档的「升级到需求统计」小节。

### 5. 连接池与容器入口开关

| 变量 | 默认 | 说明 |
|---|---|---|
| `HORUS_DB_CONNECTION_LIMIT` | MySQL `10`；Vercel PostgreSQL `3` | 数据库连接池大小。单实例小团队别盲目调大（注意 MySQL 侧 `max_connections`） |
| `HORUS_DB_PUSH` | `true` | 容器启动是否执行 `drizzle-kit push` 同步 8 张表。表已由外部 SQL 建好（`./scripts/init-sql.sh` / `deploy/mysql/*.sql`）时设 `false`：应用账号不再需要 DDL 权限，启动仍会校验 8 张表，缺表直接失败。接受 `false/0/no/off` |
| `HORUS_DB_INIT` | `true` | 容器启动是否幂等创建初始负责人与通知设置默认行。已执行 `02-init-owner.sql` 时可设 `false`，否则没有账号无法首次登录 |
| `HORUS_DB_WAIT_TIMEOUT` | `90` | 等 MySQL 可查询的秒数上限 |
| `HORUS_DB_STEP_TIMEOUT` | `180` | 单个数据库步骤的墙钟上限（`0` 不限）。防止「连不上 MySQL」时启动流程无限期挂住 |

`HORUS_DB_*` 四项仅由镜像入口 `docker-entrypoint.sh` 读取，对 `npm run dev` 和 Vercel 无效。`HORUS_DB_PUSH=false` 之后**表结构变更是人工环节**：升级前确认 `frontend/src/db/schema.ts` 有无变化，有则由 DBA 执行 DDL（或临时设回 `true` 启动一次再关掉）。SQL 文件与 Drizzle schema 的漂移可用 `npm run test:schema-sql` 检出。

### 6. 平台专属

| 变量 | 适用 | 说明 |
|---|---|---|
| `HORUS_PORT` | 仅 Compose | 宿主机映射端口（默认 `3000`）。被占用改这里，不要改容器内端口 |
| `HORUS_ENV_FILE` | 仅 K8s「挂 .env 文件版」 | 自定义 `.env` 挂载路径（默认 `/app/.env`）。显式指定但文件缺失会启动失败；纯 env 版**绝对不要设置** |
| `TZ` | 容器 | 时区（`Asia/Shanghai`），影响容器日志时间；业务时钟代码内固定上海时区，不依赖此值 |
| `PORT` / `HOSTNAME` / `NODE_ENV` | 镜像内置 | `3000` / `0.0.0.0` / `production`，**不要改**（改动需同步探针、Service，且会影响登录 Cookie 等生产行为） |
| `HORUS_PREVIEW_MODE` | 仅本地 | 无数据库时只读界面预览（内存示例数据，写接口 503），仅 `NODE_ENV=development` 生效 |
| `HORUS_EMBEDDED_PREVIEW` | 仅沙箱 | 沙箱内嵌预览专用，生产不要设置 |

## `DATABASE_URL` 密码编码

`DATABASE_URL` 是标准 URL：`mysql://<用户>:<密码>@<主机>:3306/<库名>`。密码含 URL 特殊字符又不编码时，连接串会被截断/解析错位，报错多半是「密码错误」假象。

- **首选**：密码只用字母、数字、下划线（生成：`openssl rand -hex 24`，天然纯十六进制）。
- 已有特殊字符密码，按对照表替换（应用侧会 `decodeURIComponent` 还原）：

| 字符 | `@` | `:` | `/` | `?` | `#` | `%` | 空格 |
|---|---|---|---|---|---|---|---|
| 编码 | `%40` | `%3A` | `%2F` | `%3F` | `%23` | `%25` | `%20` |

```bash
# 明文密码 → 可拼进 DATABASE_URL 的编码串（输入不回显）
python3 -c "import urllib.parse,getpass; print(urllib.parse.quote(getpass.getpass('DB password: '), safe=''))"
```

## 常见组合：表结构由谁建

| 场景 | 配置组合 | 说明 |
|---|---|---|
| 全自动（默认，推荐） | 两个开关都不写 | 启动时 `drizzle-kit push` + 幂等建负责人，应用账号需 DDL 权限 |
| 手工建表，账号只给 DML | `HORUS_DB_PUSH=false` + `HORUS_DB_INIT=false` | 先跑 `./scripts/init-sql.sh`；表结构升级从此人工跟进 |
| 手工建表，负责人仍由容器建 | `HORUS_DB_PUSH=false` | 不跑 `02-init-owner.sql` |

## 三条生产红线（与变量相关部分）

1. `HORUS_DEMO_MODE` 生产必须 `false`；不要设置 `HORUS_PREVIEW_MODE` / `HORUS_EMBEDDED_PREVIEW`。
2. 不要把数据库密码放进任何 `NEXT_PUBLIC_*` 变量、仓库或文档。
3. 密码相关的变量改动（如 MySQL 容器密码）不会同步到已初始化的库内账号，两边必须一致。

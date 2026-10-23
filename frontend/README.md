# Horus · 研发进程，尽在掌握

Horus 是面向小型研发团队的里程碑跟踪工具，基于 Next.js App Router、React 与 Drizzle ORM，支持 MySQL 8.0+ 和 PostgreSQL 15+（含 Supabase）。运行时根据 `DATABASE_URL` 自动选择数据库驱动和对应 schema；演示访问默认关闭。

## 功能

- 工作台：按团队分组展示全部未归档需求；本周新建（周一 00:00 起创建且未取消，含已上线与已归档；处于「需求评审」阶段时显示「新建」标记）、卡点、逾期可一键筛选。「逾期上线」保留「已上线」标记并额外提示，未归档逾期上线计入「全部逾期」及其中的「高优逾期」。
- 需求统计：按自然周/自然月汇总新建、上线、取消、卡点、归档、存量与团队对比；逾期上线按实际上线日期统计全优先级数量及其中高优数量，另保留期末高优未上线逾期存量。历史数据自动回填并标注估算。
- 团队详情：阶段分布、筛选与排序、在途和归档列表。
- 需求全生命周期：创建（优先级默认高优先级，可下调；期望上线/完成日期必填，日历只放开当天及以后，按北京时间判定）、编辑（已填过去日期的需求以下限为当前值，可保留或往后调整）、跳阶段推进、卡点标记和解除、取消、上线后手动归档。日期限制只作用于界面，接口写入不受影响。
- 阶段模板：团队独立配置阶段；删除仍有需求的阶段时必须指定迁移目标。
- 成员与团队：负责人预建账号、角色分配、多团队绑定、停用成员、重置 PM 密码、编辑团队基础信息。
- 通知设置：钉钉 Webhook、可选加签、北京时间每日定时发送卡点与全部逾期摘要（逾期不限优先级）、实时消息预览和发送日志。
- 手机：首页与团队详情只读，可展开团队、筛选和查看需求。

## 本地启动

要求 Node.js 22+ 与 MySQL 8.0+ 或 PostgreSQL 15+。先创建数据库，再配置连接地址（驱动由 URL 自动选择）：

```bash
cd frontend
npm install
export DATABASE_URL='mysql://horus:change-me@127.0.0.1:3306/horus'
# PostgreSQL / Supabase 可替换为：postgresql://user:password@host:5432/database?sslmode=require
npm run db:push
npm run db:init
npm run dev
```

`DATABASE_URL` 支持 `mysql://`、`postgres://` 和 `postgresql://`。Drizzle 配置会据此自动选择 MySQL 或 PostgreSQL schema/驱动。`db:init` 幂等地创建初始负责人（默认账号 `admin`）与通知设置行；不会为已有负责人重置密码。首次登录时设置密码。

从旧版本升级时，先执行 `deploy/mysql/04-stats-upgrade.sql`（PostgreSQL 为 `deploy/postgres/03-stats-upgrade.sql`），再运行 `npm run db:backfill` 回填历史生命周期事件；该命令可重复执行，首次打开「需求统计」也会自动回填。

可选环境变量：

- `HORUS_INIT_OWNER_USERNAME`：首次创建负责人时使用的账号，默认 `admin`。
- `HORUS_INIT_OWNER_NAME`：首次创建负责人时使用的姓名，默认 `团队负责人`。
- `HORUS_DEMO_MODE=true`：仅用于本地/受控演示。显式启用后自动灌入演示团队和需求，并允许免登录负责人体验；默认未开启，匿名访问工作台会跳转至 `/login`。
- `HORUS_DB_CONNECTION_LIMIT`：数据库连接池大小；MySQL 默认 `10`，Vercel 上 PostgreSQL 默认 `3`（应配合 Supabase 连接池使用）。
- `HORUS_DB_PUSH` / `HORUS_DB_INIT`：容器启动入口的开关，仅影响镜像里的 `docker-entrypoint.sh`（`npm run dev` 不读）。可在 MySQL 的 `deploy/mysql/` 或 PostgreSQL 的 `deploy/postgres/` 中提前执行对应 SQL，再设置 `HORUS_DB_PUSH=false` / `HORUS_DB_INIT=false`。跳过 push 后启动仍会校验 8 张表齐全。
- `HORUS_DB_WAIT_TIMEOUT` / `HORUS_DB_STEP_TIMEOUT`：容器入口等待数据库的秒数上限（默认 `90`）与单个数据库步骤的墙钟上限（默认 `180`，`0` 关闭），避免数据库不可达时启动无限期挂住。
- `APP_URL`：钉钉摘要链接的兜底地址。
- 「本周新建」使用自然周（周一 00:00 Asia/Shanghai），不再提供窗口天数配置。

**不要在生产环境开启 `HORUS_DEMO_MODE`。** 生产模式默认强制登录，不会自动创建演示业务数据。

### 无数据库的界面预览

如果当前环境尚未配置数据库、只需查看页面布局与示例数据，可在 `frontend/` 运行：

```bash
HORUS_PREVIEW_MODE=true npm run dev -- --hostname 0.0.0.0 --port 3000
```

访问 `http://localhost:3000`。这是**仅在 `NODE_ENV=development` 生效的只读预览**：使用内存示例数据，不会连接任何数据库、灌入数据或发送钉钉通知；登录和全部写接口返回 503，页面显示明显提示。`/api/health` 返回 `{"ok":true,"mode":"read-only-preview"}`，**不代表生产数据库健康**。完整可交互演示仍需按上文配置 MySQL 或 PostgreSQL 并显式开启 `HORUS_DEMO_MODE=true`。生产构建即使设置了 `HORUS_PREVIEW_MODE` 也不会启用预览。

在 Arena 的 HTTPS iframe 中验证**真实数据库登录**时，可显式设置 `HORUS_EMBEDDED_PREVIEW=true` 启动应用。部分浏览器彻底阻止第三方 Cookie，因此此模式额外在 `sessionStorage` 保存当前标签页的临时令牌，并通过 `Authorization` 请求工作台；关闭标签页后需要重新登录。此令牌可被页面 JavaScript 读取，**仅允许在隔离的沙箱预览使用，绝不可用于真实业务或内网投产**。常规部署不要设置这个变量，继续使用 HttpOnly Cookie 策略。避免在登录期间切换开发热更新版本，必要时用 `npm run build` 生成稳定的 standalone 预览。

## 账号与安全

正式模式由负责人预建成员账号。成员首次登录时设置 8–72 位密码，密码使用 bcrypt 哈希；会话 Cookie 为 HTTP-only，服务端仅存 SHA-256 token 摘要。负责人可以重置 PM 密码（同时使其所有会话失效）或停用成员（立即注销会话）。无自助注册与密码找回。

演示模式预置负责人 `chen` 和 PM `lin`、`su`、`zhou`；该模式提供负责人演示权限，**不可用于真实业务数据**。

## 数据模型

MySQL 与 PostgreSQL schema 都包含团队、成员、需求、会话、审计日志、通知设置和通知日志七张表。ID/唯一键使用有长度的 `VARCHAR`；结构化字段分别使用原生 `JSON` / `JSONB`；ISO-8601 UTC 时间以 `VARCHAR(40)` 保存，避免数据库时区转换引入排序或过期判断偏差。两种 schema 分别位于 `src/db/schema.mysql.ts`、`src/db/schema.postgres.ts`，通过 `src/db/schema.ts` 按 `DATABASE_URL` 选择。

## 开发与验证

```bash
npm run test:domain
npm run test:schema-sql      # MySQL SQL 与 schema / Docker 入口校验
npm run test:schema-postgres # PostgreSQL SQL 与 Drizzle schema 校验
npm run test:database-dialect # DATABASE_URL 的方言选择
npm run typecheck
npm run lint
npm run build
```

`npm run test:digest` 在已配置 `DATABASE_URL` 时验证每日摘要的数据库抢占，不会调用钉钉。

接口与浏览器验收使用独立临时团队/成员。先以 `HORUS_DEMO_MODE=true` 启动已初始化的测试 MySQL 或 PostgreSQL 与应用，再运行：

```bash
npm run test:acceptance
```

检查默认安全策略时，以 `HORUS_DEMO_MODE=false`（或不设置该变量）运行应用，再执行：

```bash
npm run test:security
```

浏览器测试需要 Playwright Chromium（首次可运行 `npx playwright install chromium`）。验收脚本通过 Drizzle 清理临时数据。运行测试前请勿连接生产数据库。

## 调度与边界

- `src/instrumentation.ts` 在 Node 服务启动时开启分钟级调度，适用于单实例持续在线部署；时区为 `Asia/Shanghai`。
- 每天到达配置时间后，调度器用条件更新抢占当日执行权，避免重启或重叠 tick 重复发送。失败日志及待重试摘要会保留至次日合并发送。
- 钉钉测试消息使用已保存的真实配置，不伪造发送结果，也不占用当日定时名额。
- 需求负责人为自由文本；需求来源默认为「手工录入」，外部 ID 字段为后续集成预留。
- 生产部署使用仓库根目录的 `docker compose up -d --build`。步骤、备份恢复和钉钉联调见 [`docs/deployment-guide.md`](../docs/deployment-guide.md)。

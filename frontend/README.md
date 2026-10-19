# Horus · 研发进程，尽在掌握

Horus 是面向小型研发团队的里程碑跟踪工具，基于 Next.js App Router、React、Drizzle ORM 与 MySQL 8.0。界面和现有领域逻辑沿用原型实现；数据库层已切换至 MySQL，演示访问默认关闭。

## 功能

- 工作台：近 7 天新建、卡点、高优逾期三条规则取并集，按团队分组。
- 团队详情：阶段分布、筛选与排序、在途和归档列表。
- 需求全生命周期：创建、编辑、跳阶段推进、卡点标记和解除、取消、上线自动归档。
- 阶段模板：团队独立配置阶段；删除仍有需求的阶段时必须指定迁移目标。
- 成员与团队：负责人预建账号、角色分配、多团队绑定、停用成员、重置 PM 密码、编辑团队基础信息。
- 通知设置：钉钉 Webhook、可选加签、北京时间每日定时发送、实时消息预览和发送日志。
- 手机：首页与团队详情只读，可展开团队、筛选和查看需求。

## 本地启动

要求 Node.js 22+ 与 MySQL 8.0+。先创建数据库，再配置连接地址：

```bash
cd frontend
npm install
export DATABASE_URL='mysql://horus:change-me@127.0.0.1:3306/horus'
npm run db:push
npm run db:init
npm run dev
```

`DATABASE_URL` 是 MySQL URL。Drizzle 配置会从环境变量或 `.env` 读取同一个地址。`db:init` 幂等地创建初始负责人（默认账号 `admin`）与通知设置行；不会为已有负责人重置密码。首次登录时设置密码。

可选环境变量：

- `HORUS_INIT_OWNER_USERNAME`：首次创建负责人时使用的账号，默认 `admin`。
- `HORUS_INIT_OWNER_NAME`：首次创建负责人时使用的姓名，默认 `团队负责人`。
- `HORUS_DEMO_MODE=true`：仅用于本地/受控演示。显式启用后自动灌入演示团队和需求，并允许免登录负责人体验；默认未开启，匿名访问工作台会跳转至 `/login`。
- `HORUS_DB_CONNECTION_LIMIT`：MySQL 连接池大小，默认 `10`。
- `HORUS_DB_PUSH` / `HORUS_DB_INIT`：容器启动入口的开关，仅影响镜像里的 `docker-entrypoint.sh`（`npm run dev` 不读）。表结构改为在外部 MySQL 上执行 `deploy/mysql/01-schema.sql`（推荐入口 `../scripts/init-sql.sh`）时，设 `HORUS_DB_PUSH=false` 跳过 `drizzle-kit push`；已执行 `02-init-owner.sql` 时再设 `HORUS_DB_INIT=false` 跳过负责人初始化。跳过 push 后启动仍会校验 7 张表齐全。
- `HORUS_DB_WAIT_TIMEOUT` / `HORUS_DB_STEP_TIMEOUT`：容器入口等 MySQL 的秒数上限（默认 `90`）与单个数据库步骤的墙钟上限（默认 `180`，`0` 关闭），避免 Pod 连不上 MySQL 时启动无限期挂住。
- `APP_URL`：钉钉摘要链接的兜底地址。
- `HORUS_NEW_WINDOW_DAYS`：首页「本周新建」滚动窗口，默认 `7`，允许 1–90。运行时读取，并随工作台数据下发给页面。
- `NEXT_PUBLIC_NEW_WINDOW_DAYS`：同上窗口的构建期兜底。两者都配置时，以 `HORUS_NEW_WINDOW_DAYS` 为准。

**不要在生产环境开启 `HORUS_DEMO_MODE`。** 生产模式默认强制登录，不会自动创建演示业务数据。

### 无数据库的界面预览

如果当前环境没有 MySQL，只需查看页面布局与示例数据，可在 `frontend/` 运行：

```bash
HORUS_PREVIEW_MODE=true npm run dev -- --hostname 0.0.0.0 --port 3000
```

访问 `http://localhost:3000`。这是**仅在 `NODE_ENV=development` 生效的只读预览**：使用内存示例数据，不会连接 MySQL、灌入数据库或发送钉钉通知；登录和全部写接口返回 503，页面显示明显提示。`/api/health` 返回 `{"ok":true,"mode":"read-only-preview"}`，**不代表生产数据库健康**。完整可交互演示仍需按上文配置 MySQL 并显式开启 `HORUS_DEMO_MODE=true`。生产构建即使设置了 `HORUS_PREVIEW_MODE` 也不会启用预览。

在 Arena 的 HTTPS iframe 中验证**真实 MySQL 登录**时，可显式设置 `HORUS_EMBEDDED_PREVIEW=true` 启动应用。部分浏览器彻底阻止第三方 Cookie，因此此模式额外在 `sessionStorage` 保存当前标签页的临时令牌，并通过 `Authorization` 请求工作台；关闭标签页后需要重新登录。此令牌可被页面 JavaScript 读取，**仅允许在隔离的沙箱预览使用，绝不可用于真实业务或内网投产**。常规部署不要设置这个变量，继续使用 HttpOnly Cookie 策略。避免在登录期间切换开发热更新版本，必要时用 `npm run build` 生成稳定的 standalone 预览。

## 账号与安全

正式模式由负责人预建成员账号。成员首次登录时设置 8–72 位密码，密码使用 bcrypt 哈希；会话 Cookie 为 HTTP-only，服务端仅存 SHA-256 token 摘要。负责人可以重置 PM 密码（同时使其所有会话失效）或停用成员（立即注销会话）。无自助注册与密码找回。

演示模式预置负责人 `chen` 和 PM `lin`、`su`、`zhou`；该模式提供负责人演示权限，**不可用于真实业务数据**。

## 数据模型

MySQL schema 包含团队、成员、需求、会话、审计日志、通知设置和通知日志七张表。ID/唯一键使用有长度的 `VARCHAR`；结构化字段使用原生 `JSON`；ISO-8601 UTC 时间以 `VARCHAR(40)` 保存，避免数据库时区转换引入排序或过期判断偏差。

## 开发与验证

```bash
npm run test:domain
npm run test:schema-sql   # deploy/mysql 的 SQL 与 schema.ts / 入口校验是否漂移
npm run typecheck
npm run lint
npm run build
```

`npm run test:digest` 在已配置 `DATABASE_URL` 时验证每日摘要的数据库抢占，不会调用钉钉。

接口与浏览器验收使用独立临时团队/成员。先以 `HORUS_DEMO_MODE=true` 启动已初始化的测试 MySQL 与应用，再运行：

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

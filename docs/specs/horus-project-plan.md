# Horus V1 工程落地项目计划书

- **文档版本**：V1.0
- **制定日期**：2026-10-16
- **制定角色**：项目负责人（Project & Tech Lead）
- **关联文档**：[《Horus 需求文档（V1）》](./horus-design.md)
- **交付模式**：单兵 + AI 协同敏捷冲刺（5 个工作日上线）
- **技术路线**：基于现有 `frontend/` Next.js 全栈原型直接生产化改造（Next.js App Router + Drizzle ORM + MySQL 8.0 + Docker 单实例容器化）
- **执行状态（2026-10-16）**：第一步 M1 + M2 已完成代码改造；typecheck、lint、build 与默认安全模式验收通过。真实 MySQL 建表与完整 Playwright 验收仍需在具备 MySQL/Chromium 的环境中执行。

---

## 1. 项目概览与总体策略

### 1.1 项目背景与目标
目前 Horus 已经完成了 V1 需求文档（PRD）确认，并在 `frontend/` 目录下构建了一套**高完成度的可交互全栈原型**。经代码盘点，现有原型并非静态 Mock 页面，而是已经实现了完整的 React 界面组件、核心领域模型、轻登录鉴权、钉钉通知调度及 Playwright 自动化验收脚本，但底层暂时基于预览平台的 **PostgreSQL** 运行，且默认处于“免登录公开演示模式”。

本计划的目标是在 **5 个工作日（1 周）** 内，以最小改动成本和最高工程质量，将现有原型演进为符合 PRD 生产标准的 **Next.js 全栈单体 + MySQL 容器化应用**，完成内网部署与正式投产。

### 1.2 核心推进原则
1. **最大化复用已有资产**：100% 保留现有 UI 组件（`src/components/*`）、样式体系（`globals.css`）和领域纯函数（`src/lib/domain.ts`），不做推倒重写。
2. **差距驱动（Gap-Driven）**：精准锁定“演示原型”与“生产系统”之间的 6 项工程差距（数据库迁移、环境解耦、管理闭环、安全加固、容器编排、测试适配），逐一清零。
3. **日清日结与命令级验收**：按单兵 + AI 结对的高效节奏，将任务拆解到每日里程碑（M1～M5），每个任务均配备明确的修改文件清单与自动化验证命令（DoD）。

---

## 2. 现状盘点与差距分析（Gap Analysis）

### 2.1 现有原型已完成资产（约占总工作量 75%）

| 模块 | 对应 PRD | 现有代码位置 | 完成度 | 现状评估 |
| :--- | :--- | :--- | :---: | :--- |
| **首页·聚焦工作台** | FR-1 | `src/components/requirement-views.tsx` (`Dashboard`) | 95% | 已实现近 7 天新建、卡点、高优逾期三规则取并集、按团队分组折叠、统计卡片与多维筛选 |
| **团队详情页** | FR-2 | `src/components/requirement-views.tsx` (`TeamPage`) | 95% | 已实现阶段分布柱状/漏斗图（点击可筛选）、在途列表筛选排序、归档历史查询 |
| **需求全生命周期** | FR-3 | `src/components/requirement-dialogs.tsx` | 95% | 已实现新建、编辑、向前跳阶段推进、禁止回退、末阶段自动归档、卡点标记/解除、取消归档、操作留痕 |
| **阶段模板自定义** | FR-4 | `src/components/stages-settings.tsx` | 95% | 已实现团队级阶段增删、改名、拖拽/按钮调序，以及删除有需求阶段时的强制迁移校验 |
| **成员与团队管理** | FR-5 | `src/components/member-settings.tsx` | 85% | 已实现预建成员、角色分配、PM 多团队绑定、账号停用；**缺负责人重置密码与团队信息编辑** |
| **钉钉每日异常摘要** | FR-6 | `src/lib/notifications.ts`, `scheduler.ts` | 90% | 已实现 Webhook 校验、HMAC-SHA256 加签、09:30 定时调度、失败次日合并重试、实时预览 |
| **移动端只读体验** | NFR-3 | `src/app/globals.css`, `requirement-views.tsx` | 95% | 移动端自适应卡片视图、隐藏写操作入口、抽屉只读提示均已通过 390px 视口验收 |

### 2.2 待实现的 6 大核心差距（约占总工作量 25%）

#### Gap 1：数据库底座从 PostgreSQL 迁移至 MySQL 8.0（最高优先级 · NFR-1）
现有代码耦合了 PostgreSQL 驱动与方言特性，切换到 MySQL 需解决以下 4 个具体技术点：
1. **依赖与连接池替换**：`pg` + `drizzle-orm/node-postgres` 需替换为 `mysql2` + `drizzle-orm/mysql2`；将 Drizzle 配置改为环境变量驱动的 `drizzle.config.ts`，`dialect` 设为 `"mysql"` 并从 `DATABASE_URL` 读取连接地址。
2. **表结构（Schema）类型映射**：
   - MySQL InnoDB **不允许无长度的 `TEXT` 列作为主键或唯一索引**。现有 `horus_teams.id`、`horus_members.id`、`horus_members.username`、`horus_sessions.id`、`horus_notification_settings.id` 均定义为 `text()`，必须改为 `varchar(64)` 或 `varchar(32)`。
   - `jsonb` 需替换为 MySQL 的 `json` 类型。
   - `timestamp(..., { mode: "string", withTimezone: true })` 需适配为 MySQL 时间类型或 ISO 字符串存储方案，确保与前端 `new Date(isoString)` 无缝兼容。
3. **移除 PostgreSQL 专有 `.returning()` 语法**：
   - MySQL 原生不支持 `INSERT ... RETURNING *` 和 `UPDATE ... RETURNING *`。
   - 需改造 `src/app/api/workspace/route.ts`（第 52 行 `insert(requirements)...returning()`、第 143 行 `update(members)...returning()`）与 `src/app/api/auth/route.ts`（第 34 行 `update(members)...returning()`）。
4. **移除 PostgreSQL 专有锁与 JSON 操作符**：
   - `src/db/seed.ts` 第 13 行的 `select pg_advisory_xact_lock(22061015)` 需改为 MySQL `GET_LOCK('horus_seed', 10)` 或幂等判空插入。
   - `tests/acceptance.mjs` 第 167 行的 `detail->>'teamId'` 需改为 MySQL `JSON_UNQUOTE(JSON_EXTRACT(...))`。

#### Gap 2：演示模式与生产环境彻底解耦
- **现状问题**：`src/lib/auth.ts` 和 `src/app/api/auth/route.ts` 在每次请求时均调用 `ensureSeed()`，若数据库为空会自动灌入 4 个虚拟团队和 42 条演示需求；且当未设置 `HORUS_REQUIRE_LOGIN=true` 时，未登录请求会默认获得负责人 `owner` 权限。
- **生产改造**：
  - 安全默认化（Secure by Default）：默认强制要求登录，仅当显式配置 `HORUS_DEMO_MODE=true` 时才允许免密演示与自动灌入演示数据。
  - 编写独立的**生产初始化脚本**（`npm run db:init`）：仅初始化系统通知默认配置行（`horus_notification_settings`）及首个团队负责人账号（从环境变量读取账号名与姓名，密码留空待首次登录设置）。

#### Gap 3：PRD 开放点固化与管理小闭环补齐
- **固化 PRD §8 开放点**：
  1. **需求负责人**：确认为“自由文本输入 + 活跃成员/历史负责人姓名自动补全建议（`<datalist>`）”，兼顾研发/测试不在系统账号体系内的实际情况。
  2. **本周新建窗口**：默认 7 天，提取为可配置环境变量 `HORUS_NEW_WINDOW_DAYS=7`。
- **新增「负责人重置成员密码」功能**：
  - PRD 明确不做自助找回密码。生产环境中 PM 遗忘密码时，由团队负责人在「成员与团队」列表中点击「重置密码」，清空该成员 `passwordHash` 并清除其已有登录会话，使其下次登录时重新进入“首次登录设置密码”流程。
- **新增「编辑团队基础信息」功能**：
  - 允许负责人在「成员与团队 → 团队管理」中修改已有团队的名称、描述与颜色图标，补齐团队管理闭环。

#### Gap 4：安全、会话治理与定时调度加固
- **停用成员与重置密码时强制下线**：在 `toggleMember`（停用时）和 `resetMemberPassword` 事务中同步 `DELETE FROM horus_sessions WHERE member_id = ?`。
- **过期 Session 自动清理**：在登录与定时任务 tick 中顺带清理 `expires_at < NOW()` 的过期会话记录。
- **定时推送并发防护**：在 `src/lib/scheduler.ts` 与 `notifications.ts` 中通过原子条件更新或数据库锁确保同一天（`lastRunDate`）绝对不会重复触发每日摘要推送。

#### Gap 5：容器化与内网部署工程化（NFR-1 / NFR-4）
- 缺少 `Dockerfile`、`docker-compose.yml`、`.env.example` 以及容器启动时的数据库 Schema 自动同步与初始化入口脚本。

#### Gap 6：自动化验收脚本（`tests/acceptance.mjs`）适配与扩充
- 需适配 MySQL 连接池与 SQL 语法，并补齐“重置密码”、“编辑团队”、“生产鉴权模式”的自动化测试断言。

---

## 3. 项目里程碑与 5 日冲刺计划（WBS）

采用 **单兵 + AI 结对开发** 模式，按 5 个工作日排定每日交付物与验收标准：

```
Day 1 (M1)              Day 2 (M2)              Day 3 (M3)              Day 4 (M4)              Day 5 (M5)
MySQL 数据层迁移  ───►  生产解耦与管理闭环  ───►  调度加固与全量测试  ───►  Docker 容器化编排  ───►  UAT 联调与正式上线
(Schema/Driver/SQL)    (Init/重置密码/改团队)   (Scheduler/Playwright)  (Dockerfile/Compose)    (钉钉实测/投产割接)
```

### M1（Day 1）：数据库底座迁移（PostgreSQL → MySQL 8.0）

| 任务编号 | 任务名称 | 涉及文件 | 实施要点 |
| :--- | :--- | :--- | :--- |
| **T1.1** | 数据库驱动与配置切换 | `frontend/package.json`<br>`frontend/drizzle.config.ts` | 移除 `pg`、`@types/pg`，安装 `mysql2`；Drizzle 配置使用 MySQL dialect 并从 `DATABASE_URL` 读取连接地址 |
| **T1.2** | Drizzle MySQL Schema 重构 | `frontend/src/db/schema.ts`<br>`frontend/src/db/index.ts` | 使用 `mysqlTable` 重写 7 张表；主键/唯一键改用 `varchar`；`drizzle(pool)` 切换为 `mysql2/promise` 连接池 |
| **T1.3** | 消除 `.returning()` 与 PG 锁 | `frontend/src/app/api/workspace/route.ts`<br>`frontend/src/app/api/auth/route.ts`<br>`frontend/src/db/seed.ts` | `insert` 改用 `$returningId()`；`update` 改用条件更新后校验 `affectedRows`；`seed.ts` 改用 MySQL `GET_LOCK` |
| **T1.4** | 时间与 JSON 字段兼容性对齐 | `frontend/src/db/schema.ts`<br>`frontend/src/lib/data.ts` | 确保 MySQL 返回的日期/时间戳与前端期望的 ISO 字符串格式完全一致，避免前端日期计算偏差 |

- **M1 验收标准（DoD）**：
  - `npm run typecheck` 零报错；
  - `npx drizzle-kit push` 成功在 MySQL 8.0 中创建全部 7 张表（`horus_teams`、`horus_members`、`horus_requirements`、`horus_sessions`、`horus_audit_logs`、`horus_notification_settings`、`horus_notification_logs`）；
  - 应用启动后 `/api/health` 返回 `{"ok": true}`。

---

### M2（Day 2）：生产/演示解耦与管理功能闭环

| 任务编号 | 任务名称 | 涉及文件 | 实施要点 |
| :--- | :--- | :--- | :--- |
| **T2.1** | 生产模式与演示模式解耦 | `frontend/src/lib/auth.ts`<br>`frontend/src/app/login/page.tsx`<br>`frontend/src/db/seed.ts` | 引入 `HORUS_DEMO_MODE`（默认 `false`）。非演示模式下禁止免密访问且不执行 `ensureSeed()` 虚拟数据灌入 |
| **T2.2** | 生产环境初始化脚本 | `frontend/src/db/init-prod.ts`<br>`frontend/package.json` | 新增 `npm run db:init`，幂等创建初始 `owner` 账号（默认账号 `admin` 或读取环境变量）及默认通知设置行 |
| **T2.3** | 负责人重置成员密码 | `frontend/src/app/api/workspace/route.ts`<br>`frontend/src/components/member-settings.tsx` | 新增 `resetMemberPassword` action：置空目标成员 `passwordHash`、清空其 `sessions`、写入审计日志；前端成员列表增加「重置密码」按钮与确认弹窗 |
| **T2.4** | 编辑团队信息与会话清理 | `frontend/src/app/api/workspace/route.ts`<br>`frontend/src/components/member-settings.tsx` | 新增 `updateTeam` action 支持修改团队名称/描述/颜色；`toggleMember` 停用时立即清除该成员 `sessions`；登录时清理过期 `sessions` |

- **M2 验收标准（DoD）**：
  - 在生产模式下，未登录访问 `/` 自动重定向至 `/login`，且登录页不展示演示账号快捷入口；
  - 负责人重置某 PM 密码后，该 PM 原浏览器会话立即返回 `401`，重新输入账号进入“首次登录设置密码”界面；
  - 团队名称、简介与颜色修改后实时在左侧导航栏与团队卡片生效。

---

### M3（Day 3）：钉钉通知加固与自动化验收全量适配

| 任务编号 | 任务名称 | 涉及文件 | 实施要点 |
| :--- | :--- | :--- | :--- |
| **T3.1** | 每日摘要调度并发与容错加固 | `frontend/src/lib/scheduler.ts`<br>`frontend/src/lib/notifications.ts` | 优化分钟级调度器，在定时触发时通过数据库条件更新抢占当日执行权，防止极端情况下重复发送；完善错误日志记录 |
| **T3.2** | 开放点配置化收口 | `frontend/src/lib/domain.ts` | 支持通过 `NEXT_PUBLIC_NEW_WINDOW_DAYS`（默认 `7`）控制“本周新建”天数窗口，保持默认 7 天行为不变 |
| **T3.3** | 自动化验收测试适配与扩充 | `frontend/tests/acceptance.mjs` | 将测试脚本中的 PG JSON 清理语句改为 MySQL 语法；新增「重置成员密码」「编辑团队」接口与 UI 验收用例 |

- **M3 验收标准（DoD）**：
  - `npm run lint`、`npm run typecheck`、`npm run build` 全部通过；
  - 执行 `node --experimental-strip-types tests/acceptance.mjs` 输出 `ALL ACCEPTANCE TESTS PASSED`，且测试临时数据清理干净、浏览器控制台零运行时错误。

---

### M4（Day 4）：Docker 容器化编排与内网交付包制作

| 任务编号 | 任务名称 | 涉及文件 | 实施要点 |
| :--- | :--- | :--- | :--- |
| **T4.1** | Next.js Standalone 构建优化 | `frontend/next.config.ts` | 配置 `output: "standalone"`，大幅缩减生产容器体积与启动耗时 |
| **T4.2** | 编写生产级 `Dockerfile` 与启动脚本 | `frontend/Dockerfile`<br>`frontend/docker-entrypoint.sh` | 多阶段构建（deps → builder → runner）；容器启动时自动等待 MySQL 就绪、执行表结构同步与 `db:init`，再启动服务 |
| **T4.3** | 编写 `docker-compose.yml` 与环境变量模板 | `docker-compose.yml`<br>`.env.example` | 编排 `horus-app` 与 `mysql:8.0`（字符集 `utf8mb4`、时区 `Asia/Shanghai`、数据卷持久化、`/api/health` 健康检查） |
| **T4.4** | 编写生产部署与运维手册 | `docs/deployment-guide.md` | 涵盖首次部署、负责人账号初始化、钉钉机器人配置、MySQL 备份恢复命令（`mysqldump`）、版本升级流程 |

- **M4 验收标准（DoD）**：
  - 一键执行 `docker compose up -d --build` 后，容器健康状态为 `healthy`；
  - 宿主机访问 `http://localhost:3000` 可正常完成初始负责人首次设密登录。

---

### M5（Day 5）：UAT 验收、钉钉实测与正式投产

| 任务编号 | 任务名称 | 涉及角色 | 实施要点 |
| :--- | :--- | :--- | :--- |
| **T5.1** | 内网生产环境部署与网络打通 | 项目负责人 / 运维 | 在公司内网服务器部署容器，验证内网域名/IP 访问，确认容器可访问 `https://oapi.dingtalk.com` |
| **T5.2** | 真实钉钉群机器人联调 | 团队负责人 | 创建内部钉钉群自定义机器人（配置加签密钥或关键词 `Horus`），在「通知设置」点击「立即发送测试」验证消息排版与工作台跳转链接 |
| **T5.3** | 真实团队与 PM 账号初始化 | 团队负责人 | 创建真实的 3～5 个研发团队，按需调整各团队阶段模板，创建 ≤3 个 PM 账号并绑定团队 |
| **T5.4** | PM 录入首批在途需求 & 正式上线 | PM / 团队负责人 | 各团队 PM 录入当周在途需求，团队负责人在手机端与桌面端核对首页聚焦视图，项目正式交付 |

---

## 4. 关键技术改造设计方案（Technical Blueprint）

为确保 Day 1～Day 4 开发过程零返工，本节明确核心代码改造的详细技术规范。

### 4.1 MySQL 表结构设计规范（`src/db/schema.ts`）

将 `drizzle-orm/pg-core` 迁移至 `drizzle-orm/mysql-core` 时，字段类型映射如下：

| 表名 | 字段 | 原 PostgreSQL 定义 | 目标 MySQL 8.0 定义 | 改造原因说明 |
| :--- | :--- | :--- | :--- | :--- |
| `horus_teams` | `id` | `text("id").primaryKey()` | `varchar("id", { length: 64 }).primaryKey()` | MySQL 主键不支持无长度 `TEXT` |
| `horus_teams` | `stages` | `jsonb("stages")` | `json("stages").$type<Stage[]>()` | MySQL 使用原生 `JSON` 类型 |
| `horus_members` | `id` | `text("id").primaryKey()` | `varchar("id", { length: 64 }).primaryKey()` | 主键定长化 |
| `horus_members` | `username` | `text("username").unique()` | `varchar("username", { length: 32 }).unique()` | 唯一索引定长化，契合 3-32 位校验规则 |
| `horus_members` | `teamIds` | `jsonb("team_ids")` | `json("team_ids").$type<string[]>()` | 存放 PM 绑定的团队 ID 数组 |
| `horus_requirements` | `id` | `serial("id").primaryKey()` | `int("id").autoincrement().primaryKey()` | 保持 `number` 类型自增主键，兼容 `HR-100x` 编码 |
| `horus_requirements` | `teamId` | `text("team_id").references(...)` | `varchar("team_id", { length: 64 }).references(...)` | 外键类型必须与 `horus_teams.id` 完全一致 |
| `horus_sessions` | `id` | `text("id").primaryKey()` | `varchar("id", { length: 64 }).primaryKey()` | 存放 SHA-256 十六进制摘要（固定 64 字符） |
| `horus_audit_logs` | `detail` | `jsonb("detail")` | `json("detail").$type<Record<string, unknown>>()` | 存放审计变更详情 JSON |
| 所有表 | 时间戳列 | `timestamp(..., { mode: "string", withTimezone: true })` | `varchar(..., { length: 40 })` 或统一 ISO 序列化 | **推荐方案**：使用 `varchar(40)` 存储标准 UTC ISO-8601 字符串（如 `new Date().toISOString()`）或封装 `customType`，可 100% 避免 MySQL `DATETIME` 丢失毫秒/时区导致的字符串比较 bug |

> **架构师注（关于时间列的选型）**：现有代码中大量直接对时间字符串执行 `new Date(now).toISOString()` 写入，并在 `auth.ts` 中执行 `gt(sessions.expiresAt, new Date().toISOString())` 字典序比较。由于 ISO-8601 UTC 格式（`YYYY-MM-DDTHH:mm:ss.sssZ`）天然满足字典序单调递增，在 MySQL 中使用 `varchar(40)` + `$defaultFn(() => new Date().toISOString())` 可以实现**零业务逻辑改动、零时区偏移风险**的平滑迁移。

### 4.2 PostgreSQL 专有语法替换清单

1. **创建需求获取自增 ID（`src/app/api/workspace/route.ts`）**：
   ```ts
   // 原 PG 写法：
   const [created] = await tx.insert(requirements).values(values).returning();
   // 新 MySQL 写法：
   const [created] = await tx.insert(requirements).values(values).$returningId();
   ```
2. **首次登录设置密码并发保护（`src/app/api/auth/route.ts`）**：
   ```ts
   // 原 PG 写法：
   const [updated] = await tx.update(members).set({ passwordHash })
     .where(and(eq(members.id, member.id), isNull(members.passwordHash))).returning();
   if (!updated) throw new AppError("此账号已设置密码，请重新登录", 409);

   // 新 MySQL 写法：
   const [res] = await db.update(members).set({ passwordHash })
     .where(and(eq(members.id, member.id), isNull(members.passwordHash)));
   if (res.affectedRows === 0) throw new AppError("此账号已设置密码，请重新登录", 409);
   ```
3. **更新成员信息存在性校验（`src/app/api/workspace/route.ts`）**：
   ```ts
   // 原 PG 写法：
   const [updated] = await tx.update(members).set({ name, role, teamIds }).where(eq(members.id, id)).returning();
   if (!updated) throw new AppError("成员不存在", 404);

   // 新 MySQL 写法：
   const [existing] = await tx.select({ id: members.id }).from(members).where(eq(members.id, id));
   if (!existing) throw new AppError("成员不存在", 404);
   await tx.update(members).set({ name, role, teamIds }).where(eq(members.id, id));
   ```

### 4.3 新增接口动作契约（`/api/workspace`）

在保持现有单一 `/api/workspace` 路由设计风格的前提下，扩充 2 个管理 Action：

| Action 名称 | 权限要求 | 请求参数 | 服务端处理逻辑 |
| :--- | :--- | :--- | :--- |
| `resetMemberPassword` | `assertOwner(actor)` | `{ id: string }` | 1. 校验目标成员存在；<br>2. 事务内将 `members.passwordHash` 设为 `null`；<br>3. 删除 `sessions` 表中 `memberId = id` 的所有记录；<br>4. 写入 `auditLogs`。 |
| `updateTeam` | `assertOwner(actor)` | `{ id: string, name: string, description: string, color: string }` | 1. 校验团队名称非空且不与其他团队重名；<br>2. 映射 `color` 对应的默认 `icon`；<br>3. 更新 `teams` 表并写入 `auditLogs`。 |

### 4.4 生产环境变量规范（`.env.example`）

```dotenv
# 数据库连接（必填，MySQL 8.0+）
DATABASE_URL="mysql://horus:horus_secret_password@mysql:3306/horus"

# 运行模式控制
# 生产环境保持 HORUS_DEMO_MODE=false（默认强制登录，不注入演示数据）
HORUS_DEMO_MODE="false"

# 生产首次初始化负责人账号配置（由 db:init 脚本读取）
HORUS_INIT_OWNER_USERNAME="admin"
HORUS_INIT_OWNER_NAME="团队负责人"

# 系统对外访问地址（用于钉钉通知底部跳转链接兜底）
APP_URL="http://horus.internal.company.com"
```

---

## 5. 质量保障与验收标准（QA & Acceptance Checklist）

### 5.1 功能与业务规则验收清单

- [ ] **FR-1 首页聚焦视图**：
  - [ ] 准确展示“近 7 天新建 ∪ 卡点 ∪ 高优逾期”的在途需求，按团队分组且支持折叠。
  - [ ] 缺失期望上线日期的高优需求不计入“高优逾期”，展示“未填期望上线”。
  - [ ] 同一需求命中多条规则时叠加显示标签（新建 / 卡点 / 逾期），但在列表中仅出现一次。
- [ ] **FR-2 & FR-3 团队详情与需求操作**：
  - [ ] 阶段分布图准确反映当前团队各阶段在途需求数，点击阶段可联动过滤列表。
  - [ ] 阶段推进只允许选择当前阶段之后的阶段（可跳过，不可回退），推进后阶段停留天数归零重算。
  - [ ] 推进至最后一个阶段（如“正式上线”）时，需求自动变为“已上线（归档）”，自动清除卡点状态并移出在途视图。
  - [ ] 标记卡点必须填写原因；取消需求后立即归档且不可逆。
- [ ] **FR-4 阶段模板自定义**：
  - [ ] 增删、改名、调序仅作用于当前所选团队。
  - [ ] 当删除仍有需求停留的阶段时，前后端均强制要求指定迁移目标阶段；若迁移目标为末阶段，在途需求自动上线归档。
- [ ] **FR-5 成员与团队管理**：
  - [ ] 新建成员与重置密码后的成员，首次输入账号时自动识别并引导设置 8～72 位密码（bcrypt 成本因子 12 哈希存库）。
  - [ ] PM 仅能在其绑定的团队下创建、编辑、推进需求；跨团队操作返回 `403`。
  - [ ] 停用成员或重置密码后，该成员已登录的 Cookie 会话立即失效（返回 `401`）。
- [ ] **FR-6 钉钉每日异常摘要**：
  - [ ] 接口响应严格脱敏，前端无法通过 `/api/workspace` 获取已保存的 Webhook URL 与加签密钥明文。
  - [ ] 推送失败时记录失败日志并将摘要存入 `pendingItems`，次日定时发送时自动去重合并。

### 5.2 非功能性与安全验收清单（对照 PRD §5）

- [ ] **NFR-1（架构一致）**：单实例 Next.js 容器 + MySQL 8.0 稳定运行，通过 `docker compose up` 一键拉起。
- [ ] **NFR-2（响应性能）**：内网百级需求规模下，首屏 SSR 与 `/api/workspace` 响应耗时 < 200ms，页面完整加载 < 2s。
- [ ] **NFR-3（移动只读）**：手机端（宽度 < 768px）访问首页与团队详情无横向滚动条，所有写操作按钮隐藏。
- [ ] **NFR-4（数据备份）**：提供标准 `mysqldump` 备份与恢复脚本说明。
- [ ] **NFR-5（扩展预留）**：`horus_requirements` 表完整保留 `source` 与 `external_id` 字段。
- [ ] **NFR-6（密码与鉴权安全）**：密码采用 `bcryptjs`（12 rounds）哈希；Session 仅在服务端存 SHA-256 摘要；写接口具备 `Origin`/`Host` 同源校验与登录防爆破限流。

---

## 6. 风险识别与应对预案（Risk Matrix）

| 风险项 | 可能性 | 影响度 | 应对与缓解措施 |
| :--- | :---: | :---: | :--- |
| **MySQL 与 PG 在 Drizzle ORM 下的隐式行为差异**（如 `boolean` 返回 `0/1`、JSON 反序列化、大小写敏感） | 中 | 高 | 1. 严格使用 Drizzle 的 `mysql-core` 类型定义（`boolean` 自动映射 `tinyint(1)` 并转为 JS `boolean`）；<br>2. MySQL 库表统一配置 `utf8mb4_0900_ai_ci`；<br>3. 使用 `tests/acceptance.mjs` 在真实 MySQL 实例上跑通全套断言。 |
| **容器时区不一致导致钉钉 09:30 推送时间偏移或逾期判断跨日偏差** | 中 | 中 | 1. 代码层 `todayString()` 与 `scheduler.ts` 已显式指定 `timeZone: "Asia/Shanghai"`；<br>2. 在 `Dockerfile` 和 `docker-compose.yml` 中显式注入 `TZ=Asia/Shanghai` 环境变量。 |
| **内网服务器无法访问公网导致构建失败或钉钉推送超时** | 低 | 中 | 1. 字体已采用本地 npm 包（`@fontsource-variable/inter` 与 `noto-sans-sc`），无需运行时请求 Google Fonts；<br>2. 支持在内网 CI 或有网机器构建 Docker 镜像后导出 tar 包部署；<br>3. 提前在生产宿主机通过 `curl -I https://oapi.dingtalk.com` 验证出网连通性。 |
| **生产环境误开启演示模式导致未授权访问** | 低 | 高 | 将代码逻辑反转为**默认安全（Secure by Default）**：未配置环境变量时一律强制要求账号登录，仅当显式声明 `HORUS_DEMO_MODE="true"` 时才开启演示工作台。 |

---

## 7. 下一步执行建议（Action Items）

作为项目负责人，本计划确认后，我们可以立即在当前分支上按 **M1 → M4** 顺序直接编码落地：

1. **第一步（M1 & M2 代码实施已完成）**：已完成 MySQL 依赖与 Schema 切换、移除 `.returning()` / PostgreSQL 锁、生产默认鉴权、`db:init`、成员密码重置和团队信息编辑；待在真实 MySQL 环境执行建表与完整验收。
2. **第二步（执行 M3 & M4）**：补齐调度加固、`Dockerfile`、`docker-compose.yml`、`.env.example`，并运行全量自动化测试验证。

> 如你认可本计划，请直接告诉我**“按计划开始实现”**（或提出需要微调的点），我将立即开始推进代码改造。

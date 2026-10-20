# Horus · Vercel + Supabase PostgreSQL 部署

- 关联文档：[环境变量参考](./environment-variables.md) · [Compose 部署手册](./deployment-guide.md) · [Kubernetes 部署](./kubernetes-deployment.md)
- Horus 支持 MySQL 8.0+ 和 PostgreSQL 15+。驱动与 Drizzle schema 由 `DATABASE_URL` 自动选择：`mysql://` 使用 MySQL，`postgres://` / `postgresql://` 使用 PostgreSQL。Docker Compose 仍默认带 MySQL；Vercel + Supabase 使用 PostgreSQL。
- 本路线**不适用**容器入口开关 `HORUS_DB_PUSH` / `HORUS_DB_INIT` / `HORUS_DB_WAIT_TIMEOUT` / `HORUS_DB_STEP_TIMEOUT`（仅镜像入口脚本读取，Vercel 没有这个入口）；也用不到 `MYSQL_*`、`HORUS_PORT`。

## 1. Vercel 项目

- Git 仓库：`ivanmissu/Horus`
- Root Directory：`frontend`
- Framework Preset：Next.js（自动识别）
- Build / Install Command：使用默认值（`npm run build` / `npm install`）
- 部署目标：默认 `*.vercel.app` 域名；如需正式域名，在 Vercel 项目 Domains 中配置。

## 2. Supabase PostgreSQL

在 Supabase 创建 PostgreSQL 项目。生产运行建议使用 Supavisor **Session Pooler** 连接串（尤其是 Vercel serverless），格式如下：

```text
postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@<POOLER_HOST>:5432/postgres?sslmode=require
```

若使用 Transaction Pooler（端口通常为 `6543`），须使用 Supabase 提供的完整连接串；应用不使用命名预备语句，连接池大小应保持较小。不要将数据库连接串或密码放入 `NEXT_PUBLIC_*` 变量、仓库或聊天。

新建空数据库可通过 Supabase SQL Editor 执行 `deploy/postgres/01-schema.sql`，再执行 `deploy/postgres/02-init-owner.sql`；或者在能够直连数据库的环境里运行：

```bash
cd frontend
DATABASE_URL='postgresql://…' npm run db:push
DATABASE_URL='postgresql://…' npm run db:init
```

上述初始化只创建空表、`admin` 初始负责人和默认通知设置，不灌入演示团队或需求，不会导入既有 MySQL 数据。负责人首次访问 `/login` 时设置密码。

## 3. Vercel 环境变量

在 Project Settings → Environment Variables 中配置（至少 Production；需要预览环境时也配置 Preview）：

| Key | 示例/默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | Supabase Session Pooler 的 PostgreSQL 连接串 | 仅服务端使用，设置为 Sensitive/Encrypted |
| `HORUS_DEMO_MODE` | `false` | 生产必须关闭演示模式 |
| `HORUS_INIT_OWNER_USERNAME` | `admin` | 首次初始化负责人账号 |
| `HORUS_INIT_OWNER_NAME` | `团队负责人` | 首次初始化负责人姓名 |
| `APP_URL` | 最终的 `https://<project>.vercel.app` | 摘要链接兜底地址；自定义域名启用后同步更新 |
| `HORUS_NEW_WINDOW_DAYS` | `7` | 「本周新建」窗口，范围 1–90 |
| `NEXT_PUBLIC_NEW_WINDOW_DAYS` | `7` | 构建期兜底值，应与上一项一致 |
| `HORUS_DB_CONNECTION_LIMIT` | `3` | 适配 Vercel 函数与 Supabase Pooler，避免连接数过多 |

上表是本路线的全部变量；每个变量的完整说明与默认值见[环境变量参考](./environment-variables.md)。不要设置 `HORUS_EMBEDDED_PREVIEW`。保存环境变量后触发一次新部署，使环境变量进入生产运行环境。

## 4. 日报与运行边界

Vercel 函数不是常驻进程，因此不会启动 Horus 的进程内分钟级调度器。当前 Vercel 部署会明确关闭「每日异常摘要」开关，避免误以为定时推送正在运行；管理员仍可手动发送测试摘要。需要自动日报时，应另行配置受保护的定时触发方案，并重新启用该功能。

本次部署的 Supabase 默认通知设置为关闭；不配置 DingTalk Webhook 或签名密钥。需要使用时由负责人登录后在「通知设置」中配置，Webhook 与签名密钥不会从页面回显。

## 5. MySQL 部署不变

选择 MySQL 时继续设置 `DATABASE_URL=mysql://…` 并使用现有 Docker Compose / Kubernetes 部署文档。MySQL SQL 初始化脚本位于 `deploy/mysql/`；PostgreSQL SQL 位于 `deploy/postgres/`。两种数据库的应用表名与业务字段保持一致，现有 MySQL 数据不会因为切换连接串自动迁移。
